const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, policies: [], policy: { policyId: 'POL-000001' }, deleted: true };
      }
    };
  };

  const { createPolicyApi } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyApi.js')).href
  );

  const api = createPolicyApi('action1-configuration-manager');
  await api.listPolicies();
  assert.strictEqual(fetchCalls[0].url, '/api/integrations/action1-configuration-manager/actions/list-policies');
  assert.strictEqual(fetchCalls[0].options.method, 'POST');

  const validDraft = {
    mode: 'create',
    baseName: 'Workstation Security'
  };

  await api.savePolicy(validDraft, '11111111-2222-4333-8444-555555555555');
  assert(fetchCalls[1].url.endsWith('/prepare-policy-signing'));
  assert.strictEqual(JSON.parse(fetchCalls[1].options.body).payload.operation, 'create');
  assert.deepStrictEqual(JSON.parse(fetchCalls[2].options.body), {
    payload: { draft: validDraft, progressOperationId: '11111111-2222-4333-8444-555555555555' }
  });

  const retryDraft = { mode: 'create', baseName: 'Retry Policy', endpointGroupId: 'group-retry', selectedControls: [{ controlId: 'control-a' }] };
  const retryCalls = [];
  const defaultFetch = global.fetch;
  let prepareNumber = 0;
  let signingNumber = 0;
  global.window = { Action1Marketplace: { provisioner: { sign: async () => {
    signingNumber += 1;
    if (signingNumber === 1) throw Error('Signing cancelled. No operations were submitted.');
  } } } };
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body).payload;
    retryCalls.push({ action: url.split('/').pop(), payload });
    if (url.endsWith('/prepare-policy-signing')) {
      prepareNumber += 1;
      return { ok: true, json: async () => ({ ok: true, signingRequired: true, policyId: prepareNumber === 1 ? 'POL-000123' : 'POL-000124', signingId: `job-${prepareNumber}`, digest: `digest-${prepareNumber}` }) };
    }
    if (url.endsWith('/rollback-prepared-policy')) return { ok: true, json: async () => ({ ok: true, deleted: true }) };
    return { ok: true, json: async () => ({ ok: true, policy: { policyId: 'POL-000124' } }) };
  };
  const cancelledCreate = await api.savePolicy(retryDraft);
  assert.equal(cancelledCreate?.cancelled, true, 'successful local rollback should end Save quietly in the editor');
  assert.deepStrictEqual(retryDraft, { mode: 'create', baseName: 'Retry Policy', endpointGroupId: 'group-retry', selectedControls: [{ controlId: 'control-a' }] });
  const retriedCreate = await api.savePolicy(retryDraft);
  assert.equal(retriedCreate.policyId, 'POL-000124');
  assert.deepEqual(retryCalls.map(call => call.action), [
    'prepare-policy-signing', 'rollback-prepared-policy', 'prepare-policy-signing', 'create-policy'
  ]);
  assert.equal(retryCalls[0].payload.operation, 'create');
  assert.equal(retryCalls[1].payload.operation, 'create');
  assert.equal(retryCalls[1].payload.policyId, 'POL-000123');
  assert.equal(retryCalls[2].payload.operation, 'create');
  assert.equal(retryCalls[3].payload.policyId, 'POL-000124');
  assert.notEqual(retryCalls[0].payload.intentId, retryCalls[2].payload.intentId);
  assert.equal(signingNumber, 2, 'retry should open a new signing popup');
  global.fetch = defaultFetch;

  const failedRollbackCalls = [];
  global.window.Action1Marketplace.provisioner.sign = async () => { throw Error('Signing cancelled. No operations were submitted.'); };
  global.fetch = async (url, options) => {
    failedRollbackCalls.push({ action: url.split('/').pop(), payload: JSON.parse(options.body).payload });
    return url.endsWith('/prepare-policy-signing')
      ? { ok: true, json: async () => ({ ok: true, signingRequired: true, policyId: 'POL-000125', signingId: 'job-failed-rollback', digest: 'digest-failed-rollback' }) }
      : { ok: true, json: async () => ({ ok: false, message: 'Policy has correlations.' }) };
  };
  await assert.rejects(() => api.savePolicy(retryDraft), /could not be removed.*Policy has correlations/i);
  assert.deepEqual(failedRollbackCalls.map(call => call.action), ['prepare-policy-signing', 'rollback-prepared-policy']);
  global.fetch = defaultFetch;

  await api.getPolicy('POL-000001');
  assert.deepStrictEqual(JSON.parse(fetchCalls[3].options.body), {
    payload: { policyId: 'POL-000001' }
  });

  await api.setPolicyEnabled('POL-000001', false);
  assert.deepStrictEqual(JSON.parse(fetchCalls[4].options.body), {
    payload: { policyId: 'POL-000001', enabled: false }
  });

  await api.deletePolicy('POL-000001', '11111111-2222-4333-8444-555555555555');
  assert.strictEqual(JSON.parse(fetchCalls[5].options.body).payload.operation, 'delete');
  assert.deepStrictEqual(JSON.parse(fetchCalls[6].options.body), {
    payload: { policyId: 'POL-000001', progressOperationId: '11111111-2222-4333-8444-555555555555' }
  });

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { ok: false, message: 'Policy save failed.' };
    }
  });
  await assert.rejects(() => api.savePolicy(validDraft), /Policy save failed/);

  global.fetch = async () => ({
    ok: false,
    async json() {
      throw new Error('bad json');
    }
  });
  await assert.rejects(() => api.listPolicies(), /Unable to complete the policy request/);

  const editCalls = [];
  let prompts = 0;
  global.window = { Action1Marketplace: { provisioner: { sign: async () => { prompts += 1; } } } };
  global.fetch = async (url, options) => {
    editCalls.push({ url, payload: JSON.parse(options.body).payload });
    return { ok: true, json: async () => url.endsWith('/prepare-policy-signing')
      ? { ok: true, signingRequired: true, policyId: 'POL-000001', signingId: 'signed-edit', digest: 'edit-digest' }
      : { ok: true, policy: { policyId: 'POL-000001', baseName: 'Edited Policy' } } };
  };
  const edited = await api.savePolicy({ mode: 'edit', policyId: 'POL-000001', baseName: 'Edited Policy' });
  assert.strictEqual(edited.baseName, 'Edited Policy');
  assert.strictEqual(prompts, 1);
  assert.strictEqual(editCalls[0].payload.operation, 'edit');
  assert(editCalls[1].url.endsWith('/update-policy'));
  assert.strictEqual(editCalls[1].payload.signingId, 'signed-edit');
  editCalls.length = 0;
  global.window.Action1Marketplace.provisioner.sign = async () => { throw Error('Signing cancelled. No operations were submitted.'); };
  await assert.rejects(() => api.savePolicy({ mode: 'edit', policyId: 'POL-000001' }), /Signing cancelled/);
  assert.strictEqual(editCalls.length, 1, 'Cancelling the real Policy API flow must not call update-policy');
  editCalls.length = 0;
  await assert.rejects(() => api.deletePolicy('POL-000001'), /cancelled/);
  assert.strictEqual(editCalls.length, 1, 'Cancellation must not invoke delete-policy');
  assert.strictEqual(editCalls[0].payload.operation, 'delete');
  editCalls.length = 0;
  global.window.Action1Marketplace.provisioner.sign = async () => { prompts += 1; };
  await api.deletePolicy('POL-000001');
  assert.strictEqual(prompts, 2, 'Delete shares the existing single-popup flow');
  assert.strictEqual(editCalls.length, 2);
  assert(editCalls[1].url.endsWith('/delete-policy'));
  assert.strictEqual(editCalls[1].payload.signingId, 'signed-edit');
  editCalls.length = 0;
  await api.reconcilePolicies();
  assert.strictEqual(prompts, 3);
  assert.strictEqual(editCalls[0].payload.operation, 'reconcile');
  assert(editCalls[1].url.endsWith('/reconcile-policies'));
  assert.strictEqual(editCalls[1].payload.signingId, 'signed-edit');
  editCalls.length = 0;
  global.window.Action1Marketplace.provisioner.sign = async () => { throw Error('Signing cancelled.'); };
  await assert.rejects(() => api.reconcilePolicies(), /cancelled/);
  assert.strictEqual(editCalls.length, 1);
  editCalls.length = 0;
  global.fetch = async (url, options) => {
    editCalls.push({ url, payload: JSON.parse(options.body).payload });
    return { ok: true, json: async () => ({ ok: true, signingRequired: false }) };
  };
  await api.reconcilePolicies();
  assert(editCalls[1].url.endsWith('/reconcile-policies'), 'Healthy/no-write checks bypass the signer');
}

try {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
