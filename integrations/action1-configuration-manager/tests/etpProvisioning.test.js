const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparePolicySigning } = require('../etpProvisioning');

test('Configuration Manager gathers dozens of family automations into one signing request', async () => {
  const definitions = Array.from({ length: 24 }, (_, i) => ({ automationGroupId: `family.${i}`, payload: {
    name: `Family ${i}`, settings: 'DISABLED EVERY:60', endpoints: [{ id: 'target', type: 'EndpointGroup' }],
    actions: [{ template_id: 'run_script', params: { run_script_text: `Write-Output ${i}` } }]
  } }));
  const calls = [];
  const context = { action1: { provisioner: { prepareSchedules: async plan => { calls.push(plan); return { outcome: 'awaiting_signature', batchId: 'batch' }; } } } };
  const result = await preparePolicySigning(context, { policyId: 'POL-1', organizationId: 'org' }, definitions, 'review-1');
  assert.equal(result.outcome, 'awaiting_signature');
  assert.equal(calls.length, 1); assert.equal(calls[0].schedules.length, 24);
  assert.equal(new Set(calls[0].schedules.map(s => s.id)).size, 24);
  assert.deepEqual(calls[0].schedules.map(s => s.payload), definitions.map(d => d.payload));
  assert.equal(calls[0].idempotencyKey, 'review-1');
  assert.ok(!JSON.stringify(calls).includes('passphrase'));
});
test('missing framework cannot fall back to unsigned per-family writes', async () => {
  await assert.rejects(() => preparePolicySigning({ action1: {} }, {}, [], 'a'), /does not provide/);
});
