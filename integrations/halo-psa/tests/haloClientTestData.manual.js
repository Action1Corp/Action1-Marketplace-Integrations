const fs = require('fs/promises');
const path = require('path');

const {
  createHaloAuthClient,
  discoverHaloClients,
  loadSettings,
  missingRequiredSettings,
  requestToken,
  sanitizeMessage,
  trimValue,
  truncateExcerpt
} = require('../haloApi');

const DEFAULT_COUNT = 120;
const MAX_COUNT = 500;
const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_UTILITY_NAME = 'haloClientTestData.manual';
const MANIFEST_DIR = path.resolve(__dirname, '..', '.runtime-logs', 'manual-client-test-data');

function parseCount(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return DEFAULT_COUNT;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Count must be a positive integer.');
  }
  if (parsed > MAX_COUNT) {
    throw new Error(`Count exceeds the safe maximum of ${MAX_COUNT}.`);
  }
  return parsed;
}

function formatSequence(sequence) {
  return String(sequence).padStart(3, '0');
}

function formatRunId(input) {
  const value = input instanceof Date ? input : new Date(input);
  const yyyy = String(value.getUTCFullYear());
  const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(value.getUTCDate()).padStart(2, '0');
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const min = String(value.getUTCMinutes()).padStart(2, '0');
  const ss = String(value.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function buildGeneratedName(runId, sequence) {
  return `A1 Pagination Test ${runId} ${formatSequence(sequence)}`;
}

function buildPlan({ count, now = new Date() }) {
  const safeCount = parseCount(count);
  const current = now instanceof Date ? now : new Date(now);
  const runId = formatRunId(current);
  return {
    runId,
    createdAt: current.toISOString(),
    records: Array.from({ length: safeCount }, (_, index) => ({
      sequence: index + 1,
      generatedName: buildGeneratedName(runId, index + 1)
    }))
  };
}

function getManifestFilePath(manifestDir, runId) {
  return path.resolve(manifestDir || MANIFEST_DIR, `${runId}.json`);
}

function createManifest({ haloResourceServer, runId, createdAt, requestedCount }) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    utility: MANIFEST_UTILITY_NAME,
    haloResourceServer: sanitizeResourceServerIdentifier(haloResourceServer),
    runId: trimValue(runId),
    createdAt: trimValue(createdAt),
    requestedCount: parseCount(requestedCount),
    createdRecords: [],
    failedRecords: []
  };
}

function createCleanupState(overrides = {}) {
  return {
    attempted: false,
    succeeded: false,
    attemptedAt: '',
    completedAt: '',
    errorCode: '',
    errorMessage: '',
    ...overrides
  };
}

function createCreatedRecord({ sequence, haloClientId, generatedName, createdAt }) {
  const normalizedId = normalizePositiveInteger(haloClientId);
  if (!normalizedId) {
    throw new Error('Halo client ID must be a positive integer.');
  }

  return {
    sequence: normalizePositiveInteger(sequence),
    haloClientId: normalizedId,
    generatedName: trimValue(generatedName),
    createdAt: trimValue(createdAt),
    cleanup: createCleanupState()
  };
}

function createFailureRecord({ stage, sequence, generatedName, errorCode, errorMessage }) {
  return {
    stage: trimValue(stage),
    sequence: normalizePositiveInteger(sequence) || 0,
    generatedName: trimValue(generatedName),
    errorCode: trimValue(errorCode),
    errorMessage: trimValue(errorMessage)
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function sanitizeResourceServerIdentifier(value) {
  const trimmed = trimValue(value).replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return trimmed;
  }
}

function summarizeError(error, fallbackCode = 'manual_client_test_data_error') {
  const statusCode = normalizePositiveInteger(error?.statusCode);
  const code = trimValue(error?.code) || (statusCode ? `http_${statusCode}` : fallbackCode);
  const detail = trimValue(error?.safeDetail)
    || trimValue(error?.message)
    || truncateExcerpt(JSON.stringify(error?.responsePayload || {}))
    || 'Request failed.';
  return {
    errorCode: sanitizeMessage(code) || fallbackCode,
    errorMessage: sanitizeMessage(detail) || 'Request failed.'
  };
}

function buildMinimalCreatePayload(generatedName) {
  return [{ name: trimValue(generatedName) }];
}

function createEnvironmentSettingsLoader(env = process.env) {
  return async function loadSettingsFromEnvironment() {
    return loadSettings({
      settings: {
        async get(key) {
          return key in env ? String(env[key] || '') : '';
        }
      }
    }, { settings: {} });
  };
}

async function writeManifest(manifestPath, manifest, deps = {}) {
  const fsImpl = deps.fs || fs;
  await fsImpl.mkdir(path.dirname(manifestPath), { recursive: true });
  await fsImpl.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

async function readManifest(manifestPath, deps = {}) {
  const fsImpl = deps.fs || fs;
  const raw = await fsImpl.readFile(path.resolve(manifestPath), 'utf8');
  return validateManifest(JSON.parse(raw));
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be a JSON object.');
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Manifest schemaVersion must be ${MANIFEST_SCHEMA_VERSION}.`);
  }
  if (trimValue(manifest.utility) !== MANIFEST_UTILITY_NAME) {
    throw new Error(`Manifest utility must be ${MANIFEST_UTILITY_NAME}.`);
  }
  if (!trimValue(manifest.haloResourceServer)) {
    throw new Error('Manifest haloResourceServer is required.');
  }
  if (!trimValue(manifest.runId)) {
    throw new Error('Manifest runId is required.');
  }
  if (!trimValue(manifest.createdAt)) {
    throw new Error('Manifest createdAt is required.');
  }
  if (!Number.isInteger(Number(manifest.requestedCount)) || Number(manifest.requestedCount) < 1 || Number(manifest.requestedCount) > MAX_COUNT) {
    throw new Error(`Manifest requestedCount must be an integer between 1 and ${MAX_COUNT}.`);
  }
  if (!Array.isArray(manifest.createdRecords)) {
    throw new Error('Manifest createdRecords must be an array.');
  }
  if (!Array.isArray(manifest.failedRecords)) {
    throw new Error('Manifest failedRecords must be an array.');
  }

  for (const record of manifest.createdRecords) {
    if (!Number.isInteger(Number(record?.sequence)) || Number(record.sequence) < 1) {
      throw new Error('Manifest createdRecords.sequence must be a positive integer.');
    }
    if (!normalizePositiveInteger(record?.haloClientId)) {
      throw new Error('Manifest createdRecords.haloClientId must be a positive integer.');
    }
    if (!trimValue(record?.generatedName)) {
      throw new Error('Manifest createdRecords.generatedName is required.');
    }
    if (!trimValue(record?.createdAt)) {
      throw new Error('Manifest createdRecords.createdAt is required.');
    }
    if (!record.cleanup || typeof record.cleanup !== 'object') {
      throw new Error('Manifest createdRecords.cleanup is required.');
    }
    if (typeof record.cleanup.attempted !== 'boolean' || typeof record.cleanup.succeeded !== 'boolean') {
      throw new Error('Manifest cleanup attempted/succeeded fields must be booleans.');
    }
  }

  return manifest;
}

function ensureMatchingResourceServer(manifest, settings) {
  const expected = sanitizeResourceServerIdentifier(settings?.HaloPsaResourceServer);
  const actual = sanitizeResourceServerIdentifier(manifest?.haloResourceServer);
  if (!expected || !actual || expected !== actual) {
    throw new Error('Manifest Halo resource-server identifier does not match the current Halo configuration.');
  }
}

function ensureRequiredSettings(settings) {
  const missing = missingRequiredSettings(settings);
  if (missing.length > 0) {
    throw new Error(`Missing required Halo settings: ${missing.join(', ')}`);
  }
}

function extractCreatedClient(data) {
  const candidates = [];
  if (Array.isArray(data)) {
    candidates.push(data[0]);
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.clients)) candidates.push(data.clients[0]);
    if (Array.isArray(data.value)) candidates.push(data.value[0]);
    candidates.push(data);
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const id = normalizePositiveInteger(candidate.id ?? candidate.client_id);
    if (!id) continue;
    const returnedName = trimValue(candidate.name || candidate.client_name);
    return { haloClientId: id, returnedName };
  }

  throw new Error('Halo create response did not include a positive integer client ID.');
}

function getPendingCleanupRecords(manifest) {
  return manifest.createdRecords.filter((record) => !record.cleanup?.succeeded);
}

function applyCleanupResult(record, result) {
  record.cleanup = createCleanupState({
    attempted: true,
    attemptedAt: trimValue(result.attemptedAt),
    succeeded: Boolean(result.succeeded),
    completedAt: trimValue(result.completedAt),
    errorCode: trimValue(result.errorCode),
    errorMessage: trimValue(result.errorMessage)
  });
}

function hasWriteSafetyFlags(options) {
  return Boolean(options?.confirm && options?.ackNonProduction);
}

function createDefaultAuthClientFactory() {
  return async function authClientFactory({ settings }) {
    return createHaloAuthClient({
      connectionProvider: {
        resourceServer: settings.HaloPsaResourceServer,
        authorisationServer: settings.HaloPsaAuthorisationServer,
        clientId: settings.HaloPsaClientId,
        clientSecret: settings.HaloPsaClientSecret
      }
    });
  };
}

async function emitLines(lines, print) {
  if (typeof print !== 'function') {
    return;
  }
  for (const line of lines) {
    await print(line);
  }
}

function getNowDate(nowProvider) {
  if (typeof nowProvider === 'function') {
    const value = nowProvider();
    return value instanceof Date ? value : new Date(value);
  }
  if (nowProvider instanceof Date) {
    return nowProvider;
  }
  return new Date();
}

async function runPlanCommand(options = {}, deps = {}) {
  const plan = buildPlan({
    count: options.count,
    now: getNowDate(deps.now)
  });
  const manifestPath = getManifestFilePath(deps.manifestDir || MANIFEST_DIR, plan.runId);
  const lines = [
    'NON-PRODUCTION USE ONLY',
    `Planned client count: ${plan.records.length}`,
    `Planned manifest path: ${manifestPath}`,
    ...plan.records.map((record) => `PLAN ${record.sequence}: ${record.generatedName}`)
  ];
  await emitLines(lines, deps.print);
  return { exitCode: 0, manifestPath, plan, lines };
}

async function runCreateCommand(options = {}, deps = {}) {
  let plan;
  let manifestPath = '';
  try {
    plan = buildPlan({
      count: options.count,
      now: getNowDate(deps.now)
    });
    manifestPath = getManifestFilePath(deps.manifestDir || MANIFEST_DIR, plan.runId);

    if (!hasWriteSafetyFlags(options)) {
      const result = await runPlanCommand({ count: plan.records.length }, {
        ...deps,
        now: () => new Date(plan.createdAt)
      });
      return {
        ...result,
        exitCode: 2,
        reason: 'missing_safety_flags'
      };
    }

    const loadCliSettings = deps.loadSettings || createEnvironmentSettingsLoader(deps.env || process.env);
    const settings = await loadCliSettings();
    ensureRequiredSettings(settings);

    const manifest = createManifest({
      haloResourceServer: settings.HaloPsaResourceServer,
      runId: plan.runId,
      createdAt: plan.createdAt,
      requestedCount: plan.records.length
    });
    await writeManifest(manifestPath, manifest, deps);

    const authClientFactory = deps.authClientFactory || createDefaultAuthClientFactory();
    const authClient = await authClientFactory({ settings });
    let failures = 0;

    for (const record of plan.records) {
      try {
        const response = await authClient.requestResource({
          method: 'POST',
          path: '/Client',
          body: buildMinimalCreatePayload(record.generatedName),
          runId: `halo-manual-client-create-${formatSequence(record.sequence)}`,
          maxAttempts: 1,
          timeoutMs: 30000
        });
        const created = extractCreatedClient(response?.data);
        if (manifest.createdRecords.some((row) => row.haloClientId === created.haloClientId)) {
          throw new Error('Halo create response reused a client ID already recorded in this manifest.');
        }

        manifest.createdRecords.push(createCreatedRecord({
          sequence: record.sequence,
          haloClientId: created.haloClientId,
          generatedName: record.generatedName,
          createdAt: getNowDate(deps.now).toISOString()
        }));

        if (created.returnedName && created.returnedName !== record.generatedName) {
          manifest.failedRecords.push(createFailureRecord({
            stage: 'create-response-validation',
            sequence: record.sequence,
            generatedName: record.generatedName,
            errorCode: 'returned_name_mismatch',
            errorMessage: `Halo returned a different client name: ${sanitizeMessage(created.returnedName)}`
          }));
          failures += 1;
        }

        await writeManifest(manifestPath, manifest, deps);
      } catch (error) {
        const summary = summarizeError(error, 'halo_client_create_failed');
        manifest.failedRecords.push(createFailureRecord({
          stage: 'create',
          sequence: record.sequence,
          generatedName: record.generatedName,
          ...summary
        }));
        failures += 1;
        await writeManifest(manifestPath, manifest, deps);
      }
    }

    const lines = [
      'NON-PRODUCTION USE ONLY',
      `Manifest path: ${manifestPath}`,
      `Requested client count: ${plan.records.length}`,
      `Created client count: ${manifest.createdRecords.length}`,
      `Create failure count: ${manifest.failedRecords.length}`
    ];
    await emitLines(lines, deps.print);
    return {
      exitCode: failures === 0 && manifest.createdRecords.length === plan.records.length ? 0 : 1,
      manifestPath,
      manifest
    };
  } catch (error) {
    const summary = summarizeError(error, 'halo_client_create_command_failed');
    await emitLines([
      'NON-PRODUCTION USE ONLY',
      summary.errorMessage
    ], deps.print);
    return { exitCode: 1, manifestPath, error: summary };
  }
}

async function runVerifyCommand(options = {}, deps = {}) {
  try {
    if (!trimValue(options.manifestPath)) {
      throw new Error('verify requires --manifest <path>.');
    }

    const manifest = await readManifest(options.manifestPath, deps);
    const loadCliSettings = deps.loadSettings || createEnvironmentSettingsLoader(deps.env || process.env);
    const settings = await loadCliSettings();
    ensureRequiredSettings(settings);
    ensureMatchingResourceServer(manifest, settings);

    const token = await (deps.requestToken || requestToken)(settings);
    const clients = await (deps.discoverClients || discoverHaloClients)(settings, token);
    const discoveredById = new Map(clients.map((row) => [normalizePositiveInteger(row.id), trimValue(row.name)]));

    const missingIds = [];
    const nameMismatches = [];
    let foundCount = 0;

    for (const record of manifest.createdRecords) {
      const actualName = discoveredById.get(record.haloClientId);
      if (!actualName) {
        missingIds.push(record.haloClientId);
        continue;
      }
      foundCount += 1;
      if (actualName !== record.generatedName) {
        nameMismatches.push({
          haloClientId: record.haloClientId,
          expectedName: record.generatedName,
          actualName
        });
      }
    }

    const summary = {
      expectedGeneratedCount: manifest.createdRecords.length,
      foundCount,
      missingIds,
      nameMismatches,
      totalHaloClientCount: Array.isArray(clients) ? clients.length : 0
    };

    const lines = [
      'NON-PRODUCTION USE ONLY',
      `Manifest path: ${path.resolve(options.manifestPath)}`,
      `Expected generated client count: ${summary.expectedGeneratedCount}`,
      `Found generated client count: ${summary.foundCount}`,
      `Missing generated client IDs: ${summary.missingIds.join(', ') || 'none'}`,
      `Generated client name mismatches: ${summary.nameMismatches.length}`,
      `Total Halo client count: ${summary.totalHaloClientCount}`
    ];
    await emitLines(lines, deps.print);
    return {
      exitCode: summary.missingIds.length === 0 && summary.nameMismatches.length === 0 ? 0 : 1,
      summary
    };
  } catch (error) {
    const summary = summarizeError(error, 'halo_client_verify_failed');
    await emitLines([
      'NON-PRODUCTION USE ONLY',
      summary.errorMessage
    ], deps.print);
    return { exitCode: 1, error: summary };
  }
}

async function runCleanupCommand(options = {}, deps = {}) {
  let manifestPath = '';
  try {
    if (!trimValue(options.manifestPath)) {
      throw new Error('cleanup requires --manifest <path>.');
    }

    manifestPath = path.resolve(options.manifestPath);
    const manifest = await readManifest(manifestPath, deps);
    const pending = getPendingCleanupRecords(manifest);

    if (options.dryRun) {
      const lines = [
        'NON-PRODUCTION USE ONLY',
        `Cleanup manifest path: ${manifestPath}`,
        `Pending cleanup count: ${pending.length}`,
        ...pending.map((record) => `DELETE ${record.haloClientId}: ${record.generatedName}`)
      ];
      await emitLines(lines, deps.print);
      return { exitCode: 0, manifest, pending };
    }

    if (!hasWriteSafetyFlags(options)) {
      const lines = [
        'NON-PRODUCTION USE ONLY',
        'Cleanup requires both --confirm and --ack-non-production.',
        `Pending cleanup count: ${pending.length}`,
        ...pending.map((record) => `DELETE ${record.haloClientId}: ${record.generatedName}`)
      ];
      await emitLines(lines, deps.print);
      return { exitCode: 2, manifest, pending, reason: 'missing_safety_flags' };
    }

    for (const record of manifest.createdRecords) {
      if (!normalizePositiveInteger(record.haloClientId)) {
        throw new Error('Manifest contains an invalid Halo client ID.');
      }
    }

    const loadCliSettings = deps.loadSettings || createEnvironmentSettingsLoader(deps.env || process.env);
    const settings = await loadCliSettings();
    ensureRequiredSettings(settings);
    ensureMatchingResourceServer(manifest, settings);

    const authClientFactory = deps.authClientFactory || createDefaultAuthClientFactory();
    const authClient = await authClientFactory({ settings });
    let failures = 0;

    for (const record of pending) {
      const attemptedAt = getNowDate(deps.now).toISOString();
      try {
        await authClient.requestResource({
          method: 'DELETE',
          path: `/Client/${record.haloClientId}`,
          runId: `halo-manual-client-cleanup-${record.haloClientId}`,
          maxAttempts: 1,
          timeoutMs: 30000
        });
        applyCleanupResult(record, {
          attemptedAt,
          succeeded: true,
          completedAt: getNowDate(deps.now).toISOString(),
          errorCode: '',
          errorMessage: ''
        });
        await writeManifest(manifestPath, manifest, deps);
      } catch (error) {
        const summary = summarizeError(error, 'halo_client_cleanup_failed');
        applyCleanupResult(record, {
          attemptedAt,
          succeeded: false,
          completedAt: '',
          ...summary
        });
        failures += 1;
        await writeManifest(manifestPath, manifest, deps);
      }
    }

    const lines = [
      'NON-PRODUCTION USE ONLY',
      `Cleanup manifest path: ${manifestPath}`,
      `Cleanup attempted count: ${pending.length}`,
      `Cleanup succeeded count: ${pending.filter((record) => record.cleanup.succeeded).length}`,
      `Cleanup failed count: ${pending.filter((record) => record.cleanup.attempted && !record.cleanup.succeeded).length}`
    ];
    await emitLines(lines, deps.print);
    return {
      exitCode: failures === 0 ? 0 : 1,
      manifest,
      pending
    };
  } catch (error) {
    const summary = summarizeError(error, 'halo_client_cleanup_command_failed');
    await emitLines([
      'NON-PRODUCTION USE ONLY',
      `Cleanup manifest path: ${manifestPath || trimValue(options.manifestPath) || 'unknown'}`,
      summary.errorMessage,
      'Exact client IDs remain available in the manifest for manual Halo cleanup.'
    ], deps.print);
    return { exitCode: 1, manifestPath, error: summary };
  }
}

function parseCliArguments(argv) {
  const [command = '', ...rest] = Array.isArray(argv) ? argv : [];
  const options = {
    command: trimValue(command),
    count: undefined,
    manifestPath: '',
    confirm: false,
    ackNonProduction: false,
    dryRun: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = String(rest[index]);
    if (token === '--count') {
      index += 1;
      options.count = rest[index];
      continue;
    }
    if (token === '--manifest') {
      index += 1;
      options.manifestPath = rest[index] || '';
      continue;
    }
    if (token === '--confirm') {
      options.confirm = true;
      continue;
    }
    if (token === '--ack-non-production') {
      options.ackNonProduction = true;
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

async function runCli(argv = process.argv.slice(2), deps = {}) {
  const options = parseCliArguments(argv);
  const print = deps.print || ((line) => console.log(line));
  const mergedDeps = { ...deps, print };

  switch (options.command) {
    case 'plan':
      return runPlanCommand(options, mergedDeps);
    case 'create':
      return runCreateCommand(options, mergedDeps);
    case 'verify':
      return runVerifyCommand(options, mergedDeps);
    case 'cleanup':
      return runCleanupCommand(options, mergedDeps);
    default:
      throw new Error('Usage: node integrations/halo-psa/tests/haloClientTestData.manual.js <plan|create|verify|cleanup> [options]');
  }
}

if (require.main === module) {
  runCli().then((result) => {
    process.exit(Number(result?.exitCode || 0));
  }).catch((error) => {
    console.error(sanitizeMessage(error?.message || String(error)));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_COUNT,
  MAX_COUNT,
  MANIFEST_DIR,
  MANIFEST_SCHEMA_VERSION,
  buildGeneratedName,
  buildMinimalCreatePayload,
  buildPlan,
  createManifest,
  formatRunId,
  getManifestFilePath,
  parseCount,
  parseCliArguments,
  readManifest,
  runCleanupCommand,
  runCli,
  runCreateCommand,
  runPlanCommand,
  runVerifyCommand,
  sanitizeResourceServerIdentifier,
  summarizeError,
  validateManifest
};
