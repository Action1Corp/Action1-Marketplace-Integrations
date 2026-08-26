const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { planLifecycleDiff, summarizeLifecycleDiff } = require('./lifecyclePlanner');
const { writeAction1RuntimeLog } = require('./runtimeLogging');
const { classifyMissingAutomationGet } = require('./action1AutomationClient');
const {
  buildPolicyEndpointCleanupInstance,
  buildDeselectedControlCleanupInstance
} = require('./policyEndpointCleanup');

function safeError(error) {
  return String(error?.message || error || 'Lifecycle mutation failed').slice(0, 1000);
}

async function log(context, level, message) {
  await writeAction1RuntimeLog(context, level, message);
}

function getRemovedControlIds(previousPolicy, desiredPolicy) {
  const desiredIds = new Set((desiredPolicy?.selectedControls || [])
    .map((control) => String(control?.controlId || '').trim())
    .filter(Boolean));
  const seen = new Set();
  return (previousPolicy?.selectedControls || [])
    .map((control) => String(control?.controlId || '').trim())
    .filter((controlId) => controlId && !desiredIds.has(controlId) && !seen.has(controlId))
    .filter((controlId) => {
      seen.add(controlId);
      return true;
    });
}

async function cleanupDeselectedControls(context, policy, removedControlIds, options = {}) {
  const ids = Array.isArray(removedControlIds) ? removedControlIds : [];
  if (ids.length === 0) return null;
  const client = options.client || createAction1AutomationClient(context);
  await log(context, 'info', `Control state cleanup started: policy=${policy.policyId} removedControls=${ids.length}`);
  try {
    const instance = buildDeselectedControlCleanupInstance(policy, ids);
    const accepted = await client.createAutomationInstance(policy.organizationId, instance);
    if (!accepted?.id) throw new Error('Action1 deselected-Control cleanup instance was not accepted.');
    await log(context, 'info', `Control state cleanup accepted: policy=${policy.policyId} removedControls=${ids.length}`);
    return { scheduled: true, instanceId: accepted.id, removedControlCount: ids.length };
  } catch (error) {
    await log(context, 'error', `Control state cleanup failed: policy=${policy.policyId} removedControls=${ids.length} message=${safeError(error)}`);
    error.history = {
      ...(error.history || {}),
      errorCategory: 'Endpoint cleanup instance create failed',
      removedControlCount: ids.length
    };
    throw error;
  }
}

async function createAndReplaceAutomation(context, policy, definition, client, correlations) {
  const created = await client.createAutomation(policy.organizationId, definition);
  await correlations.activateCorrelation({
    policyId: policy.policyId,
    automationGroupId: definition.automationGroupId,
    automationGroupVersion: definition.automationGroupVersion,
    controlFamilyNameSnapshot: definition.familyName,
    action1OrganizationId: policy.organizationId,
    action1AutomationId: created.id,
    action1AutomationName: created.name,
    action1AutomationSelf: created.self,
    desiredDefinitionFingerprint: definition.fingerprint,
    lastAppliedAt: new Date().toISOString()
  });
  return created;
}

async function applyEdit(context, previousPolicy, desiredPolicy, options = {}) {
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const current = await correlations.listCorrelations(previousPolicy.policyId);
  const definitions = buildAutomationDefinitions(desiredPolicy);
  const operations = planLifecycleDiff(definitions, current);
  const removedControlIds = getRemovedControlIds(previousPolicy, desiredPolicy);
  const summary = summarizeLifecycleDiff(operations);
  const applied = { updated: 0, created: 0, deleted: 0, unchanged: summary.unchanged, failed: 0 };
  const familyOutcomes = [];
  let currentFamilyName = '';
  await log(context, 'info', `Policy Edit started: ${desiredPolicy.policyId}`);
  await log(context, 'debug', `Policy Edit diff: unchanged=${summary.unchanged} patch=${summary.patch} create=${summary.create} delete=${summary.delete}`);

  try {
    for (const operation of operations) {
      const family = operation.definition?.familyName || operation.correlation?.controlFamilyNameSnapshot || operation.automationGroupId;
      currentFamilyName = family;
      if (operation.type === 'UNCHANGED') {
        const observed = await client.observeAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId);
        if (observed.state === 'UNRESOLVED') throw observed.error || new Error(`Unable to verify Action1 automation for ${family}.`);
        if (observed.state === 'MISSING') {
          await log(context, 'info', `Missing owned automation detected: ${family}`);
          await log(context, 'info', `Recreating Control Family: ${family}`);
          const created = await createAndReplaceAutomation(context, desiredPolicy, operation.definition, client, correlations);
          await log(context, 'info', `Replacement automation created: ${created.id}`);
          await log(context, 'info', `Correlation replaced: ${operation.automationGroupId}`);
          applied.created += 1;
          applied.unchanged -= 1;
          familyOutcomes.push({ familyName: family, outcome: 'Created' });
        } else {
          familyOutcomes.push({ familyName: family, outcome: 'Unchanged' });
        }
        continue;
      }
      if (operation.type === 'PATCH') {
        await log(context, 'debug', `PATCH family started: ${family}`);
        let updated;
        try {
          updated = await client.updateAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId, operation.definition);
        } catch (error) {
          if (!classifyMissingAutomationGet(error, operation.correlation.action1AutomationId)) throw error;
          await log(context, 'info', `Missing owned automation detected: ${family}`);
          await log(context, 'info', `Recreating Control Family: ${family}`);
          const created = await createAndReplaceAutomation(context, desiredPolicy, operation.definition, client, correlations);
          await log(context, 'info', `Replacement automation created: ${created.id}`);
          await log(context, 'info', `Correlation replaced: ${operation.automationGroupId}`);
          applied.created += 1;
          familyOutcomes.push({ familyName: family, outcome: 'Created' });
          continue;
        }
        await correlations.updateCorrelation(desiredPolicy.policyId, operation.automationGroupId, {
          automationGroupVersion: operation.definition.automationGroupVersion,
          controlFamilyNameSnapshot: operation.definition.familyName,
          action1AutomationName: updated.name,
          action1AutomationSelf: updated.self,
          desiredDefinitionFingerprint: operation.definition.fingerprint,
          lastAppliedAt: new Date().toISOString()
        });
        await log(context, 'debug', `Correlation updated: ${operation.automationGroupId}`);
        await log(context, 'debug', `PATCH family completed: ${family}`);
        applied.updated += 1;
        familyOutcomes.push({ familyName: family, outcome: 'Updated' });
      } else if (operation.type === 'CREATE') {
        await log(context, 'debug', `CREATE family started: ${family}`);
        const created = await createAndReplaceAutomation(context, desiredPolicy, operation.definition, client, correlations);
        await log(context, 'debug', `Action1 automation created: ${created.id}`);
        await log(context, 'debug', `Correlation activated: ${operation.automationGroupId}`);
        await log(context, 'debug', `CREATE family completed: ${family}`);
        applied.created += 1;
        familyOutcomes.push({ familyName: family, outcome: 'Created' });
      } else if (operation.type === 'DELETE') {
        await log(context, 'debug', `DELETE family started: ${family}`);
        await log(context, 'debug', `Deleting Action1 automation ${operation.correlation.action1AutomationId}`);
        const deletion = await client.deleteAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId);
        await correlations.markInactive(desiredPolicy.policyId, operation.automationGroupId);
        if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${operation.correlation.action1AutomationId}; cleanup satisfied`);
        await log(context, 'debug', `Correlation marked inactive: ${operation.automationGroupId}`);
        await log(context, 'debug', `DELETE family completed: ${family}`);
        applied.deleted += 1;
        familyOutcomes.push({ familyName: family, outcome: 'Removed' });
      }
    }
    const cleanup = await cleanupDeselectedControls(context, desiredPolicy, removedControlIds, { client });
    applied.removedControls = removedControlIds.length;
    await log(context, 'info', `Policy Edit completed: ${desiredPolicy.policyId}`);
    return { policy: desiredPolicy, history: { counts: applied, familyOutcomes, cleanup } };
  } catch (error) {
    if (currentFamilyName && !familyOutcomes.some((outcome) => outcome.familyName === currentFamilyName && outcome.outcome === 'Failed')) {
      familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    }
    error.history = { counts: { ...applied, removedControls: removedControlIds.length, failed: Math.max(1, operations.length - familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes };
    await log(context, 'error', `Policy Edit failed: ${desiredPolicy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function disablePolicy(context, policy, options = {}) {
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const active = await correlations.listCorrelations(policy.policyId);
  const history = { counts: { deleted: 0, failed: 0 }, familyOutcomes: [] };
  let currentFamilyName = '';
  await log(context, 'info', `Disable started: ${policy.policyId}`);
  try {
    for (const correlation of active) {
      currentFamilyName = correlation.controlFamilyNameSnapshot;
      await log(context, 'debug', `DELETE family started: ${correlation.controlFamilyNameSnapshot}`);
      await log(context, 'debug', `Deleting Action1 automation ${correlation.action1AutomationId}`);
      const deletion = await client.deleteAutomation(policy.organizationId, correlation.action1AutomationId);
      await correlations.markInactive(policy.policyId, correlation.automationGroupId);
      if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${correlation.action1AutomationId}; cleanup satisfied`);
      await log(context, 'debug', `Correlation marked inactive: ${correlation.automationGroupId}`);
      history.counts.deleted += 1;
      history.familyOutcomes.push({ familyName: correlation.controlFamilyNameSnapshot, outcome: 'Removed' });
    }
    await log(context, 'info', `Disable completed: ${policy.policyId}`);
    return history;
  } catch (error) {
    if (currentFamilyName) history.familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    error.history = { counts: { ...history.counts, failed: Math.max(1, active.length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes: history.familyOutcomes };
    await log(context, 'error', `Disable partial failure: ${policy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function enablePolicy(context, policy) {
  const client = createAction1AutomationClient(context);
  const correlations = createAutomationCorrelationStore(context);
  const definitions = buildAutomationDefinitions(policy);
  const history = { counts: { created: 0, failed: 0 }, familyOutcomes: [] };
  let currentFamilyName = '';
  await log(context, 'info', `Enable started: ${policy.policyId}`);
  try {
    for (const definition of definitions) {
      currentFamilyName = definition.familyName;
      await log(context, 'debug', `CREATE family started: ${definition.familyName}`);
      const created = await client.createAutomation(policy.organizationId, definition);
      await correlations.activateCorrelation({
        policyId: policy.policyId,
        automationGroupId: definition.automationGroupId,
        automationGroupVersion: definition.automationGroupVersion,
        controlFamilyNameSnapshot: definition.familyName,
        action1OrganizationId: policy.organizationId,
        action1AutomationId: created.id,
        action1AutomationName: created.name,
        action1AutomationSelf: created.self,
        desiredDefinitionFingerprint: definition.fingerprint,
        lastAppliedAt: new Date().toISOString()
      });
      await log(context, 'debug', `New Action1 automation ${created.id}`);
      await log(context, 'debug', `Correlation activated/replaced: ${definition.automationGroupId}`);
      history.counts.created += 1;
      history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
    }
    await log(context, 'info', `Enable completed: ${policy.policyId}`);
    return history;
  } catch (error) {
    if (currentFamilyName) history.familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    error.history = { counts: { ...history.counts, failed: Math.max(1, definitions.length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes: history.familyOutcomes };
    await log(context, 'error', `Enable partial failure: ${policy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function cleanupPolicy(context, policy, options = {}) {
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const owned = await correlations.listCorrelations(policy.policyId, { includeInactive: true });
  const history = { counts: { deleted: 0, failed: 0 }, familyOutcomes: [] };
  let currentFamilyName = '';
  await log(context, 'info', `Policy Delete started: ${policy.policyId}`);
  try {
    for (const correlation of owned.filter((entry) => entry.active !== false)) {
      currentFamilyName = correlation.controlFamilyNameSnapshot;
      await log(context, 'debug', `Deleting Action1 automation ${correlation.action1AutomationId}`);
      const deletion = await client.deleteAutomation(policy.organizationId, correlation.action1AutomationId);
      await correlations.markInactive(policy.policyId, correlation.automationGroupId);
      if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${correlation.action1AutomationId}; cleanup satisfied`);
      await log(context, 'debug', `Correlation marked inactive: ${correlation.automationGroupId}`);
      history.counts.deleted += 1;
      history.familyOutcomes.push({ familyName: correlation.controlFamilyNameSnapshot, outcome: 'Removed' });
    }
  } catch (error) {
    if (currentFamilyName) history.familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    error.history = { counts: { ...history.counts, failed: Math.max(1, owned.filter((entry) => entry.active !== false).length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes: history.familyOutcomes };
    throw error;
  }
  const cleanupInstance = buildPolicyEndpointCleanupInstance(policy);
  let accepted;
  try {
    accepted = await client.createAutomationInstance(policy.organizationId, cleanupInstance);
    if (!accepted?.id) throw new Error('Action1 endpoint cleanup instance was not accepted.');
  } catch (error) {
    error.history = {
      counts: { ...history.counts, failed: 1 },
      familyOutcomes: history.familyOutcomes,
      errorCategory: 'Endpoint cleanup instance create failed'
    };
    await log(context, 'error', `Policy endpoint cleanup instance was not accepted: ${safeError(error)}`);
    throw error;
  }
  history.cleanup = { scheduled: true, instanceId: accepted.id };
  await log(context, 'info', `Policy endpoint cleanup instance accepted: ${accepted.id}`);
  await log(context, 'info', `Policy external cleanup completed: ${policy.policyId}`);
  return history;
}

module.exports = { applyEdit, cleanupDeselectedControls, cleanupPolicy, disablePolicy, enablePolicy, createAndReplaceAutomation, getRemovedControlIds };
