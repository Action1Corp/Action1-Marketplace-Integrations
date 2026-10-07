const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const { createHistoryProgressPoller, formatAutomationProgressCopy, parseLatestProgressCheckpoint } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'historyProgressPoller.js')).href);
  const operationId = '11111111-2222-4333-8444-555555555555';
  const details = [
    '00:00:01 - A1CM_PROGRESS_V1 {"operation":"create","completed":1,"total":3,"operationId":"wrong"}',
    `00:00:02 - A1CM_PROGRESS_V1 {"operation":"create","completed":2,"total":3,"operationId":"${operationId}"}`
  ].join('\n');
  assert.deepStrictEqual(parseLatestProgressCheckpoint(details, { operation: 'create', operationId }), { operation: 'create', completed: 2, total: 3, operationId });
  assert.strictEqual(parseLatestProgressCheckpoint(details, { operation: 'delete', operationId }), null);
  assert.strictEqual(parseLatestProgressCheckpoint(`A1CM_PROGRESS_V1 {"operation":"create","completed":0,"total":0,"operationId":"${operationId}"}`, { operation: 'create', operationId }), null);
  assert.strictEqual(formatAutomationProgressCopy('create', { completed: 3, total: 7 }), 'Creating automations: 3 of 7');
  assert.strictEqual(formatAutomationProgressCopy('delete', { completed: 2, total: 7 }), 'Deleting automations: 2 of 7');
  assert.strictEqual(formatAutomationProgressCopy('create', { completed: 0, total: 0 }), '');

  for (const status of ['Success', 'Failed']) {
    let calls = 0, finished = 0, scheduled = [];
    const stop = createHistoryProgressPoller({
      historyAdapter: { async listRaw() { calls++; return { rows: [{ action_id: 'create-policy', status, details }] }; } },
      actionId: 'create-policy', operation: 'create', operationId,
      onProgress() {}, onFinished() { finished++; }, intervalMs: 2000,
      setTimeoutImpl(callback) { scheduled.push(callback); return scheduled.length; },
      clearTimeoutImpl() {}
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(finished, 1, `Polling should stop when action is ${status}`);
    assert.strictEqual(scheduled.length, 0);
    stop();
    assert.strictEqual(calls, 1);
  }

  let calls = 0, scheduled = [], updates = [];
  const stop = createHistoryProgressPoller({
    historyAdapter: { async listRaw() { calls++; return { rows: [
      { action_id: 'create-policy', status: 'Running', details: `A1CM_PROGRESS_V1 {"operation":"create","completed":2,"total":4,"operationId":"unrelated"}` },
      { action_id: 'delete-policy', status: 'Running', details }
    ] }; } },
    actionId: 'create-policy', operation: 'create', operationId,
    onProgress(value) { updates.push(value); }, onFinished() { assert.fail('Unrelated rows must not finish this operation'); },
    setTimeoutImpl(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeoutImpl() {}
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(updates, [], 'A different operation ID or action cannot update the overlay');
  assert.strictEqual(scheduled.length, 1);
  stop(); // React effect cleanup on unmount or operation-context navigation.
  scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1, 'Stopped polling must not issue another history request');
}

run().then(() => console.log('Configuration Manager tracked progress polling behavior passed.')).catch((error) => { console.error(error); process.exit(1); });
