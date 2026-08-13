const { createDbPolicyStore } = require('./policyStore');

function sanitizePersistenceMessage(message) {
  return String(message || 'Unable to complete the policy request.');
}

function getPayload(request) {
  return request && typeof request === 'object' ? request.payload || {} : {};
}

async function listPoliciesAction(context) {
  const store = createDbPolicyStore(context);
  return {
    ok: true,
    policies: await store.listPolicies()
  };
}

async function getPolicyAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const policyId = String(getPayload(request).policyId || '').trim();
    if (!policyId) {
      throw new Error('Policy id is required.');
    }

    const policy = await store.getPolicy(policyId);
    if (!policy) {
      throw new Error('Policy was not found.');
    }

    return { ok: true, policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function savePolicyAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const draft = getPayload(request).draft || {};
    const policy = await store.savePolicy(draft);
    return { ok: true, message: 'Policy saved.', policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function setPolicyEnabledAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    const policy = await store.setPolicyEnabled(payload.policyId, payload.enabled);
    return { ok: true, message: `Policy ${policy.enabled ? 'enabled' : 'disabled'}.`, policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function deletePolicyAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    const result = await store.deletePolicy(payload.policyId);
    return { ok: true, message: result.deleted ? 'Policy deleted.' : 'Policy was not found.', ...result };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

module.exports = {
  deletePolicyAction,
  getPolicyAction,
  listPoliciesAction,
  savePolicyAction,
  setPolicyEnabledAction
};
