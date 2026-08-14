const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { planLifecycleDiff, summarizeLifecycleDiff } = require('./lifecyclePlanner');
const { writeAction1RuntimeLog } = require('./runtimeLogging');

function safeError(error) {
  return String(error?.message || error || 'Lifecycle mutation failed').slice(0, 1000);
}

async function log(context, level, message) {
  await writeAction1RuntimeLog(context, level, message);
}

async function applyEdit(context, previousPolicy, desiredPolicy) {
  const client = createAction1AutomationClient(context);
  const correlations = createAutomationCorrelationStore(context);
  const current = await correlations.listCorrelations(previousPolicy.policyId);
  const definitions = buildAutomationDefinitions(desiredPolicy);
  const operations = planLifecycleDiff(definitions, current);
  const summary = summarizeLifecycleDiff(operations);
  await log(context, 'info', `Policy Edit started: ${desiredPolicy.policyId}`);
  await log(context, 'debug', `Policy Edit diff: unchanged=${summary.unchanged} patch=${summary.patch} create=${summary.create} delete=${summary.delete}`);

  try {
    for (const operation of operations) {
      const family = operation.definition?.familyName || operation.correlation?.controlFamilyNameSnapshot || operation.automationGroupId;
      if (operation.type === 'UNCHANGED') continue;
      if (operation.type === 'PATCH') {
        await log(context, 'debug', `PATCH family started: ${family}`);
        const updated = await client.updateAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId, operation.definition);
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
      } else if (operation.type === 'CREATE') {
        await log(context, 'debug', `CREATE family started: ${family}`);
        const created = await client.createAutomation(desiredPolicy.organizationId, operation.definition);
        await correlations.activateCorrelation({
          policyId: desiredPolicy.policyId,
          automationGroupId: operation.definition.automationGroupId,
          automationGroupVersion: operation.definition.automationGroupVersion,
          controlFamilyNameSnapshot: operation.definition.familyName,
          action1OrganizationId: desiredPolicy.organizationId,
          action1AutomationId: created.id,
          action1AutomationName: created.name,
          action1AutomationSelf: created.self,
          desiredDefinitionFingerprint: operation.definition.fingerprint,
          lastAppliedAt: new Date().toISOString()
        });
        await log(context, 'debug', `Action1 automation created: ${created.id}`);
        await log(context, 'debug', `Correlation activated: ${operation.automationGroupId}`);
        await log(context, 'debug', `CREATE family completed: ${family}`);
      } else if (operation.type === 'DELETE') {
        await log(context, 'debug', `DELETE family started: ${family}`);
        await log(context, 'debug', `Deleting Action1 automation ${operation.correlation.action1AutomationId}`);
        const deletion = await client.deleteAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId);
        await correlations.markInactive(desiredPolicy.policyId, operation.automationGroupId);
        if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${operation.correlation.action1AutomationId}; cleanup satisfied`);
        await log(context, 'debug', `Correlation marked inactive: ${operation.automationGroupId}`);
        await log(context, 'debug', `DELETE family completed: ${family}`);
      }
    }
    await log(context, 'info', `Policy Edit completed: ${desiredPolicy.policyId}`);
    return desiredPolicy;
  } catch (error) {
    await log(context, 'error', `Policy Edit failed: ${desiredPolicy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function disablePolicy(context, policy) {
  const client = createAction1AutomationClient(context);
  const correlations = createAutomationCorrelationStore(context);
  const active = await correlations.listCorrelations(policy.policyId);
  await log(context, 'info', `Disable started: ${policy.policyId}`);
  try {
    for (const correlation of active) {
      await log(context, 'debug', `DELETE family started: ${correlation.controlFamilyNameSnapshot}`);
      await log(context, 'debug', `Deleting Action1 automation ${correlation.action1AutomationId}`);
      const deletion = await client.deleteAutomation(policy.organizationId, correlation.action1AutomationId);
      await correlations.markInactive(policy.policyId, correlation.automationGroupId);
      if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${correlation.action1AutomationId}; cleanup satisfied`);
      await log(context, 'debug', `Correlation marked inactive: ${correlation.automationGroupId}`);
    }
    await log(context, 'info', `Disable completed: ${policy.policyId}`);
    return true;
  } catch (error) {
    await log(context, 'error', `Disable partial failure: ${policy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function enablePolicy(context, policy) {
  const client = createAction1AutomationClient(context);
  const correlations = createAutomationCorrelationStore(context);
  const definitions = buildAutomationDefinitions(policy);
  await log(context, 'info', `Enable started: ${policy.policyId}`);
  try {
    for (const definition of definitions) {
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
    }
    await log(context, 'info', `Enable completed: ${policy.policyId}`);
    return true;
  } catch (error) {
    await log(context, 'error', `Enable partial failure: ${policy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function cleanupPolicy(context, policy) {
  const client = createAction1AutomationClient(context);
  const correlations = createAutomationCorrelationStore(context);
  const owned = await correlations.listCorrelations(policy.policyId, { includeInactive: true });
  await log(context, 'info', `Policy Delete started: ${policy.policyId}`);
  for (const correlation of owned.filter((entry) => entry.active !== false)) {
    await log(context, 'debug', `Deleting Action1 automation ${correlation.action1AutomationId}`);
    const deletion = await client.deleteAutomation(policy.organizationId, correlation.action1AutomationId);
    await correlations.markInactive(policy.policyId, correlation.automationGroupId);
    if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${correlation.action1AutomationId}; cleanup satisfied`);
    await log(context, 'debug', `Correlation marked inactive: ${correlation.automationGroupId}`);
  }
  await log(context, 'info', `Policy external cleanup completed: ${policy.policyId}`);
}

module.exports = { applyEdit, cleanupPolicy, disablePolicy, enablePolicy };
