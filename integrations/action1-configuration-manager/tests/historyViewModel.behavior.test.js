const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const viewModel = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'historyViewModel.js')).href);
  assert.deepStrictEqual(viewModel.HISTORY_PAGE_SIZES, [50, 100, 200]);
  assert.strictEqual(viewModel.DEFAULT_HISTORY_PAGE_SIZE, 50);
  assert.deepStrictEqual(viewModel.getHistoryRange(1, 50, 137), { start: 1, end: 50, total: 137 });
  assert.deepStrictEqual(viewModel.getHistoryRange(2, 50, 137), { start: 51, end: 100, total: 137 });
  assert.deepStrictEqual(viewModel.getHistoryRange(3, 50, 137), { start: 101, end: 137, total: 137 });
  assert.deepStrictEqual(viewModel.getHistoryRange(1, 50, 0), { start: 0, end: 0, total: 0 });
  assert.deepStrictEqual(viewModel.buildPageItems(1, 8), [1, 2, 'ellipsis-after', 8]);
  assert.deepStrictEqual(viewModel.buildPageItems(5, 8), [1, 'ellipsis-before', 4, 5, 6, 'ellipsis-after', 8]);
  assert.deepStrictEqual(viewModel.buildPageItems(1, 1), [1]);
  assert.deepStrictEqual(viewModel.buildPageItems(1, 2), [1, 2]);
  assert.deepStrictEqual(viewModel.buildPageItems(3, 5), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(viewModel.buildPageItems(1, 10), [1, 2, 'ellipsis-after', 10]);
  assert.deepStrictEqual(viewModel.buildPageItems(5, 10), [1, 'ellipsis-before', 4, 5, 6, 'ellipsis-after', 10]);
  assert.deepStrictEqual(viewModel.buildPageItems(10, 10), [1, 'ellipsis-before', 9, 10]);
  assert.deepStrictEqual(viewModel.buildPageItems(50, 100), [1, 'ellipsis-before', 49, 50, 51, 'ellipsis-after', 100]);
  for (const pageItems of [viewModel.buildPageItems(1, 10), viewModel.buildPageItems(5, 10), viewModel.buildPageItems(10, 10), viewModel.buildPageItems(50, 100)]) {
    assert.strictEqual(new Set(pageItems).size, pageItems.length);
    assert(pageItems.includes(1));
    assert(pageItems.includes(pageItems[pageItems.length - 1] === 'ellipsis-after' ? pageItems[pageItems.length - 2] : pageItems[pageItems.length - 1]));
  }
  assert.deepStrictEqual(viewModel.getRelevantCounterEntries({ operation: 'Policy updated', counts: { updated: 3, created: 1, deleted: 0, unchanged: 4, failed: 0, automationsRequested: 99 } }), [
    { key: 'updated', label: 'Updated', value: 3 }, { key: 'created', label: 'Created', value: 1 },
    { key: 'deleted', label: 'Removed', value: 0 }, { key: 'unchanged', label: 'Unchanged', value: 4 }, { key: 'failed', label: 'Failed', value: 0 }
  ]);
  assert.deepStrictEqual(viewModel.getRelevantCounterEntries({ operation: 'Policy deleted', counts: { deleted: 4, failed: 0, created: 10 } }), [
    { key: 'deleted', label: 'Removed', value: 4 }, { key: 'failed', label: 'Failed', value: 0 }
  ]);
  assert.deepStrictEqual(viewModel.getRelevantCounterEntries({ operation: 'Scheduled reconciliation', counts: { policiesChecked: 1, automationsChecked: 5, created: 3, updated: 9, deleted: 4, unchanged: 2, failed: 0 } }), [
    { key: 'policiesChecked', label: 'Policies checked', value: 1 },
    { key: 'automationsChecked', label: 'Automations checked', value: 5 },
    { key: 'created', label: 'Created', value: 3 },
    { key: 'unchanged', label: 'Unchanged', value: 2 },
    { key: 'failed', label: 'Failed', value: 0 }
  ]);
  assert.strictEqual(viewModel.getCompactHistorySummary({ operation: 'Policy updated', summary: 'Policy updated.', counts: { updated: 1, created: 7, deleted: 0, unchanged: 4, failed: 0 } }), '1 updated · 7 created · 4 unchanged');
  assert.strictEqual(viewModel.getCompactHistorySummary({ operation: 'Policy enabled', summary: 'Policy enabled.', counts: { created: 5, failed: 0 } }), '5 created');
  assert.strictEqual(viewModel.getCompactHistorySummary({ operation: 'Policy updated', summary: 'Action1 changes will apply when enabled.', counts: {} }), 'Action1 changes will apply when enabled.');
  assert.strictEqual(viewModel.getCompactHistorySummary({ operation: 'Policy deleted', summary: 'Policy deleted.', counts: { deleted: 12, failed: 0 } }), '12 removed');
  assert.strictEqual(viewModel.getCompactHistorySummary({ operation: 'Policy deleted', summary: 'Policy deleted. Automations removed: 0.', counts: {} }), 'No changes');
}

run().then(() => console.log('Configuration Manager History view-model behavior passed.')).catch((error) => {
  console.error(error);
  process.exit(1);
});
