const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('Save/Edit/Enable orchestration uses one host popup and completes only after signing', async () => {
  const { invokeSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  for (const action of ['create-policy', 'enable-policy', 'update-policy', 'delete-policy', 'reconcile-policies']) {
    const calls = [];
    global.window = { Action1Marketplace: { provisioner: { sign: async args => { calls.push(['sign', args]); } } } };
    const invoke = async (id, payload) => {
      calls.push([id, payload]);
      return id === 'prepare-policy-signing' ? { ok: true, signingRequired: true, signingId: 'job', digest: 'digest', policyId: 'POL-000001', intentId: payload.intentId } : { ok: true, policy: { enabled: true } };
    };
    const result = await invokeSigningOperation(invoke, 'action1-configuration-manager', action, { draft: { mode: 'create' }, policyId: 'POL-000001', enabled: true });
    assert.equal(result.policy.enabled, true);
    assert.deepEqual(calls.map(c => c[0]), ['prepare-policy-signing', 'sign', action]);
    assert.equal(calls[0][1].operation, action === 'reconcile-policies' ? 'reconcile' : action === 'update-policy' ? 'edit' : action === 'delete-policy' ? 'delete' : action === 'create-policy' ? 'create' : 'enable');
    assert.equal(calls[2][1].signingId, 'job');
    assert.equal(calls[2][1].digest, 'digest');
    assert(!JSON.stringify(calls).includes('passphrase'));
  }
});

test('popup cancellation or missing SDK never invokes the completion action', async () => {
  const { invokeSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  for (const actionId of ['create-policy', 'update-policy', 'delete-policy', 'reconcile-policies']) for (const cancelled of [true, false]) {
    const calls = [];
    global.window = cancelled ? { Action1Marketplace: { provisioner: { sign: async () => { throw Error('Signing cancelled.'); } } } } : {};
    const invoke = async (id, payload) => { calls.push(id); return { signingRequired: true, signingId: 'job', digest: 'digest', intentId: payload.intentId }; };
    await assert.rejects(() => invokeSigningOperation(invoke, 'integration', actionId, { draft: {} }), /cancelled|signing.*unavailable/i);
    assert.deepEqual(calls, ['prepare-policy-signing']);
  }
});

test('unsigned modes complete existing actions without invoking the signer', async () => {
  const { invokeSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  const calls = [], payload = { policyId: 'POL-000001', enabled: true };
  global.window = { Action1Marketplace: { provisioner: { sign: () => { throw Error('Unexpected signer'); } } } };
  await invokeSigningOperation(async (id, input) => { calls.push([id, input]); return { signingRequired: false }; }, 'integration', 'enable-policy', payload);
  assert.deepEqual(calls.at(-1), ['enable-policy', payload]);
});
