const { createDbPolicyStore } = require('./policyStore');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { writeAction1RuntimeLog } = require('./runtimeLogging');
const { applyEdit, cleanupPolicy, disablePolicy, enablePolicy } = require('./lifecycleMutations');

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
    if (draft.mode !== 'create') {
      const existing = await store.getPolicy(draft.policyId);
      const saved = await store.savePolicy(draft);
      if (!existing?.enabled) {
        return { ok: true, message: 'Policy saved.', policy: saved };
      }
      return { ok: true, message: 'Policy updated.', policy: await applyEdit(context, existing, saved) };
    }

    const logger = context.logger || {};
    const intent = await store.savePolicy({ ...draft, enabled: false });
    const definitions = buildAutomationDefinitions(intent);
    const automationClient = createAction1AutomationClient(context);
    const correlationStore = createAutomationCorrelationStore(context);
    await writeAction1RuntimeLog(context, 'info', `Initial apply started for Policy ${intent.policyId}`);
    await writeAction1RuntimeLog(context, 'info', `Preparing ${definitions.length} automation families`);

    for (const [index, definition] of definitions.entries()) {
      await writeAction1RuntimeLog(context, 'info', `Creating Action1 automation ${index + 1}/${definitions.length} for family ${definition.familyName}`);
      try {
        const created = await automationClient.createAutomation(intent.organizationId, definition);
        await writeAction1RuntimeLog(context, 'info', `Action1 automation created: ${created.id}`);
        try {
          await writeAction1RuntimeLog(context, 'info', `Persisting automation correlation for Policy ${intent.policyId}, family ${definition.automationGroupId}`);
          await correlationStore.insertCorrelation({
            policyId: intent.policyId,
            automationGroupId: definition.automationGroupId,
            automationGroupVersion: definition.automationGroupVersion,
            controlFamilyNameSnapshot: definition.familyName,
            action1OrganizationId: intent.organizationId,
            action1AutomationId: created.id,
            action1AutomationName: created.name,
            action1AutomationSelf: created.self,
            desiredDefinitionFingerprint: definition.fingerprint,
            lastAppliedAt: new Date().toISOString()
          });
          await writeAction1RuntimeLog(context, 'info', 'Automation correlation persisted');
        } catch (error) {
          await writeAction1RuntimeLog(context, 'error', `Correlation persistence failed: Policy ${intent.policyId}, family ${definition.automationGroupId}, stage=persist-correlation, message=${String(error.message || error).slice(0, 240)}`);
          throw error;
        }
      } catch (error) {
        await writeAction1RuntimeLog(context, 'error', `Initial apply failed after ${index}/${definitions.length} confirmed creates: ${String(error.message || error).slice(0, 300)}`);
        throw error;
      }
    }

    const policy = await store.setPolicyEnabled(intent.policyId, true);
    await writeAction1RuntimeLog(context, 'info', `Initial apply completed; Policy ${intent.policyId} Enabled`);
    return { ok: true, message: 'Policy saved.', policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function setPolicyEnabledAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    const existing = await store.getPolicy(payload.policyId);
    if (!existing) throw new Error('Policy was not found.');
    if (Boolean(payload.enabled) === existing.enabled) {
      return { ok: true, message: `Policy already ${existing.enabled ? 'enabled' : 'disabled'}.`, policy: existing };
    }
    if (payload.enabled) {
      await enablePolicy(context, existing);
    } else {
      await disablePolicy(context, existing);
    }
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
    const existing = await store.getPolicy(payload.policyId);
    if (!existing) return { ok: true, message: 'Policy was not found.', deleted: false, policy: null };
    await cleanupPolicy(context, existing);
    const result = await store.deletePolicy(payload.policyId);
    await writeAction1RuntimeLog(context, 'info', `Policy correlations/local state removed: ${payload.policyId}`);
    await writeAction1RuntimeLog(context, 'info', `Scope reservation released: ${payload.policyId}`);
    await writeAction1RuntimeLog(context, 'info', `Policy Delete completed: ${payload.policyId}`);
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
