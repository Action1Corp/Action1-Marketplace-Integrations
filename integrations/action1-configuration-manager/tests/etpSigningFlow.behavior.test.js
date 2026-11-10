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

test('explicit Create cancellation rolls back only the newly prepared Policy', async () => {
  const { invokeSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  const calls = [];
  global.window = { Action1Marketplace: { provisioner: { sign: async () => { calls.push('sign'); throw Error('Signing cancelled. No operations were submitted.'); } } } };
  const invoke = async (id, payload) => {
    calls.push([id, payload]);
    if (id === 'prepare-policy-signing') return { signingRequired: true, signingId: 'job', digest: 'digest', policyId: 'POL-000123', intentId: payload.intentId };
    return { ok: true, deleted: true };
  };
  const result = await invokeSigningOperation(invoke, 'integration', 'create-policy', { draft: { mode: 'create' } });
  assert.equal(result.cancelled, true);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), [
    'prepare-policy-signing', 'sign', 'rollback-prepared-policy'
  ]);
  assert.deepEqual(calls[2][1], { operation: 'create', policyId: 'POL-000123' });
});

test('Edit cancellation and non-cancel signing errors never invoke rollback', async () => {
  const { invokeSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  for (const [actionId, message] of [
    ['update-policy', 'Signing cancelled. No operations were submitted.'],
    ['create-policy', 'Signing key changed or is missing. Prepare the request again.']
  ]) {
    const calls = [];
    global.window = { Action1Marketplace: { provisioner: { sign: async () => { throw Error(message); } } } };
    const invoke = async id => { calls.push(id); return { signingRequired: true, signingId: 'job', digest: 'digest', policyId: 'POL-000123' }; };
    await assert.rejects(() => invokeSigningOperation(invoke, 'integration', actionId, { draft: { mode: actionId === 'update-policy' ? 'edit' : 'create' } }), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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

test('reporting setup uses one Marketplace popup before the signed completion action', async () => {
  const { invokeReportingSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  const calls = [];
  global.window = { Action1Marketplace: { provisioner: { sign: async args => { calls.push(['sign', args]); } } } };
  const result = await invokeReportingSigningOperation(async (id, payload) => {
    calls.push([id, payload]);
    return id === 'prepare-reporting-signing' ? { signingRequired: true, signingId: 'job', digest: 'digest', configurationId: 'source-id' } : { ok: true, reporting: { dataSource: 'Configured', reports: 'Configured' } };
  }, 'action1-configuration-manager', {});
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(call => call[0]), ['prepare-reporting-signing', 'sign', 'setup-reporting']);
  assert.equal(calls[2][1].configurationId, 'source-id');
});

test('reporting popup cancellation does not invoke Data Source setup', async () => {
  const { invokeReportingSigningOperation } = await import(pathToFileURL(path.join(__dirname, '../ui/policies/signingFlow.js')).href);
  const calls = [];
  global.window = { Action1Marketplace: { provisioner: { sign: async () => { throw Error('Signing cancelled.'); } } } };
  await assert.rejects(() => invokeReportingSigningOperation(async (id) => { calls.push(id); return { signingRequired: true, signingId: 'job', digest: 'digest' }; }, 'integration', {}), /cancelled/);
  assert.deepEqual(calls, ['prepare-reporting-signing']);
});
