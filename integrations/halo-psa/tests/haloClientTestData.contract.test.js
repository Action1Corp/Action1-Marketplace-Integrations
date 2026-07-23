const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  DEFAULT_COUNT,
  MAX_COUNT,
  buildPlan,
  createManifest,
  getManifestFilePath,
  parseCount,
  runCleanupCommand,
  runCreateCommand,
  runPlanCommand,
  runVerifyCommand
} = require('./haloClientTestData.manual');

async function makeTempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'halo-client-test-data-'));
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

function createSettings(overrides = {}) {
  return {
    HaloPsaResourceServer: 'https://halo.example.com/api',
    HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
    HaloPsaClientId: 'client-id-123',
    HaloPsaClientSecret: 'stored-secret-value',
    ...overrides
  };
}

function createDeps(overrides = {}) {
  return {
    now: () => new Date('2026-07-22T12:34:56.000Z'),
    manifestDir: path.join(process.cwd(), 'integrations', 'halo-psa', '.runtime-logs', 'manual-client-test-data'),
    authClientFactory: async () => ({
      async requestResource() {
        throw new Error('unexpected requestResource call');
      }
    }),
    loadSettings: async () => createSettings(),
    requestToken: async () => ({ accessToken: 'halo-token', tokenType: 'Bearer' }),
    discoverClients: async () => [],
    print() {},
    ...overrides
  };
}

async function testGeneratedNamesAreUniqueAndZeroPadded() {
  const plan = buildPlan({ count: 3, now: new Date('2026-07-22T12:34:56.000Z') });
  assert.strictEqual(plan.records[0].generatedName.endsWith('001'), true, 'first generated client name should be zero-padded');
  assert.strictEqual(plan.records[1].generatedName.endsWith('002'), true, 'second generated client name should be zero-padded');
  assert.strictEqual(plan.records[2].generatedName.endsWith('003'), true, 'third generated client name should be zero-padded');
  assert.strictEqual(new Set(plan.records.map((row) => row.generatedName)).size, 3, 'generated client names should be unique');
}

async function testCountHasSafeDefaultAndMaximum() {
  assert.strictEqual(parseCount(undefined), DEFAULT_COUNT, 'count should default safely');
  assert.strictEqual(DEFAULT_COUNT, 120, 'default count should remain 120');
  assert.strictEqual(MAX_COUNT, 500, 'hard maximum should remain 500');
  assert.throws(() => parseCount('501'), /maximum/i, 'count above the hard maximum should be rejected');
}

async function testCreateRefusesWritesWithoutConfirm() {
  const calls = [];
  const result = await runCreateCommand({
    count: 2,
    confirm: false,
    ackNonProduction: true
  }, createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        calls.push(request);
        return { data: [{ id: 1, name: 'never' }] };
      }
    })
  }));

  assert.notStrictEqual(result.exitCode, 0, 'create without --confirm should fail safely');
  assert.strictEqual(calls.length, 0, 'create without --confirm should not send POST requests');
}

async function testCreateRefusesWritesWithoutAckNonProduction() {
  const calls = [];
  const result = await runCreateCommand({
    count: 2,
    confirm: true,
    ackNonProduction: false
  }, createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        calls.push(request);
        return { data: [{ id: 1, name: 'never' }] };
      }
    })
  }));

  assert.notStrictEqual(result.exitCode, 0, 'create without --ack-non-production should fail safely');
  assert.strictEqual(calls.length, 0, 'create without --ack-non-production should not send POST requests');
}

async function testPlanPerformsNoHttpWrites() {
  const calls = [];
  const result = await runPlanCommand({
    count: 2
  }, createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        calls.push(request);
        return { data: [] };
      }
    })
  }));

  assert.strictEqual(result.exitCode, 0, 'plan should succeed');
  assert.strictEqual(calls.length, 0, 'plan should not send any HTTP write requests');
}

async function testManifestContainsOnlyAllowedFieldsAndNoSecrets() {
  const manifest = createManifest({
    haloResourceServer: 'https://halo.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 2
  });

  manifest.createdRecords.push({
    sequence: 1,
    haloClientId: 123,
    generatedName: 'A1 Pagination Test 20260722-123456 001',
    createdAt: '2026-07-22T12:35:00.000Z',
    cleanup: {
      attempted: false,
      succeeded: false,
      attemptedAt: '',
      completedAt: '',
      errorCode: '',
      errorMessage: ''
    }
  });
  manifest.failedRecords.push({
    stage: 'create',
    sequence: 2,
    generatedName: 'A1 Pagination Test 20260722-123456 002',
    errorCode: 'http_400',
    errorMessage: 'client_secret=[redacted]'
  });

  const json = JSON.stringify(manifest);
  assert.strictEqual(json.includes('stored-secret-value'), false, 'manifest must not serialize client secrets');
  assert.strictEqual(json.includes('halo-token'), false, 'manifest must not serialize access tokens');
  assert.deepStrictEqual(Object.keys(manifest).sort(), [
    'createdAt',
    'createdRecords',
    'failedRecords',
    'haloResourceServer',
    'requestedCount',
    'runId',
    'schemaVersion',
    'utility'
  ], 'manifest should only contain the expected top-level fields');
}

async function testManifestIsPersistedIncrementallyAndPartialCreateFailurePreservesIds() {
  const tempDir = await makeTempDir();
  const responses = [
    { data: [{ id: 101, name: 'A1 Pagination Test 20260722-123456 001' }] },
    new Error('HTTP 500 bearer halo-token client_secret stored-secret-value')
  ];
  const result = await runCreateCommand({
    count: 2,
    confirm: true,
    ackNonProduction: true
  }, createDeps({
    manifestDir: tempDir,
    authClientFactory: async () => ({
      async requestResource() {
        const next = responses.shift();
        if (next instanceof Error) {
          throw next;
        }
        return next;
      }
    })
  }));

  assert.notStrictEqual(result.exitCode, 0, 'partial create failure should return non-zero');
  const manifest = await readJson(result.manifestPath);
  assert.strictEqual(manifest.createdRecords.length, 1, 'successful create IDs should remain persisted after later failure');
  assert.strictEqual(manifest.createdRecords[0].haloClientId, 101, 'persisted manifest should retain the successful Halo client ID');
  assert.strictEqual(manifest.failedRecords.length, 1, 'manifest should record sanitized failures');
  assert.strictEqual(JSON.stringify(manifest).includes('stored-secret-value'), false, 'persisted manifest should not include secrets');
  assert.strictEqual(JSON.stringify(manifest).includes('halo-token'), false, 'persisted manifest should not include tokens');
}

async function testVerifyComparesExactIdsAgainstPaginatedResults() {
  const tempDir = await makeTempDir();
  const manifestPath = path.join(tempDir, 'verify.json');
  const manifest = createManifest({
    haloResourceServer: 'https://halo.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 2
  });
  manifest.createdRecords.push({
    sequence: 1,
    haloClientId: 101,
    generatedName: 'A1 Pagination Test 20260722-123456 001',
    createdAt: '2026-07-22T12:35:00.000Z',
    cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
  });
  manifest.createdRecords.push({
    sequence: 2,
    haloClientId: 102,
    generatedName: 'A1 Pagination Test 20260722-123456 002',
    createdAt: '2026-07-22T12:35:01.000Z',
    cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
  });
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const result = await runVerifyCommand({
    manifestPath
  }, createDeps({
    discoverClients: async () => ([
      { id: '101', name: 'A1 Pagination Test 20260722-123456 001' },
      { id: '999', name: 'A1 Pagination Test 20260722-123456 002' }
    ])
  }));

  assert.notStrictEqual(result.exitCode, 0, 'verify should fail when an exact manifest ID is missing');
  assert.deepStrictEqual(result.summary.missingIds, [102], 'verify should compare exact manifest IDs, not only name prefixes');
  assert.strictEqual(result.summary.foundCount, 1, 'verify should count only exact ID matches');
  assert.strictEqual(result.summary.totalHaloClientCount, 2, 'verify should surface the total Halo client count when available');
}

async function testCleanupUsesExactDeletePathsFromManifestOnly() {
  const tempDir = await makeTempDir();
  const manifestPath = path.join(tempDir, 'cleanup.json');
  const manifest = createManifest({
    haloResourceServer: 'https://halo.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 2
  });
  for (const [sequence, haloClientId] of [[1, 101], [2, 202]]) {
    manifest.createdRecords.push({
      sequence,
      haloClientId,
      generatedName: `A1 Pagination Test 20260722-123456 ${String(sequence).padStart(3, '0')}`,
      createdAt: '2026-07-22T12:35:00.000Z',
      cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
    });
  }
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const deletePaths = [];
  const result = await runCleanupCommand({
    manifestPath,
    confirm: true,
    ackNonProduction: true,
    dryRun: false
  }, createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        deletePaths.push(`${request.method} ${request.path}`);
        return { data: null };
      }
    })
  }));

  assert.strictEqual(result.exitCode, 0, 'cleanup should succeed when all manifest IDs are deleted');
  assert.deepStrictEqual(deletePaths, ['DELETE /Client/101', 'DELETE /Client/202'], 'cleanup should use only exact manifest IDs in DELETE paths');
}

async function testCleanupDryRunAndMissingFlagsSendNoDeletes() {
  const tempDir = await makeTempDir();
  const manifestPath = path.join(tempDir, 'cleanup-dry-run.json');
  const manifest = createManifest({
    haloResourceServer: 'https://halo.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 1
  });
  manifest.createdRecords.push({
    sequence: 1,
    haloClientId: 101,
    generatedName: 'A1 Pagination Test 20260722-123456 001',
    createdAt: '2026-07-22T12:35:00.000Z',
    cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
  });
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const deletePaths = [];
  const deps = createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        deletePaths.push(`${request.method} ${request.path}`);
        return { data: null };
      }
    })
  });

  const dryRunResult = await runCleanupCommand({
    manifestPath,
    dryRun: true,
    confirm: false,
    ackNonProduction: false
  }, deps);
  const missingFlagsResult = await runCleanupCommand({
    manifestPath,
    dryRun: false,
    confirm: false,
    ackNonProduction: false
  }, deps);

  assert.strictEqual(dryRunResult.exitCode, 0, 'cleanup dry-run should succeed without sending deletes');
  assert.notStrictEqual(missingFlagsResult.exitCode, 0, 'cleanup without required safety flags should fail safely');
  assert.strictEqual(deletePaths.length, 0, 'cleanup dry-run and missing flags should not send DELETE requests');
}

async function testCleanupRejectsInvalidIdsBeforeHttpAndRejectsMalformedManifests() {
  const tempDir = await makeTempDir();
  const invalidManifestPath = path.join(tempDir, 'invalid-id.json');
  const malformedManifestPath = path.join(tempDir, 'malformed.json');
  const invalidManifest = createManifest({
    haloResourceServer: 'https://halo.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 1
  });
  invalidManifest.createdRecords.push({
    sequence: 1,
    haloClientId: 'not-an-int',
    generatedName: 'A1 Pagination Test 20260722-123456 001',
    createdAt: '2026-07-22T12:35:00.000Z',
    cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
  });
  await fsp.writeFile(invalidManifestPath, JSON.stringify(invalidManifest, null, 2));
  await fsp.writeFile(malformedManifestPath, JSON.stringify({ schemaVersion: 999 }, null, 2));

  const deletePaths = [];
  const deps = createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        deletePaths.push(`${request.method} ${request.path}`);
        return { data: null };
      }
    })
  });

  const invalidIdResult = await runCleanupCommand({
    manifestPath: invalidManifestPath,
    confirm: true,
    ackNonProduction: true,
    dryRun: false
  }, deps);
  const malformedResult = await runCleanupCommand({
    manifestPath: malformedManifestPath,
    confirm: true,
    ackNonProduction: true,
    dryRun: false
  }, deps);

  assert.notStrictEqual(invalidIdResult.exitCode, 0, 'cleanup should reject invalid manifest IDs before HTTP');
  assert.notStrictEqual(malformedResult.exitCode, 0, 'cleanup should reject malformed manifests safely');
  assert.strictEqual(deletePaths.length, 0, 'invalid manifests should not trigger DELETE requests');
}

async function testCleanupPersistsIncrementallySkipsSuccessfulDeletesAndPreservesFailures() {
  const tempDir = await makeTempDir();
  const manifestPath = path.join(tempDir, 'cleanup-retry.json');
  const manifest = createManifest({
    haloResourceServer: 'https://halo.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 2
  });
  for (const [sequence, haloClientId] of [[1, 101], [2, 202]]) {
    manifest.createdRecords.push({
      sequence,
      haloClientId,
      generatedName: `A1 Pagination Test 20260722-123456 ${String(sequence).padStart(3, '0')}`,
      createdAt: '2026-07-22T12:35:00.000Z',
      cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
    });
  }
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const deletePaths = [];
  let firstRun = true;
  const deps = createDeps({
    manifestDir: tempDir,
    authClientFactory: async () => ({
      async requestResource(request) {
        deletePaths.push(`${request.method} ${request.path}`);
        if (firstRun && request.path.endsWith('/202')) {
          throw new Error('HTTP 500 bearer halo-token client_secret stored-secret-value');
        }
        return { data: null };
      }
    })
  });

  const firstResult = await runCleanupCommand({
    manifestPath,
    confirm: true,
    ackNonProduction: true,
    dryRun: false
  }, deps);
  firstRun = false;
  const firstManifest = await readJson(manifestPath);
  assert.notStrictEqual(firstResult.exitCode, 0, 'partial cleanup failure should return non-zero');
  assert.strictEqual(firstManifest.createdRecords[0].cleanup.succeeded, true, 'successful deletion should be persisted incrementally');
  assert.strictEqual(firstManifest.createdRecords[1].cleanup.succeeded, false, 'failed deletion should remain pending');
  assert.strictEqual(firstManifest.createdRecords[1].cleanup.attempted, true, 'failed deletion should record that cleanup was attempted');
  assert.strictEqual(JSON.stringify(firstManifest).includes('stored-secret-value'), false, 'cleanup failure summaries should stay sanitized');

  deletePaths.length = 0;
  const secondResult = await runCleanupCommand({
    manifestPath,
    confirm: true,
    ackNonProduction: true,
    dryRun: false
  }, deps);

  assert.strictEqual(secondResult.exitCode, 0, 'cleanup rerun should succeed after only retrying pending IDs');
  assert.deepStrictEqual(deletePaths, ['DELETE /Client/202'], 'cleanup rerun should skip IDs already deleted successfully');
}

async function testCleanupRejectsResourceServerMismatchSafely() {
  const tempDir = await makeTempDir();
  const manifestPath = path.join(tempDir, 'mismatch.json');
  const manifest = createManifest({
    haloResourceServer: 'https://other.example.com/api',
    runId: '20260722-123456',
    createdAt: '2026-07-22T12:34:56.000Z',
    requestedCount: 1
  });
  manifest.createdRecords.push({
    sequence: 1,
    haloClientId: 101,
    generatedName: 'A1 Pagination Test 20260722-123456 001',
    createdAt: '2026-07-22T12:35:00.000Z',
    cleanup: { attempted: false, succeeded: false, attemptedAt: '', completedAt: '', errorCode: '', errorMessage: '' }
  });
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const calls = [];
  const result = await runCleanupCommand({
    manifestPath,
    confirm: true,
    ackNonProduction: true,
    dryRun: false
  }, createDeps({
    authClientFactory: async () => ({
      async requestResource(request) {
        calls.push(request);
        return { data: null };
      }
    })
  }));

  assert.notStrictEqual(result.exitCode, 0, 'cleanup should reject resource-server mismatches safely');
  assert.strictEqual(calls.length, 0, 'resource-server mismatch should be rejected before any DELETE request');
}

async function testManualUtilityIsNotIncludedInNormalDotTestRunner() {
  const testDir = path.join(process.cwd(), 'integrations', 'halo-psa', 'tests');
  const matched = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.js'));
  assert.strictEqual(matched.includes('haloClientTestData.manual.js'), false, 'manual utility should not be included in the normal *.test.js runner');
}

async function run() {
  await testGeneratedNamesAreUniqueAndZeroPadded();
  await testCountHasSafeDefaultAndMaximum();
  await testCreateRefusesWritesWithoutConfirm();
  await testCreateRefusesWritesWithoutAckNonProduction();
  await testPlanPerformsNoHttpWrites();
  await testManifestContainsOnlyAllowedFieldsAndNoSecrets();
  await testManifestIsPersistedIncrementallyAndPartialCreateFailurePreservesIds();
  await testVerifyComparesExactIdsAgainstPaginatedResults();
  await testCleanupUsesExactDeletePathsFromManifestOnly();
  await testCleanupDryRunAndMissingFlagsSendNoDeletes();
  await testCleanupRejectsInvalidIdsBeforeHttpAndRejectsMalformedManifests();
  await testCleanupPersistsIncrementallySkipsSuccessfulDeletesAndPreservesFailures();
  await testCleanupRejectsResourceServerMismatchSafely();
  await testManualUtilityIsNotIncludedInNormalDotTestRunner();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
