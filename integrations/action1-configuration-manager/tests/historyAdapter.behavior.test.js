const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const { createHistoryAdapter, parseHistoryRow } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'historyAdapter.js')).href);
  const reconciliationRow = parseHistoryRow(
    { id: 99, timestamp: '2026-08-14T14:00:00.000Z', action_label: 'Scheduled reconciliation', status: 'Success', details: 'reconciliation' },
    () => ({ operationLabel: 'Scheduled reconciliation', policyNameSnapshot: 'Policy', organizationNameSnapshot: 'Org', summary: '4 unchanged', counts: { unchanged: 4 }, familyOutcomes: [], errors: [] })
  );
  assert.strictEqual(reconciliationRow.operation, 'Reconciliation');
  const rows = [
    { id: 3, timestamp: '2026-08-14T13:00:00.000Z', action_label: 'Policy deleted', status: 'Success', details: 'A1CM_HISTORY_V1 deleted' },
    { id: 2, timestamp: '2026-08-14T12:00:00.000Z', action_label: 'Policy updated', status: 'Failed', details: 'malformed details' },
    { id: 1, timestamp: '2026-08-14T11:00:00.000Z', action_label: 'Policy created', status: 'Running', details: 'A1CM_HISTORY_V1 created' }
  ];
  const calls = [];
  const adapter = createHistoryAdapter({
    integration: 'action1-configuration-manager',
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, async json() { return { rows, total: 137, page: 2, pageSize: 50 }; } };
    },
    extractEnvelope: (details) => {
      if (details.includes('deleted')) return { operationLabel: 'Policy deleted', policyNameSnapshot: 'Deleted Policy', organizationNameSnapshot: 'Acme', summary: 'Policy deleted.', counts: { deleted: 2 }, familyOutcomes: [], errors: [] };
      if (details.includes('created')) return { operationLabel: 'Policy created', policyNameSnapshot: 'New Policy', organizationNameSnapshot: 'Acme', summary: 'Policy created.', counts: { created: 2 }, familyOutcomes: [], errors: [] };
      return null;
    }
  });
  const result = await adapter.list({ page: 2, pageSize: 50 });
  assert(calls[0].includes('integration=action1-configuration-manager'));
  assert(calls[0].includes('page=2'));
  assert(calls[0].includes('pageSize=50'));
  assert(calls[0].includes('sortKey=timestamp'));
  assert(calls[0].includes('sortDirection=desc'));
  assert.strictEqual(result.rows[0].policyName, 'Deleted Policy');
  assert.strictEqual(result.rows[0].result, 'Success');
  assert.strictEqual(result.rows[1].summary, 'History details are unavailable for this entry.');
  assert.strictEqual(result.rows[1].operation, 'Policy updated');
  assert.strictEqual(result.rows[2].result, 'Running');
  assert.strictEqual(result.total, 137);
  assert.strictEqual(result.page, 2);
  assert.strictEqual(result.pageSize, 50);
  assert(!JSON.stringify(result).includes('A1CM_HISTORY_V1'));

  const defaultCalls = [];
  const defaultAdapter = createHistoryAdapter({
    integration: 'action1-configuration-manager',
    fetchImpl: async (url) => { defaultCalls.push(url); return { ok: true, async json() { return { rows: [], total: 0, page: 1, pageSize: 50 }; } }; },
    extractEnvelope: () => null
  });
  await defaultAdapter.list();
  assert(defaultCalls[0].includes('pageSize=50'));
}

run().then(() => console.log('Configuration Manager History adapter behavior passed.')).catch((error) => {
  console.error(error);
  process.exit(1);
});
