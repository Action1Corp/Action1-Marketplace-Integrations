const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { createDbPolicyStore } = require('./policyStore');
const { createReconciliationStateStore } = require('./reconciliationStateStore');
const { createAndReplaceAutomation } = require('./lifecycleMutations');
const { createHistoryEnvelope, resultDetails } = require('./historyContract');
const { writeAction1RuntimeLog } = require('./runtimeLogging');

function safeError(error) {
  return String(error?.message || error || 'Reconciliation failed')
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

function reconciliationSummary(policiesChecked, missing) {
  const policyLabel = policiesChecked === 1 ? 'Policy' : 'Policies';
  return missing > 0
    ? `Checked ${policiesChecked} Enabled ${policyLabel}. Restored ${missing} missing automations.`
    : `Checked ${policiesChecked} Enabled ${policyLabel}. No missing automations found.`;
}

async function appendRun(request, message) {
  await request?.run?.appendLog?.(message);
}

async function log(context, level, message) {
  await writeAction1RuntimeLog(context, level, message);
  if (typeof context?.logger?.[level] === 'function') context.logger[level](message);
}

async function reconcileEnabledPolicy(context, policy, dependencies = {}) {
  const client = dependencies.client || createAction1AutomationClient(context);
  const correlations = dependencies.correlations || createAutomationCorrelationStore(context);
  const definitions = buildAutomationDefinitions(policy);
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
    familyOutcomes: [],
    errors: []
  };

  for (const definition of definitions) {
    const correlation = byGroup.get(definition.automationGroupId);
    try {
      if (!correlation) {
        const created = await createAndReplaceAutomation(context, policy, definition, client, correlations);
        result.created += 1;
        result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
        await log(context, 'info', `Recreated automation for ${definition.familyName}: ${created.id}`);
        continue;
      }

      const observed = await client.observeAutomation(policy.organizationId, correlation.action1AutomationId);
      if (observed.state === 'EXISTS') {
        result.unchanged += 1;
        result.exists += 1;
        result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Unchanged' });
        await log(context, 'info', `Automation exists: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(correlation.action1AutomationId)}`);
      } else if (observed.state === 'MISSING') {
        result.missing += 1;
        await log(context, 'info', `Missing owned automation detected: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(correlation.action1AutomationId)}`);
        await log(context, 'info', `Recreating missing automation: policy=${policy.policyId} family=${safeError(definition.familyName)}`);
        const created = await createAndReplaceAutomation(context, policy, definition, client, correlations);
        result.created += 1;
        result.recreated += 1;
        result.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
        await log(context, 'info', `Replacement automation created: policy=${policy.policyId} family=${safeError(definition.familyName)} oldAutomationId=${safeError(correlation.action1AutomationId)} newAutomationId=${safeError(created.id)}`);
        await log(context, 'info', `Correlation replaced: policy=${policy.policyId} family=${safeError(definition.familyName)} automationId=${safeError(created.id)}`);
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

  return result;
}

async function reconcileEnabledPolicies(context, options = {}) {
  const policyStore = options.policyStore || createDbPolicyStore(context);
  const stateStore = options.stateStore || createReconciliationStateStore(context);
  const policies = (await policyStore.listPolicies()).filter((policy) => policy.enabled === true);
  const aggregate = {
    policiesChecked: policies.length,
    automationsChecked: 0,
    created: 0,
    unchanged: 0,
    failed: 0,
    missing: 0
  };
  const policySnapshots = [];

  await log(context, 'info', 'Reconciliation started');
  await log(context, 'info', `Enabled Policies loaded: ${policies.length}`);
  await appendRun(options.request, `Enabled Policies loaded: ${policies.length}`);

  for (const policy of policies) {
    await log(context, 'info', `Policy reconciliation started: ${policy.policyId}`);
    let result;
    try {
      await log(context, 'info', `Expected automations: ${buildAutomationDefinitions(policy).length}`);
      result = await reconcileEnabledPolicy(context, policy, options);
    } catch (error) {
      result = { created: 0, unchanged: 0, exists: 0, missing: 0, recreated: 0, failedCount: 1, automationsChecked: 0, failed: true, familyOutcomes: [], errors: [safeError(error)] };
    }

    aggregate.automationsChecked += result.automationsChecked;
    aggregate.created += result.created;
    aggregate.unchanged += result.unchanged;
    aggregate.missing += result.missing || 0;
    if (result.failed) aggregate.failed += 1;
    policySnapshots.push({
      policyNameSnapshot: policy.displayName,
      organizationNameSnapshot: policy.organizationNameSnapshot,
      familyChanges: result.familyOutcomes
    });
    await stateStore.save({
      policyId: policy.policyId,
      lastResult: result.failed ? 'Failed' : 'Success',
      summary: `Checked ${result.automationsChecked}; created ${result.created}; unchanged ${result.unchanged}; failed ${result.failed ? 1 : 0}.`,
      lastError: result.failed ? result.errors[0] : null,
      historyRunId: options.request?.run?.id || null
    });
    await log(context, result.failed ? 'error' : 'info', result.failed
      ? `Policy reconciliation failed: policy=${policy.policyId} failed=${result.failedCount} reason=${failureCategory({ reason: result.errors[0] }, 'reconciliation-failed')}`
      : `Policy reconciliation completed: policy=${policy.policyId} expected=${result.automationsChecked} exists=${result.exists} missing=${result.missing} recreated=${result.recreated} failed=${result.failedCount}`);
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
    summary: reconciliationSummary(aggregate.policiesChecked, aggregate.missing),
    counts: historyCounts,
    familyOutcomes: policies.length === 1 ? policySnapshots[0]?.familyChanges : [],
    policies: policySnapshots
  });
  const details = resultDetails(envelope);
  await options.request?.run?.setAssetsProcessed?.(aggregate.automationsChecked);
  await appendRun(options.request, `Reconciliation completed: created=${aggregate.created}, unchanged=${aggregate.unchanged}, failed=${aggregate.failed}`);
  await log(context, 'info', `Aggregate reconciliation completed: policiesChecked=${aggregate.policiesChecked} automationsChecked=${aggregate.automationsChecked} created=${aggregate.created} unchanged=${aggregate.unchanged} failed=${aggregate.failed}`);
  return { ok: aggregate.failed === 0, aggregate: historyCounts, details, envelope };
}

async function reconcilePoliciesAction(context, request = {}) {
  const result = await reconcileEnabledPolicies(context, { request });
  return {
    ok: result.ok,
    message: result.ok ? 'Scheduled reconciliation completed.' : 'Scheduled reconciliation completed with failures.',
    details: result.details,
    summary: result.aggregate
  };
}

module.exports = {
  reconcileEnabledPolicy,
  reconcileEnabledPolicies,
  reconcilePoliciesAction,
  safeError
};
