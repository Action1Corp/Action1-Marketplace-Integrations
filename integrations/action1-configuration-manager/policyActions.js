const { createDbPolicyStore, normalizeAndValidatePolicyInput } = require('./policyStore');
const { loadPolicyCatalogContract } = require('./policyCatalogContract');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { formatRuntimeElapsed, writeAction1RuntimeLog, writeOperationalLog } = require('./runtimeLogging');
const { planSignedEdit, planSignedDelete, applyEdit, cleanupDeselectedControls, cleanupPolicy, disablePolicy, enablePolicy, getRemovedControlIds } = require('./lifecycleMutations');
const { createHistoryEnvelope, resultDetails, OPERATION_LABELS } = require('./historyContract');
const { appendProgressCheckpoint, progressCheckpoint } = require('./lifecycleProgress');
const { isETPContext, prepareScheduleSigning, getSignedSchedules, completeSignedPolicies } = require('./scheduleSigning');
const { prepareReconciliationSigning } = require('./reconciliation');
const { isDeepStrictEqual } = require('node:util');

async function revalidateSignedPlan(context, store, policyId, desired, approvedPlan) {
  const current = await store.getPolicy(policyId);
  if (!current) throw new Error('Policy changed after signing. Review the operation again.');
  const fresh = desired ? await planSignedEdit(context, current, desired) : await planSignedDelete(context, current);
  if (!isDeepStrictEqual(fresh.snapshot, approvedPlan.snapshot)) {
    throw new Error('Policy state or schedule identities changed after signing. Review the operation again.');
  }
}

// Short-lived completion mutex, not an intent store. Covers untracked aliases
// as well as the host's tracked actions in this single-backend preview.
async function completeSignedPolicy(request, work) {
  const payload = getPayload(request);
  if (!payload.signingId) return work();
  const policyId = typeof payload.policyId === 'string' ? payload.policyId.trim() : '';
  return completeSignedPolicies([policyId], work);
}

async function preparePolicySigningAction(context, request = {}) {
  try {
    const payload = getPayload(request);
    if (payload.operation === 'reconcile') return await prepareReconciliationSigning(context, request);
    if (!['create', 'enable', 'edit', 'delete'].includes(payload.operation)) throw new Error('Unsupported Policy signing operation.');
    if (!await isETPContext(context)) return { ok: true, signingRequired: false };
    if (!/^[0-9a-f-]{36}$/i.test(payload.intentId || '')) throw new Error('A valid Policy signing intent is required.');
    const store = createDbPolicyStore(context);
    if (payload.operation === 'delete') {
      if (typeof payload.policyId !== 'string' || !payload.policyId.trim()) throw new Error('Policy id is required.');
      const policy = await store.getPolicy(payload.policyId.trim());
      if (!policy) return { ok: true, signingRequired: false };
      const editPlan = await planSignedDelete(context, policy);
      const prepared = await prepareScheduleSigning(context, { policy, operation: 'delete', intentId: payload.intentId, editPlan });
      return { ...prepared, signingRequired: true, policyId: policy.policyId };
    }
    if (payload.operation === 'edit') {
      const previous = await store.getPolicy(payload.draft?.policyId);
      if (!previous) throw new Error('Policy was not found.');
      const desired = normalizeAndValidatePolicyInput({ ...payload.draft, mode: 'edit', enabled: previous.enabled }, loadPolicyCatalogContract());
      const editPlan = await planSignedEdit(context, previous, desired);
      if (!editPlan.cleanupInstance && !editPlan.operations.some(o => ['CREATE', 'PATCH'].includes(o.type))) return { ok: true, signingRequired: false };
      const prepared = await prepareScheduleSigning(context, { policy: desired, operation: 'edit', intentId: payload.intentId, editPlan });
      return { ...prepared, signingRequired: true, policyId: previous.policyId };
    }
    const policy = payload.operation === 'create'
      ? await store.savePolicy({ ...payload.draft, mode: 'create', enabled: false })
      : await store.getPolicy(payload.policyId);
    if (!policy || policy.enabled) throw new Error('A disabled Policy is required for this signing operation.');
    if ((policy.action1Automations || []).length) throw new Error('This Policy has partially applied automations. Review the existing results before preparing replacement work.');
    const prepared = await prepareScheduleSigning(context, { policy, operation: payload.operation, intentId: payload.intentId });
    return { ...prepared, signingRequired: true, policyId: policy.policyId };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error?.message) };
  }
}

function sanitizePersistenceMessage(message) {
  return String(message || 'Unable to complete the policy request.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
}

function getPayload(request) {
  return request && typeof request === 'object' ? request.payload || {} : {};
}

function controlIds(draft) {
  return (draft?.selectedControls || []).map((control) => String(control?.controlId || '').trim()).filter(Boolean);
}

function addedControlIds(previous, desired) {
  const previousIds = new Set(controlIds(previous));
  return controlIds(desired).filter((controlId) => !previousIds.has(controlId));
}

function scopeLabel(draft) {
  return draft?.scopeType === 'ALL_ENDPOINTS' ? 'ALL_ENDPOINTS' : `${draft?.scopeType || 'unknown'}:${draft?.endpointGroupName || draft?.endpointGroupNameSnapshot || draft?.endpointGroupId || 'unknown'}`;
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
  const startedAt = Date.now();
  let stage = 'initialization';
  await writeOperationalLog(context, 'info', 'Policies load started');
  try {
    const store = createDbPolicyStore(context);
    stage = 'policy-hydration';
    const policies = await store.listPolicies();
    await writeOperationalLog(context, 'info', 'Policies load completed', { policies: policies.length, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
    return { ok: true, policies };
  } catch (error) {
    await writeOperationalLog(context, 'error', 'Policies load failed', { stage, error: sanitizePersistenceMessage(error?.message), elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
    throw error;
  }
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
  const startedAt = Date.now();
  try {
    const store = createDbPolicyStore(context);
    const draft = getPayload(request).draft || {};
    if (draft.mode !== 'create') {
      const etp = await isETPContext(context);
      const existing = await store.getPolicy(draft.policyId);
      let editOptions, desired = draft;
      const payload = getPayload(request);
      if (!etp && payload.signingId) throw new Error('Marketplace connection changed. Prepare the Policy edit again.');
      if (etp) {
        if (!existing) throw new Error('Policy was not found.');
        if (payload.signingId && payload.policyId !== existing.policyId) throw new Error('Signing intent does not match the edited Policy.');
        desired = normalizeAndValidatePolicyInput({ ...draft, mode: 'edit', enabled: existing.enabled }, loadPolicyCatalogContract());
        const editPlan = await planSignedEdit(context, existing, desired);
        const protectedWrites = Boolean(editPlan.cleanupInstance) || editPlan.operations.some(o => ['CREATE', 'PATCH'].includes(o.type));
        if (protectedWrites && !payload.signingId) throw new Error('Prepare and sign this Policy edit before applying it.');
        if (!protectedWrites && payload.signingId) throw new Error('Policy edit changed after signing. Prepare the edit again.');
        const signedSchedules = protectedWrites ? await getSignedSchedules(context, { ...payload, policy: desired, operation: 'edit', editPlan }) : new Map();
        if (protectedWrites) await revalidateSignedPlan(context, store, existing.policyId, desired, editPlan);
        editOptions = { operations: editPlan.operations, cleanupInstance: editPlan.cleanupInstance, signedSchedules };
      }
      await writeOperationalLog(context, 'info', 'Policy edit started', { policy: draft.policyId, controls: `${controlIds(existing).length} -> ${controlIds(draft).length}` });
      snapshot = existing;
      const saved = await store.savePolicy(desired);
      await writeOperationalLog(context, 'info', 'Policy persisted', { policy: saved.policyId, controls: controlIds(saved).length });
      await writeOperationalLog(context, 'info', 'Policy controls changed', { policy: saved.policyId, added: addedControlIds(existing, saved).length, removed: getRemovedControlIds(existing, saved).length });
      if (!existing?.enabled) {
        const definitions = buildAutomationDefinitions(saved);
        const removedControlIds = getRemovedControlIds(existing, saved);
        const cleanup = await cleanupDeselectedControls(context, saved, removedControlIds, {
          instance: editOptions?.cleanupInstance, signedCleanup: editOptions?.signedSchedules.get('cleanup') });
        await writeOperationalLog(context, 'info', 'Policy edit completed', { policy: saved.policyId, automationsUpdated: 0, automationsCreated: 0, automationsDeleted: 0, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
        return historyResult({ ok: true, message: 'Policy updated.', policy: saved }, operation, saved,
          definitions.length
            ? `Policy updated. Action1 changes will apply when enabled.${cleanup ? ` Removed Control state cleanup scheduled: ${removedControlIds.length} controls.` : ''}`
            : 'No Policy changes applied.',
          { counts: { unchanged: definitions.length, removedControls: removedControlIds.length }, cleanup });
      }
      const applied = await applyEdit(context, existing, saved, editOptions);
      await writeOperationalLog(context, 'info', 'Policy edit completed', { policy: saved.policyId, automationsUpdated: applied.history.counts.updated, automationsCreated: applied.history.counts.created, automationsDeleted: applied.history.counts.deleted, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
      return historyResult({ ok: true, message: 'Policy updated.', policy: applied.policy }, operation, saved,
        `Policy updated. Updated: ${applied.history.counts.updated}; created: ${applied.history.counts.created}; removed: ${applied.history.counts.deleted}; unchanged: ${applied.history.counts.unchanged}.${applied.history.cleanup ? ` Removed Control state cleanup scheduled: ${applied.history.counts.removedControls} controls.` : ''}`, applied.history);
    }

    await writeOperationalLog(context, 'info', 'Policy create started', { policy: draft.policyId || 'pending', policyName: draft.baseName || draft.displayName || '', organization: draft.organizationNameSnapshot || '', organizationId: draft.organizationId || '', scope: draft.endpointGroupName || scopeLabel(draft), controls: controlIds(draft).length });
    const etp = await isETPContext(context);
    const payload = getPayload(request);
    if (etp && !payload.signingId) throw new Error('Use the Policy Save action to prepare and sign this operation before applying it.');
    if (!etp && payload.signingId) throw new Error('Marketplace connection changed. Prepare the Policy operation again.');
    const intent = etp ? await store.getPolicy(payload.policyId) : await store.savePolicy({ ...draft, enabled: false });
    if (!intent || (etp && intent.enabled)) throw new Error('The prepared Policy is missing or already enabled. Review its current state.');
    snapshot = intent;
    await writeOperationalLog(context, 'info', 'Policy persisted', { policy: intent.policyId });
    const definitions = buildAutomationDefinitions(intent);
    const automationClient = createAction1AutomationClient(context);
    const correlationStore = createAutomationCorrelationStore(context);
    const signedSchedules = etp ? await getSignedSchedules(context, { ...payload, policy: intent, operation: 'create' }) : null;
    const existingCorrelations = signedSchedules ? await correlationStore.listCorrelations(intent.policyId) : [];
    for (const correlation of existingCorrelations) {
      if (signedSchedules.get(correlation.automationGroupId)?.configuration.id !== correlation.action1AutomationConfigurationId) {
        throw new Error('Policy correlations changed. Review existing automations before retrying.');
      }
    }
    const history = { counts: { automationsRequested: definitions.length, created: 0, failed: 0 }, familyOutcomes: [] };
    await writeOperationalLog(context, 'debug', 'Initial automation apply started', { policy: intent.policyId, families: definitions.length });

    await appendProgressCheckpoint(request.run, progressCheckpoint({
      operation: 'create', completed: 0, total: definitions.length, operationId: getPayload(request).progressOperationId
    }));

    for (const [index, definition] of definitions.entries()) {
      await writeOperationalLog(context, 'debug', 'Automation create started', { policy: intent.policyId, family: definition.familyName, scope: intent.scopeType });
      try {
        const alreadyApplied = existingCorrelations.find(c => c.automationGroupId === definition.automationGroupId);
        if (alreadyApplied) {
          history.counts.created += 1;
          history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Unchanged' });
          continue;
        }
        const created = await automationClient.createAutomation(intent.organizationId, definition, signedSchedules?.get(definition.automationGroupId));
        await writeOperationalLog(context, 'info', 'Automation created', { policy: intent.policyId, family: definition.familyName, automationId: created.id, organization: intent.organizationNameSnapshot || '' });
        await correlationStore.insertCorrelation({
          policyId: intent.policyId,
          automationGroupId: definition.automationGroupId,
          automationGroupVersion: definition.automationGroupVersion,
          controlFamilyNameSnapshot: definition.familyName,
          action1OrganizationId: intent.organizationId,
          action1AutomationId: created.id,
           action1AutomationConfigurationId: created.configurationId || null,
          action1AutomationActionId: created.actionId,
          action1AutomationName: created.name,
          action1AutomationSelf: created.self,
          desiredDefinitionFingerprint: definition.fingerprint,
          lastAppliedAt: new Date().toISOString()
        });
        history.counts.created += 1;
        history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
        await appendProgressCheckpoint(request.run, progressCheckpoint({
          operation: 'create', completed: history.counts.created, total: definitions.length, operationId: getPayload(request).progressOperationId
        }));
      } catch (error) {
        history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Failed' });
        history.counts.failed = Math.max(1, definitions.length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length);
        error.history = history;
        throw error;
      }
    }

    const policy = await store.setPolicyEnabled(intent.policyId, true);
    await writeOperationalLog(context, 'info', 'Policy create completed', { policy: policy.policyId, automationsCreated: history.counts.created, controls: controlIds(policy).length, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
    return historyResult({ ok: true, message: 'Policy saved.', policy }, operation, policy,
      `Policy created. Automations created: ${history.counts.created}.`, history);
  } catch (error) {
    await writeOperationalLog(context, 'error', `${snapshot ? 'Policy edit' : 'Policy create'} failed`, { policy: snapshot?.policyId || getPayload(request).draft?.policyId || 'pending', stage: error?.history?.errorCategory || 'operation', error: sanitizePersistenceMessage(error?.message) });
    return historyFailure(operation, snapshot, error);
  }
}

async function savePolicyAction(context, request = {}) {
  const draft = getPayload(request).draft || {};
  const result = await completeSignedPolicy(request, () => performSavePolicy(context, request, draft.mode === 'create' ? 'POLICY_CREATED' : 'POLICY_UPDATED'));
  return { ok: result.ok, message: result.message, policy: result.policy };
}

async function createPolicyAction(context, request = {}) {
  return completeSignedPolicy(request, () => performSavePolicy(context, request, 'POLICY_CREATED'));
}

async function updatePolicyAction(context, request = {}) {
  return completeSignedPolicy(request, () => performSavePolicy(context, request, 'POLICY_UPDATED'));
}

async function performPolicyToggle(context, request = {}, enabled, operation) {
  let existing = null;
  const startedAt = Date.now();
  try {
    const store = createDbPolicyStore(context);
    const payload = getPayload(request);
    existing = await store.getPolicy(payload.policyId);
    if (!existing) throw new Error('Policy was not found.');
    if (Boolean(payload.enabled) === existing.enabled) {
      return historyResult({ ok: true, message: `Policy already ${existing.enabled ? 'enabled' : 'disabled'}.`, policy: existing }, operation, existing,
        `Policy already ${existing.enabled ? 'enabled' : 'disabled'}.`, { counts: { unchanged: 0 } });
    }
    await writeOperationalLog(context, 'info', `Policy ${enabled ? 'enable' : 'disable'} started`, { policy: existing.policyId });
    const etp = await isETPContext(context);
    if (!etp && payload.signingId) throw new Error('Marketplace connection changed. Prepare the Policy operation again.');
    const signedSchedules = enabled && etp ? await getSignedSchedules(context, { ...payload, policy: existing, operation: 'enable' }) : null;
    const history = enabled ? await enablePolicy(context, existing, { signedSchedules }) : await disablePolicy(context, existing);
    const policy = await store.setPolicyEnabled(payload.policyId, enabled);
    await writeOperationalLog(context, 'info', `Policy ${enabled ? 'enable' : 'disable'} completed`, { policy: policy.policyId, automationsCreated: history.counts.created || 0, automationsDeleted: history.counts.deleted || 0, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
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
    if (payload.enabled && await isETPContext(context)) throw new Error('Use the Policy Enable action to prepare and sign this operation before applying it.');
    if (payload.enabled) await enablePolicy(context, existing);
    else await disablePolicy(context, existing);
    const policy = await store.setPolicyEnabled(payload.policyId, payload.enabled);
    return { ok: true, message: `Policy ${policy.enabled ? 'enabled' : 'disabled'}.`, policy };
  } catch (error) {
    return { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function enablePolicyAction(context, request = {}) {
  return completeSignedPolicy(request, () => performPolicyToggle(context, request, true, 'POLICY_ENABLED'));
}

async function disablePolicyAction(context, request = {}) {
  return performPolicyToggle(context, request, false, 'POLICY_DISABLED');
}

async function performDeletePolicy(context, request = {}, tracked) {
  let existing = null;
  try {
    const payload = getPayload(request);
    if (typeof payload.policyId !== 'string' || !payload.policyId.trim()) {
      throw new Error('Policy id is required and must be a nonempty string.');
    }
    const policyId = payload.policyId.trim();
    const store = createDbPolicyStore(context);
    existing = await store.getPolicy(policyId);
    if (!existing) {
      const result = { ok: true, message: 'Policy was not found.', deleted: false, policy: null };
      return tracked ? historyResult(result, 'POLICY_DELETED', null, 'Policy was not found.', { counts: { unchanged: 0 } }) : result;
    }
    const etp = await isETPContext(context);
    let signingOptions = {};
    if (!etp && payload.signingId) throw new Error('Marketplace connection changed. Prepare the Policy operation again.');
    if (etp) {
      if (!payload.signingId) throw new Error('Prepare and sign Policy cleanup before deleting it.');
      const editPlan = await planSignedDelete(context, existing);
      const signed = await getSignedSchedules(context, { ...payload, policy: existing, operation: 'delete', editPlan });
      await revalidateSignedPlan(context, store, existing.policyId, null, editPlan);
      signingOptions = { operations: editPlan.operations, cleanupInstance: editPlan.cleanupInstance, signedCleanup: signed.get('cleanup') };
    }
    const history = await cleanupPolicy(context, existing, {
      ...signingOptions,
      run: request.run,
      progressOperationId: payload.progressOperationId
    });
    const result = await store.deletePolicy(policyId);
    await writeAction1RuntimeLog(context, 'info', `Local Policy deleted: policyId=${existing.policyId}`);
    await writeAction1RuntimeLog(context, 'info', `Policy delete completed: policyId=${existing.policyId} automationDeletedCount=${history.counts.deleted} cleanup=${Boolean(history.cleanup)}`);
    const response = { ok: true, message: result.deleted ? 'Policy deleted.' : 'Policy was not found.', ...result };
    return tracked ? historyResult(response, 'POLICY_DELETED', existing, 'Policy deleted. Automations removed: ' + history.counts.deleted + '. Endpoint cleanup scheduled.', history) : response;
  } catch (error) {
    return tracked ? historyFailure('POLICY_DELETED', existing, error) : { ok: false, message: sanitizePersistenceMessage(error.message) };
  }
}

async function deletePolicyAction(context, request = {}) {
  return completeSignedPolicy(request, () => performDeletePolicy(context, request, false));
}

async function deleteTrackedPolicyAction(context, request = {}) {
  return completeSignedPolicy(request, () => performDeletePolicy(context, request, true));
}

module.exports = {
  preparePolicySigningAction,
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
