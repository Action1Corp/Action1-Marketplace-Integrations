const { createDbPolicyStore } = require('./policyStore');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { writeAction1RuntimeLog } = require('./runtimeLogging');
const { applyEdit, cleanupPolicy, disablePolicy, enablePolicy } = require('./lifecycleMutations');
const { createHistoryEnvelope, resultDetails, OPERATION_LABELS } = require('./historyContract');

function sanitizePersistenceMessage(message) {
  return String(message || 'Unable to complete the policy request.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
}

function getPayload(request) {
  return request && typeof request === 'object' ? request.payload || {} : {};
}

function historyResult(result, operation, policy, summary, history = {}) {
  const envelope = createHistoryEnvelope({
    operation,
    policy,
    summary,
    counts: history.counts,
    familyOutcomes: history.familyOutcomes,
    errors: history.errors
  });
  return { ...result, details: resultDetails(envelope) };
}

function historyFailure(operation, policy, error) {
  const history = error?.history || {};
  const operationLabel = OPERATION_LABELS[operation] || 'Policy operation';
  const envelope = createHistoryEnvelope({
    operation,
    policy,
    summary: history.summary || `${operationLabel} failed.`,
    counts: history.counts || { failed: 1 },
    familyOutcomes: history.familyOutcomes,
    errors: [history.errorCategory || 'Policy operation failed']
  });
  return { ok: false, message: sanitizePersistenceMessage(error?.message), details: resultDetails(envelope) };
}

async function listPoliciesAction(context) {
  const store = createDbPolicyStore(context);
  return { ok: true, policies: await store.listPolicies() };
}

async function getPolicyAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const policyId = String(getPayload(request).policyId || '').trim();
    if (!policyId) throw new Error('Policy id is required.');
    const policy = await store.getPolicy(policyId);
    if (!policy) throw new Error('Policy was not found.');
    return { ok: true, policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function performSavePolicy(context, request = {}, operation) {
  let snapshot = null;
  try {
    const store = createDbPolicyStore(context);
    const draft = getPayload(request).draft || {};
    if (draft.mode !== 'create') {
      const existing = await store.getPolicy(draft.policyId);
      snapshot = existing;
      const saved = await store.savePolicy(draft);
      if (!existing?.enabled) {
        const definitions = buildAutomationDefinitions(saved);
        return historyResult({ ok: true, message: 'Policy updated.', policy: saved }, operation, saved,
          definitions.length ? `Policy updated. Action1 changes will apply when enabled.` : 'No Policy changes applied.',
          { counts: { unchanged: definitions.length } });
      }
      const applied = await applyEdit(context, existing, saved);
      return historyResult({ ok: true, message: 'Policy updated.', policy: applied.policy }, operation, saved,
        `Policy updated. Updated: ${applied.history.counts.updated}; created: ${applied.history.counts.created}; removed: ${applied.history.counts.deleted}; unchanged: ${applied.history.counts.unchanged}.`, applied.history);
    }

    const intent = await store.savePolicy({ ...draft, enabled: false });
    snapshot = intent;
    const definitions = buildAutomationDefinitions(intent);
    const automationClient = createAction1AutomationClient(context);
    const correlationStore = createAutomationCorrelationStore(context);
    const history = { counts: { automationsRequested: definitions.length, created: 0, failed: 0 }, familyOutcomes: [] };
    await writeAction1RuntimeLog(context, 'info', `Initial apply started for Policy ${intent.policyId}`);
    await writeAction1RuntimeLog(context, 'info', `Preparing ${definitions.length} automation families`);

    for (const [index, definition] of definitions.entries()) {
      await writeAction1RuntimeLog(context, 'info', `Creating Action1 automation ${index + 1}/${definitions.length} for family ${definition.familyName}`);
      try {
        const created = await automationClient.createAutomation(intent.organizationId, definition);
        await writeAction1RuntimeLog(context, 'info', 'Action1 automation created');
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
        history.counts.created += 1;
        history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
      } catch (error) {
        history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Failed' });
        history.counts.failed = Math.max(1, definitions.length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length);
        error.history = history;
        throw error;
      }
    }

    const policy = await store.setPolicyEnabled(intent.policyId, true);
    return historyResult({ ok: true, message: 'Policy saved.', policy }, operation, policy,
      `Policy created. Automations created: ${history.counts.created}.`, history);
  } catch (error) {
    return historyFailure(operation, snapshot, error);
  }
}

async function savePolicyAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const draft = getPayload(request).draft || {};
    if (draft.mode !== 'create') {
      const existing = await store.getPolicy(draft.policyId);
      const saved = await store.savePolicy(draft);
      if (!existing?.enabled) return { ok: true, message: 'Policy saved.', policy: saved };
      const applied = await applyEdit(context, existing, saved);
      return { ok: true, message: 'Policy updated.', policy: applied.policy };
    }
    const result = await performSavePolicy(context, request, 'POLICY_CREATED');
    return { ok: result.ok, message: result.message, policy: result.policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function createPolicyAction(context, request = {}) {
  return performSavePolicy(context, request, 'POLICY_CREATED');
}

async function updatePolicyAction(context, request = {}) {
  return performSavePolicy(context, request, 'POLICY_UPDATED');
}

async function performPolicyToggle(context, request = {}, enabled, operation) {
  let existing = null;
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    existing = await store.getPolicy(payload.policyId);
    if (!existing) throw new Error('Policy was not found.');
    if (Boolean(payload.enabled) === existing.enabled) {
      return historyResult({ ok: true, message: `Policy already ${existing.enabled ? 'enabled' : 'disabled'}.`, policy: existing }, operation, existing,
        `Policy already ${existing.enabled ? 'enabled' : 'disabled'}.`, { counts: { unchanged: 0 } });
    }
    const history = enabled ? await enablePolicy(context, existing) : await disablePolicy(context, existing);
    const policy = await store.setPolicyEnabled(payload.policyId, enabled);
    return historyResult({ ok: true, message: `Policy ${policy.enabled ? 'enabled' : 'disabled'}.`, policy }, operation, policy,
      enabled ? `Policy enabled. Automations created: ${history.counts.created}.` : `Policy disabled. Automations removed: ${history.counts.deleted}.`, history);
  } catch (error) {
    return historyFailure(operation, existing, error);
  }
}

async function setPolicyEnabledAction(context, request = {}) {
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    const existing = await store.getPolicy(payload.policyId);
    if (!existing) throw new Error('Policy was not found.');
    if (Boolean(payload.enabled) === existing.enabled) return { ok: true, message: `Policy already ${existing.enabled ? 'enabled' : 'disabled'}.`, policy: existing };
    if (payload.enabled) await enablePolicy(context, existing);
    else await disablePolicy(context, existing);
    const policy = await store.setPolicyEnabled(payload.policyId, payload.enabled);
    return { ok: true, message: `Policy ${policy.enabled ? 'enabled' : 'disabled'}.`, policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function enablePolicyAction(context, request = {}) {
  return performPolicyToggle(context, request, true, 'POLICY_ENABLED');
}

async function disablePolicyAction(context, request = {}) {
  return performPolicyToggle(context, request, false, 'POLICY_DISABLED');
}

async function performDeletePolicy(context, request = {}, tracked) {
  let existing = null;
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    existing = await store.getPolicy(payload.policyId);
    if (!existing) {
      const result = { ok: true, message: 'Policy was not found.', deleted: false, policy: null };
      return tracked ? historyResult(result, 'POLICY_DELETED', null, 'Policy was not found.', { counts: { unchanged: 0 } }) : result;
    }
    const history = await cleanupPolicy(context, existing);
    const result = await store.deletePolicy(payload.policyId);
    await writeAction1RuntimeLog(context, 'info', 'Policy correlations/local state removed');
    await writeAction1RuntimeLog(context, 'info', 'Scope reservation released');
    await writeAction1RuntimeLog(context, 'info', 'Policy Delete completed');
    const response = { ok: true, message: result.deleted ? 'Policy deleted.' : 'Policy was not found.', ...result };
    return tracked ? historyResult(response, 'POLICY_DELETED', existing, 'Policy deleted. Automations removed: ' + history.counts.deleted + '. Endpoint cleanup scheduled.', history) : response;
  } catch (error) {
    return tracked ? historyFailure('POLICY_DELETED', existing, error) : { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function deletePolicyAction(context, request = {}) {
  return performDeletePolicy(context, request, false);
}

async function deleteTrackedPolicyAction(context, request = {}) {
  return performDeletePolicy(context, request, true);
}

module.exports = {
  createPolicyAction,
  deletePolicyAction,
  deleteTrackedPolicyAction,
  disablePolicyAction,
  enablePolicyAction,
  getPolicyAction,
  listPoliciesAction,
  savePolicyAction,
  setPolicyEnabledAction,
  updatePolicyAction
};
