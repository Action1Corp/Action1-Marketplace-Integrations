const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadHistoryViewModel() {
  return import(pathToFileURL(path.join(__dirname, '..', 'historyViewModel.mjs')).href);
}

async function run() {
  const historyViewModel = await loadHistoryViewModel();

  assert.strictEqual(historyViewModel.TIMESTAMP_LABEL, 'STARTED', 'Entra History should label the persisted Marketplace timestamp as STARTED');

  const rows = historyViewModel.buildHistoryRows([
    {
      id: 101,
      timestamp: '2026-07-15T10:15:00.000Z',
      status: 'Success',
      action_id: 'sync',
      details: JSON.stringify({
        summary: {
          finalStatus: 'Success',
          endpointsSynchronized: 6,
          skipped: 4,
          failedEndpointUpdates: 1
        }
      })
    },
    {
      id: 103,
      timestamp: '2026-07-15T10:45:00.000Z',
      status: 'Success',
      action_label: 'Run Entra Sync',
      details: {
        details: {
          summary: {
            finalStatus: 'Success',
            endpointsSynchronized: 1,
            skipped: 76,
            failedEndpointUpdates: 0
          }
        }
      }
    },
    {
      id: 102,
      timestamp: '2026-07-15T11:15:00.000Z',
      status: 'Running',
      action_id: 'sync',
      details: ''
    },
    {
      id: 104,
      timestamp: '2026-07-15T11:30:00.000Z',
      status: 'Failure',
      action_id: 'sync',
      details: '{not-json'
    },
    {
      id: 105,
      timestamp: '2026-07-15T12:00:00.000Z',
      status: 'Success',
      action_id: 'sync',
      details: [
        'Started Run Entra Sync',
        '21:27:49 - {"trigger":"manual"}',
        '21:27:49 - {"stage":"organization_mappings","count":7}',
        `21:27:50 - ${JSON.stringify({
          summary: {
            finalStatus: 'Success',
            trigger: 'manual',
            mappedAction1OrganizationsProcessed: 7,
            endpointsSynchronized: 1,
            skipped: 76,
            failedEndpointUpdates: 0
          },
          diagnostics: {
            stage: 'result_aggregation',
            code: 'sync_completed'
          },
          results: [
            {
              organizationName: 'Org One',
              patchesApplied: 1
            }
          ]
        })}`
      ].join('\n')
    },
    {
      id: 107,
      timestamp: '2026-07-15T12:05:00.000Z',
      status: 'Success',
      action_id: 'sync',
      details: [
        'Started Run Entra Sync',
        '21:29:10 - {"trigger":"manual"}',
        `21:29:11 - ${JSON.stringify({
          summary: {
            finalStatus: 'CompletedWithIssues',
            trigger: 'manual',
            mappedAction1OrganizationsProcessed: 7,
            endpointsSynchronized: 0,
            skipped: 76,
            failedEndpointUpdates: 1
          },
          diagnostics: {
            stage: 'result_aggregation',
            code: 'sync_completed_with_issues'
          },
          results: [
            {
              organizationName: 'Org One',
              patchErrors: 1
            }
          ]
        })}`
      ].join('\n')
    },
    {
      id: 106,
      timestamp: '2026-07-15T12:10:00.000Z',
      status: 'Failed',
      action_id: 'sync',
      details: [
        'Started Run Entra Sync',
        '21:32:10 - {"trigger":"manual"}',
        `21:32:11 - ${JSON.stringify({
          summary: {
            finalStatus: 'Failure',
            trigger: 'manual',
            mappedAction1OrganizationsProcessed: 7,
            endpointsSynchronized: 0,
            skipped: 76,
            failedEndpointUpdates: 1
          },
          diagnostics: {
            stage: 'endpoint_update',
            code: 'sync_failed'
          },
          results: [
            {
              organizationName: 'Org One',
              patchErrors: 1
            }
          ]
        })}`
      ].join('\n')
    }
  ]);

  assert.strictEqual(rows.length, 7, 'history view model should preserve Marketplace history rows');
  assert.strictEqual(rows[0].result, 'Success', 'Entra History should prefer the persisted finalStatus summary when present');
  assert.strictEqual(rows[0].detailsLabel, '—', 'successful rows without issues should not expose a Details control');
  assert.strictEqual(rows[0].endpointsSynchronized, 6, 'Entra History should map the persisted synchronized counter directly');
  assert.strictEqual(rows[0].skipped, 4, 'Entra History should map the persisted skipped counter directly');
  assert.strictEqual(rows[0].failedEndpointUpdates, 1, 'Entra History should map the persisted failed endpoint updates counter directly');
  assert.strictEqual(rows[1].endpointsSynchronized, 1, 'Entra History should recover wrapped Marketplace details.summary counters');
  assert.strictEqual(rows[1].skipped, 76, 'Entra History should recover wrapped Marketplace skipped counters');
  assert.strictEqual(rows[1].failedEndpointUpdates, 0, 'Entra History should recover wrapped Marketplace failed counters');
  assert.strictEqual(rows[2].result, 'Running', 'Entra History should still render active tracked runs when no final summary exists yet');
  assert.strictEqual(rows[3].result, 'Failure', 'Entra History should fall back safely to row status when details are malformed');
  assert.strictEqual(rows[4].result, 'Success', 'Entra History should render Success from multiline Marketplace details');
  assert.strictEqual(rows[4].endpointsSynchronized, 1, 'Entra History should recover synced totals from multiline Marketplace details');
  assert.strictEqual(rows[4].skipped, 76, 'Entra History should recover skipped totals from multiline Marketplace details');
  assert.strictEqual(rows[4].failedEndpointUpdates, 0, 'Entra History should recover failed totals from multiline Marketplace details');
  assert.strictEqual(rows[5].result, 'Completed with issues', 'Entra History should prefer the embedded Entra summary over a host Success row when the sync completed with endpoint-level issues');
  assert.strictEqual(rows[5].endpointsSynchronized, 0, 'Entra History should recover completed-with-issues synced totals from multiline Marketplace details');
  assert.strictEqual(rows[5].skipped, 76, 'Entra History should recover completed-with-issues skipped totals from multiline Marketplace details');
  assert.strictEqual(rows[5].failedEndpointUpdates, 1, 'Entra History should recover completed-with-issues failed totals from multiline Marketplace details');
  assert.strictEqual(rows[5].detailsLabel, 'View', 'completed-with-issues rows should expose a compact Details control');
  assert.strictEqual(rows[6].result, 'Failure', 'Entra History should render Failure from multiline Marketplace details');
  assert.strictEqual(rows[6].endpointsSynchronized, 0, 'Entra History should recover failed-row synced totals from multiline Marketplace details');
  assert.strictEqual(rows[6].skipped, 76, 'Entra History should recover failed-row skipped totals from multiline Marketplace details');
  assert.strictEqual(rows[6].failedEndpointUpdates, 1, 'Entra History should recover failed-row failed totals from multiline Marketplace details');
  assert.strictEqual(rows[6].detailsLabel, 'View', 'structured failure rows should expose a compact Details control');
  assert.strictEqual(historyViewModel.buildHistoryRows([]).length, 0, 'history view model should keep the empty state representable');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
