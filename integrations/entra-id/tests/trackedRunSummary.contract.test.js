const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadTrackedRunSummary() {
  return import(pathToFileURL(path.join(__dirname, '..', 'trackedRunSummary.mjs')).href);
}

function buildEmbeddedPayload(overrides = {}) {
  return {
    summary: {
      mappedAction1OrganizationsProcessed: 7,
      finalStatus: 'Success',
      trigger: 'manual',
      endpointsSynchronized: 1,
      skipped: 76,
      failedEndpointUpdates: 0,
      ...overrides.summary
    },
    diagnostics: {
      stage: 'result_aggregation',
      code: 'sync_completed',
      ...overrides.diagnostics
    },
    results: overrides.results || [
      {
        organizationName: 'Org One',
        patchesApplied: 1
      }
    ]
  };
}

async function run() {
  const { extractTrackedRunSummary } = await loadTrackedRunSummary();

  const objectDetails = {
    details: {
      summary: {
        finalStatus: 'Success',
        trigger: 'manual',
        endpointsSynchronized: 1,
        skipped: 76,
        failedEndpointUpdates: 0
      }
    }
  };
  assert.strictEqual(extractTrackedRunSummary(objectDetails).summary.skipped, 76, 'tracked run summary should continue to support wrapped object details.summary payloads');

  const pureJsonDetails = JSON.stringify(buildEmbeddedPayload());
  assert.strictEqual(extractTrackedRunSummary(pureJsonDetails).summary.finalStatus, 'Success', 'tracked run summary should continue to support pure JSON details payloads');

  const multilineDetails = [
    'Started Run Entra Sync',
    '21:27:49 - {"trigger":"manual"}',
    '21:27:49 - {"stage":"organization_mappings","count":7}',
    `21:27:50 - ${JSON.stringify(buildEmbeddedPayload())}`
  ].join('\n');
  const multilineSummary = extractTrackedRunSummary(multilineDetails);
  assert.strictEqual(multilineSummary.summary.mappedAction1OrganizationsProcessed, 7, 'tracked run summary should recover organizations processed from the final embedded JSON payload');
  assert.strictEqual(multilineSummary.summary.endpointsSynchronized, 1, 'tracked run summary should recover synchronized totals from the final embedded JSON payload');
  assert.strictEqual(multilineSummary.summary.skipped, 76, 'tracked run summary should recover skipped totals from the final embedded JSON payload');
  assert.strictEqual(multilineSummary.summary.failedEndpointUpdates, 0, 'tracked run summary should recover failed endpoint update totals from the final embedded JSON payload');
  assert.strictEqual(multilineSummary.summary.trigger, 'manual', 'tracked run summary should recover the persisted trigger from the final embedded JSON payload');
  assert.strictEqual(multilineSummary.finishedAt, '', 'tracked run summary should not derive finished timestamps from log-line prefixes');

  const diagnosticsOnlyDetails = [
    'Started Run Entra Sync',
    `21:27:50 - ${JSON.stringify({
      diagnostics: {
        stage: 'result_aggregation',
        code: 'sync_completed'
      },
      results: []
    })}`
  ].join('\n');
  assert.deepStrictEqual(extractTrackedRunSummary(diagnosticsOnlyDetails).summary, {}, 'tracked run summary should not invent a summary when the embedded payload contains diagnostics/results but no summary');

  const malformedMultilineDetails = [
    'Started Run Entra Sync',
    '21:27:49 - {"trigger":"manual"}',
    '21:27:50 - {not-json'
  ].join('\n');
  assert.deepStrictEqual(extractTrackedRunSummary(malformedMultilineDetails).summary, {}, 'tracked run summary should fall back safely when multiline details have no valid structured result payload');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
