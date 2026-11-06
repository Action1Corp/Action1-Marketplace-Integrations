const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { createDbPolicyStore } = require('./policyStore');
const { createReconciliationStateStore } = require('./reconciliationStateStore');
const { createAndReplaceAutomation } = require('./lifecycleMutations');
const { createHistoryEnvelope, resultDetails } = require('./historyContract');
const { formatRuntimeElapsed, writeAction1RuntimeLog, writeOperationalLog } = require('./runtimeLogging');
const { isETPContext, prepareScheduleSigning, getSignedSchedules, completeSignedPolicies } = require('./scheduleSigning');
const { sanitizeMessage } = require('./action1DiscoveryClient');
const { isDeepStrictEqual } = require('node:util');

// Signing intent scope only; this is not a stored Policy or a new runtime store.
const RECONCILIATION_SCOPE = { policyId: 'enabled-policies' };
const repairKey = (policy, definition) => `${policy.policyId}:${definition.automationGroupId}`;
const manualRequired = count => `Manual reconciliation required: ${count} automation(s) are missing. ETP interactive signing is required to restore them. Run Reconcile Now to complete the recovery.`;

function safeError(error) {
  return sanitizeMessage(error?.isAxiosError ? 'Action1 reconciliation request failed.' : error?.message || error || 'Reconciliation failed')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function failureCategory(error, fallback = 'unresolved') {
  const category = error?.category || error?.diagnostics?.errorCategory || error?.reason || fallback;
  return String(category).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || fallback;
}

function failureStatus(error) {
  const status = error?.statusCode || error?.diagnostics?.statusCode;
  return Number.isInteger(Number(status)) ? String(Number(status)) : 'unknown';
}

function reconciliationSummary(policiesChecked, created, failed = 0, requiresSigning = 0) {
  if (requiresSigning) return manualRequired(requiresSigning);
  const policyLabel = policiesChecked === 1 ? 'Policy' : 'Policies';
  if (failed) return `Checked ${policiesChecked} Enabled ${policyLabel}. Restored ${created} missing automations; ${failed} Policy reconciliation(s) failed. Review History before retrying.`;
  return created > 0
    ? `Checked ${policiesChecked} Enabled ${policyLabel}. Restored ${created} missing automations.`
    : `Checked ${policiesChecked} Enabled ${policyLabel}. No missing automations found.`;
}

async function appendRun(request, message) {
  await request?.run?.appendLog?.(message);
}

async function log(context, level, message) {
  await writeAction1RuntimeLog(context, level, message);
}

async function reconcileEnabledPolicy(context, policy, dependencies = {}) {
  const client = dependencies.client || createAction1AutomationClient(context);
  const correlations = dependencies.correlations || createAutomationCorrelationStore(context);
  const definitions = buildAutomationDefinitions(policy);
  const etp = await isETPContext(context);
  const active = await correlations.listCorrelations(policy.policyId);
  const byGroup = new Map(active.map((correlation) => [correlation.automationGroupId, correlation]));
  const result = {
    created: 0,
    unchanged: 0,
    exists: 0,
    missing: 0,
    recreated: 0,
    failedCount: 0,
    automationsChecked: definitions.length,
    failed: false,
    requiresSigning: 0,
    familyOutcomes: [],
    errors: []
  };

  async function restore(definition, correlation) {
    result.missing += 1;
    if (dependencies.readOnly || (etp && !dependencies.signedSchedules)) {
      result.requiresSigning += 1;
      result.failed = true;
      result.failedCount += 1;
      result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Unresolved', message: true });
      return;
    }
    const signed = dependencies.signedSchedules?.get(repairKey(policy, definition));
    if (etp && !signed) throw new Error('Reconciliation changed after signing. Review the missing schedules again.');
    if (correlation) await log(context, 'debug', `Recreating missing automation: policy=${policy.policyId} family=${safeError(definition.familyName)}`);
    const created = await createAndReplaceAutomation(context, policy, definition, client, correlations, signed);
    result.created += 1;
    if (correlation) result.recreated += 1;
    result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
    if (!correlation) await log(context, 'info', `Recreated automation for ${definition.familyName}: ${created.id}`);
    await log(context, 'debug', `Replacement automation created: policy=${policy.policyId} family=${safeError(definition.familyName)} newAutomationId=${safeError(created.id)}`);
    await log(context, 'debug', `Correlation replaced: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(created.id)}`);
  }

  for (const definition of definitions) {
    const correlation = byGroup.get(definition.automationGroupId);
    try {
      if (!correlation) {
        dependencies.onObservation?.({ definition, correlation: null, observed: { state: 'MISSING' } });
        await restore(definition, null);
        continue;
      }

      const observed = await client.observeAutomation(policy.organizationId, correlation.action1AutomationId);
      if (etp && (correlation.action1OrganizationId !== policy.organizationId
        || (observed.state === 'EXISTS' && ((correlation.action1AutomationConfigurationId && correlation.action1AutomationConfigurationId !== observed.automation?.configurationId)
          || (correlation.action1AutomationActionId && correlation.action1AutomationActionId !== observed.automation?.actionId))))) {
        throw new Error('Policy correlation or remote schedule identity changed. Review the Policy before reconciliation.');
      }
      dependencies.onObservation?.({ definition, correlation, observed });
      if (observed.state === 'EXISTS') {
        result.unchanged += 1;
        result.exists += 1;
        result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Unchanged' });
        await log(context, 'debug', `Automation exists: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(correlation.action1AutomationId)}`);
      } else if (observed.state === 'MISSING') {
        await log(context, 'debug', `Missing owned automation detected: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(correlation.action1AutomationId)}`);
        await restore(definition, correlation);
      } else {
        result.failed = true;
        result.failedCount += 1;
        result.errors.push('Action1 automation existence could not be resolved.');
        result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Unresolved', message: true });
        const error = observed.error;
        await log(context, 'error', `Automation existence check unresolved: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(correlation.action1AutomationId)} category=${failureCategory(error, observed.reason)} status=${failureStatus(error)}`);
      }
    } catch (error) {
      result.failed = true;
      result.failedCount += 1;
      result.errors.push(safeError(error));
      result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Failed', message: true });
      await log(context, 'error', `Automation reconciliation failed: policy=${policy.policyId} family=${safeError(definition.familyName)} category=${failureCategory(error, 'mutation-failed')} status=${failureStatus(error)}`);
    }
  }

  if (result.requiresSigning) result.errors.unshift(manualRequired(result.requiresSigning));
  return result;
}

async function planSignedReconciliation(context, options = {}) {
  const store = options.policyStore || createDbPolicyStore(context);
  const policies = (await store.listPolicies()).filter(p => p.enabled === true).sort((a, b) => a.policyId.localeCompare(b.policyId));
  const operations = [], snapshot = [];
  for (const policy of policies) {
    const observations = [];
    const result = await reconcileEnabledPolicy(context, policy, { ...options, readOnly: true, signedSchedules: undefined,
      onObservation: ({ definition, correlation, observed }) => {
        observations.push({ group: definition.automationGroupId, correlation, observed });
        if (observed.state === 'MISSING') operations.push({ type: 'CREATE', policy, definition, signingKey: repairKey(policy, definition) });
      } });
    if (result.failedCount > result.requiresSigning) throw new Error('Unable to verify Policy state or remote schedule identities. Review reconciliation History and try again.');
    snapshot.push({ policy, observations });
  }
  return { policies, operations, snapshot: JSON.parse(JSON.stringify(snapshot)) };
}

async function prepareReconciliationSigning(context, request = {}, options = {}) {
  if (!await isETPContext(context)) return { ok: true, signingRequired: false };
  const plan = await planSignedReconciliation(context, options);
  if (!plan.operations.length) return { ok: true, signingRequired: false };
  const prepared = await prepareScheduleSigning(context, { policy: RECONCILIATION_SCOPE, operation: 'reconcile',
    intentId: request.payload?.intentId, editPlan: plan });
  return { ...prepared, policyId: RECONCILIATION_SCOPE.policyId, signingRequired: true };
}

async function reconcileEnabledPolicies(context, options = {}) {
  const startedAt = Date.now();
  const policyStore = options.policyStore || createDbPolicyStore(context);
  const stateStore = options.stateStore || createReconciliationStateStore(context);
  const policies = options.repairPlan?.policies || (await policyStore.listPolicies()).filter((policy) => policy.enabled === true);
  const aggregate = {
    policiesChecked: policies.length,
    automationsChecked: 0,
    created: 0,
    unchanged: 0,
    failed: 0,
    missing: 0
  };
  const policySnapshots = [];
  let requiresSigning = 0;

  await writeOperationalLog(context, 'info', 'Reconciliation started', { activePolicies: policies.length });
  await appendRun(options.request, `Enabled Policies loaded: ${policies.length}`);

  for (const policy of policies) {
    await log(context, 'debug', `Policy reconciliation started: ${policy.policyId}`);
    let result;
    try {
      await log(context, 'debug', `Expected automations: ${buildAutomationDefinitions(policy).length}`);
      result = await reconcileEnabledPolicy(context, policy, options);
    } catch (error) {
      result = { created: 0, unchanged: 0, exists: 0, missing: 0, recreated: 0, failedCount: 1, automationsChecked: 0, failed: true, familyOutcomes: [], errors: [safeError(error)] };
    }

    aggregate.automationsChecked += result.automationsChecked;
    aggregate.created += result.created;
    aggregate.unchanged += result.unchanged;
    aggregate.missing += result.missing || 0;
    requiresSigning += result.requiresSigning || 0;
    if (result.failed) aggregate.failed += 1;
    policySnapshots.push({
      policyNameSnapshot: policy.displayName,
      organizationNameSnapshot: policy.organizationNameSnapshot,
      familyChanges: result.familyOutcomes
    });
    await stateStore.save({
      policyId: policy.policyId,
      lastResult: result.failed ? 'Failed' : 'Success',
      summary: result.requiresSigning ? manualRequired(result.requiresSigning) : `Checked ${result.automationsChecked}; created ${result.created}; unchanged ${result.unchanged}; failed ${result.failed ? 1 : 0}.`,
      lastError: result.failed ? result.errors[0] : null,
      historyRunId: options.request?.run?.id || null
    });
    await writeOperationalLog(context, result.failed ? 'error' : 'info', result.failed ? 'Reconciliation failed' : 'Reconciliation checked', result.failed
      ? { policy: policy.policyId, stage: 'automation-check', failed: result.failedCount, error: failureCategory({ reason: result.errors[0] }, 'reconciliation-failed') }
      : { policy: policy.policyId, expected: result.automationsChecked, healthy: result.exists, missing: result.missing, repaired: result.recreated, failed: result.failedCount });
  }

  const organizationNames = [...new Set(policies.map(policy => String(policy.organizationNameSnapshot || '').trim()).filter(Boolean))];
  const policyProjection = policies.length === 1
    ? policies[0]
    : { displayName: `${policies.length} policies` };
  const organizationProjection = organizationNames.length === 1
    ? organizationNames[0]
    : organizationNames.length > 1
      ? `${organizationNames.length} organizations`
      : '';
  const historyCounts = { ...aggregate };
  delete historyCounts.missing;
  const envelope = createHistoryEnvelope({
    operation: 'SCHEDULED_RECONCILIATION',
    policy: policies.length === 1 ? policyProjection : { displayName: `${policies.length} policies` },
    policyNameSnapshot: policies.length === 1 ? policyProjection.displayName : `${policies.length} policies`,
    organizationNameSnapshot: organizationProjection,
    summary: reconciliationSummary(aggregate.policiesChecked, aggregate.created, aggregate.failed, requiresSigning),
    counts: historyCounts,
    familyOutcomes: policies.length === 1 ? policySnapshots[0]?.familyChanges : [],
    policies: policySnapshots
  });
  const details = resultDetails(envelope);
  await options.request?.run?.setAssetsProcessed?.(aggregate.automationsChecked);
  await appendRun(options.request, `Reconciliation completed: created=${aggregate.created}, unchanged=${aggregate.unchanged}, failed=${aggregate.failed}`);
  if (requiresSigning) await appendRun(options.request, manualRequired(requiresSigning));
  await writeOperationalLog(context, 'info', 'Reconciliation completed', { policies: aggregate.policiesChecked, expected: aggregate.automationsChecked, healthy: aggregate.unchanged, missing: aggregate.missing, repaired: aggregate.created, failed: aggregate.failed, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
  return { ok: aggregate.failed === 0, aggregate: historyCounts, details, envelope, requiresSigning };
}

async function reconcilePoliciesAction(context, request = {}, options = {}) {
  async function run(extra = {}) {
    const result = await reconcileEnabledPolicies(context, { ...options, ...extra, request });
    return {
      ok: result.ok,
      message: result.requiresSigning ? manualRequired(result.requiresSigning) : result.ok ? 'Reconciliation completed.' : 'Reconciliation completed with failures. Review History before retrying.',
      details: result.details,
      summary: result.aggregate
    };
  }
  try {
    const payload = request.payload || {};
    if (!payload.signingId) return await run();
    if (!await isETPContext(context)) throw new Error('Marketplace connection changed. Prepare reconciliation again.');
    const store = options.policyStore || createDbPolicyStore(context);
    const policies = (await store.listPolicies()).filter(p => p.enabled === true);
    return await completeSignedPolicies([RECONCILIATION_SCOPE.policyId, ...policies.map(p => p.policyId)], async () => {
      const plan = await planSignedReconciliation(context, options);
      const signedSchedules = await getSignedSchedules(context, { ...payload, policy: RECONCILIATION_SCOPE, operation: 'reconcile', editPlan: plan });
      const fresh = await planSignedReconciliation(context, options);
      if (!isDeepStrictEqual(plan.snapshot, fresh.snapshot)) throw new Error('Policy state or remote identities changed after signing. Prepare reconciliation again.');
      return run({ repairPlan: fresh, signedSchedules });
    });
  } catch (error) {
    const message = safeError(error);
    await appendRun(request, message);
    const envelope = createHistoryEnvelope({ operation: 'SCHEDULED_RECONCILIATION', summary: message, counts: { created: 0, failed: 1 } });
    return { ok: false, message, details: resultDetails(envelope), summary: envelope.counts };
  }
}

module.exports = {
  reconcileEnabledPolicy,
  reconcileEnabledPolicies,
  reconcilePoliciesAction,
  prepareReconciliationSigning,
  safeError
};
