const { buildAutomationDefinitions } = require('./automationDefinition');
const { createAction1AutomationClient } = require('./action1AutomationClient');
const { signedInstancePayload } = require('./action1AutomationClient');
const { requiresETPSigning } = require('./action1DiscoveryClient');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { planLifecycleDiff, summarizeLifecycleDiff } = require('./lifecyclePlanner');
const { formatRuntimeElapsed, writeAction1RuntimeLog, writeOperationalLog } = require('./runtimeLogging');
const { classifyMissingAutomationGet, normalizeApi4AutomationLookup } = require('./action1AutomationClient');
const { appendProgressCheckpoint, progressCheckpoint } = require('./lifecycleProgress');
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
  if (ids.length === 0 && !options.instance) return null;
  const client = options.client || createAction1AutomationClient(context);
  await log(context, 'info', `Control state cleanup started: policy=${policy.policyId} removedControls=${ids.length}`);
  try {
    const instance = options.instance || buildDeselectedControlCleanupInstance(policy, ids);
    await validateCleanupSigning(client, policy, instance, options.signedCleanup);
    const accepted = await client.createAutomationInstance(policy.organizationId, instance, options.signedCleanup);
    if (!accepted?.id) throw new Error('Action1 deselected-Control cleanup instance was not accepted.');
    await log(context, 'info', `Control state cleanup accepted: policy=${policy.policyId} removedControls=${ids.length}`);
    return { scheduled: true, instanceId: accepted.id, removedControlCount: ids.length };
  } catch (error) {
    await log(context, 'error', `Control state cleanup failed: policy=${policy.policyId} removedControls=${ids.length} message=${safeError(error)}`);
    error.history = {
      ...(error.history || {}),
      errorCategory: error.history?.errorCategory || 'Endpoint cleanup instance create failed',
      removedControlCount: ids.length
    };
    throw error;
  }
}

async function createAndReplaceAutomation(context, policy, definition, client, correlations, signed) {
  const created = await client.createAutomation(policy.organizationId, definition, signed);
  await correlations.activateCorrelation({
    policyId: policy.policyId,
    automationGroupId: definition.automationGroupId,
    automationGroupVersion: definition.automationGroupVersion,
    controlFamilyNameSnapshot: definition.familyName,
    action1OrganizationId: policy.organizationId,
    action1AutomationId: created.id,
    action1AutomationConfigurationId: created.configurationId || null,
    action1AutomationActionId: created.actionId,
    action1AutomationName: created.name,
    action1AutomationSelf: created.self,
    desiredDefinitionFingerprint: definition.fingerprint,
    lastAppliedAt: new Date().toISOString()
  });
  return created;
}

async function recoverConfigurationId(client, correlation, organizationId, correlations) {
  if (correlation.action1AutomationConfigurationId) return correlation.action1AutomationConfigurationId;
  if (typeof client.resolveConnection !== 'function') return null;
  const connection = await client.resolveConnection();
  if (connection?.apiGeneration !== 4) return null;
  const observed = await client.observeAutomation(organizationId, correlation.action1AutomationId);
  if (observed?.state !== 'EXISTS' || observed.automation?.configurationId == null) {
    throw new Error('Action1 automation configuration id could not be recovered from the existing API 4.0 schedule.');
  }
  const configurationId = String(observed.automation.configurationId).trim();
  if (!configurationId) throw new Error('Action1 automation configuration id could not be recovered from the existing API 4.0 schedule.');
  await correlations.updateConfigurationId(correlation.policyId, correlation.automationGroupId, configurationId);
  correlation.action1AutomationConfigurationId = configurationId;
  return configurationId;
}

async function planSignedEdit(context, previousPolicy, desiredPolicy, options = {}) {
  if (previousPolicy.policyId !== desiredPolicy.policyId) throw new Error('An existing Policy is required for signed editing.');
  if (previousPolicy.organizationId !== desiredPolicy.organizationId || previousPolicy.scopeType !== desiredPolicy.scopeType
    || (previousPolicy.endpointGroupId || '') !== (desiredPolicy.endpointGroupId || '')) throw new Error('Organization and scope are immutable after a Policy is created.');
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const current = await correlations.listCorrelations(previousPolicy.policyId);
  const operations = previousPolicy.enabled ? planLifecycleDiff(buildAutomationDefinitions(desiredPolicy), current) : [];
  const removed = getRemovedControlIds(previousPolicy, desiredPolicy);
  const cleanupInstance = removed.length ? buildDeselectedControlCleanupInstance(desiredPolicy, removed) : null;
  const remote = await inspectSignedOperations(client, previousPolicy, operations);
  return { operations, snapshot: signedPlanSnapshot(previousPolicy, desiredPolicy, current, operations, remote), cleanupInstance };
}

async function inspectSignedOperations(client, previousPolicy, operations) {
  const remote = {};
  for (const operation of operations) {
    const correlation = operation.correlation;
    if (!correlation) continue;
    if (correlation.action1OrganizationId !== previousPolicy.organizationId) throw new Error('Automation correlation organization does not match the Policy.');
    let payload;
    try { payload = await client.getAutomation(previousPolicy.organizationId, correlation.action1AutomationId); }
    catch (error) {
      if (!classifyMissingAutomationGet(error, correlation.action1AutomationId)) throw error;
      remote[operation.automationGroupId] = null;
      if (operation.type !== 'DELETE') operation.type = 'CREATE';
      continue;
    }
    const observed = normalizeApi4AutomationLookup(payload, correlation.action1AutomationId, previousPolicy.organizationId);
    if (!observed) throw new Error('The existing API 4.0 schedule or its identities could not be verified.');
    if ((correlation.action1AutomationConfigurationId && correlation.action1AutomationConfigurationId !== observed.configurationId)
      || (correlation.action1AutomationActionId && correlation.action1AutomationActionId !== observed.actionId)) {
      throw new Error('Remote schedule configuration or action identity changed. Review the Policy before signing.');
    }
    operation.correlation = { ...correlation, action1AutomationConfigurationId: observed.configurationId, action1AutomationActionId: observed.actionId };
    remote[operation.automationGroupId] = { configuration: payload.configuration,
      endpoints: (payload.endpoints || []).map(e => ({ id: e.id, type: e.type })) };
  }
  return remote;
}

function signedPlanSnapshot(previousPolicy, desiredPolicy, current, operations, remote) {
  const snapshotPolicy = policy => Object.fromEntries(['policyId', 'enabled', 'baseName', 'description', 'organizationId', 'organizationNameSnapshot',
    'scopeType', 'endpointGroupId', 'endpointGroupNameSnapshot', 'policyMode', 'runSchedule', 'completionDeadlineMinutes',
    'controlPackId', 'controlPackVersion', 'selectedControls'].map(key => [key, policy[key]]));
  // Bound into signing object IDs, not persisted or sent as a new host envelope.
  const snapshot = JSON.parse(JSON.stringify({ previous: snapshotPolicy(previousPolicy), desired: snapshotPolicy(desiredPolicy),
    current: current.map(c => ({ group: c.automationGroupId, resource: c.action1AutomationId,
      configuration: c.action1AutomationConfigurationId, action: c.action1AutomationActionId, active: c.active, fingerprint: c.desiredDefinitionFingerprint })),
    operations: operations.map(o => ({ type: o.type, group: o.automationGroupId })), remote }));
  return snapshot;
}

async function planSignedDelete(context, policy, options = {}) {
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const current = await correlations.listCorrelations(policy.policyId, { includeInactive: true });
  const operations = current.filter(c => c.active !== false).map(c => ({ type: 'DELETE', automationGroupId: c.automationGroupId, correlation: c }));
  const remote = await inspectSignedOperations(client, policy, operations);
  return { operations, snapshot: signedPlanSnapshot(policy, policy, current, operations, remote),
    cleanupInstance: buildPolicyEndpointCleanupInstance(policy) };
}

async function validateCleanupSigning(client, policy, instance, signed) {
  if (typeof client.resolveConnection !== 'function') return;
  const connection = await client.resolveConnection();
  if (requiresETPSigning(connection)) signedInstancePayload(instance, policy.organizationId, signed, connection);
  else if (signed) throw new Error('Marketplace connection changed. Prepare the Policy operation again.');
}

async function applyEdit(context, previousPolicy, desiredPolicy, options = {}) {
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const current = await correlations.listCorrelations(previousPolicy.policyId);
  const definitions = buildAutomationDefinitions(desiredPolicy);
  const operations = options.operations || planLifecycleDiff(definitions, current);
  if (options.signedSchedules) {
    for (const operation of operations.filter(o => ['CREATE', 'PATCH'].includes(o.type))) {
      const signed = options.signedSchedules.get(operation.automationGroupId);
      if (!signed || !Number.isFinite(signed.expiresAt) || Date.now() > signed.expiresAt) {
        throw new Error('Policy edit signing is incomplete or expired. Prepare the edit again before applying any changes.');
      }
    }
  }
  const removedControlIds = getRemovedControlIds(previousPolicy, desiredPolicy);
  let cleanup = null;
  const cleanupInstance = options.cleanupInstance || (removedControlIds.length
    ? buildDeselectedControlCleanupInstance(desiredPolicy, removedControlIds) : null);
  if (cleanupInstance) {
    await validateCleanupSigning(client, desiredPolicy, cleanupInstance, options.signedSchedules?.get('cleanup'));
  }
  if (removedControlIds.length || cleanupInstance) {
    cleanup = await cleanupDeselectedControls(context, desiredPolicy, removedControlIds, { ...options, client, instance: cleanupInstance,
      signedCleanup: options.signedSchedules?.get('cleanup') });
  }
  const orderedOperations = [...operations.filter(operation => operation.type === 'DELETE'),
    ...operations.filter(operation => operation.type !== 'DELETE')];
  const summary = summarizeLifecycleDiff(operations);
  const applied = { updated: 0, created: 0, deleted: 0, unchanged: summary.unchanged, failed: 0 };
  const familyOutcomes = [];
  let currentFamilyName = '';
  await log(context, 'debug', `Policy Edit diff: unchanged=${summary.unchanged} patch=${summary.patch} create=${summary.create} delete=${summary.delete}`);

  try {
    for (const operation of orderedOperations) {
      const family = operation.definition?.familyName || operation.correlation?.controlFamilyNameSnapshot || operation.automationGroupId;
      currentFamilyName = family;
      if (operation.type === 'UNCHANGED') {
        const observed = await client.observeAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId);
        if (observed.state === 'UNRESOLVED') throw observed.error || new Error(`Unable to verify Action1 automation for ${family}.`);
        if (observed.state === 'MISSING') {
          if (options.signedSchedules) throw new Error('Schedule disappeared after signing. Prepare a new reviewed edit; no replacement was submitted.');
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
        await log(context, 'info', `Automation patch started: policyId=${desiredPolicy.policyId} family=${family} automationId=${operation.correlation.action1AutomationId} automationName=${operation.definition.name}`);
        let updated;
        try {
          const configurationId = options.signedSchedules ? operation.correlation.action1AutomationConfigurationId
            : await recoverConfigurationId(client, operation.correlation, desiredPolicy.organizationId, correlations);
          updated = await client.updateAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId, operation.definition,
            operation.correlation.action1AutomationActionId, configurationId, options.signedSchedules?.get(operation.automationGroupId));
        } catch (error) {
          if (options.signedSchedules) throw error;
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
        const appliedCorrelation = {
          automationGroupVersion: operation.definition.automationGroupVersion,
          controlFamilyNameSnapshot: operation.definition.familyName,
          action1AutomationName: updated.name,
          action1AutomationSelf: updated.self,
          desiredDefinitionFingerprint: operation.definition.fingerprint,
          lastAppliedAt: new Date().toISOString()
        };
        if (options.signedSchedules) {
          await correlations.activateCorrelation({ ...operation.correlation, ...appliedCorrelation,
            policyId: desiredPolicy.policyId, automationGroupId: operation.automationGroupId,
            action1OrganizationId: desiredPolicy.organizationId });
        } else await correlations.updateCorrelation(desiredPolicy.policyId, operation.automationGroupId, appliedCorrelation);
        await log(context, 'info', `Automation patched: policyId=${desiredPolicy.policyId} family=${family} automationId=${operation.correlation.action1AutomationId}`);
        await log(context, 'debug', `PATCH family completed: ${family}`);
        applied.updated += 1;
        familyOutcomes.push({ familyName: family, outcome: 'Updated' });
      } else if (operation.type === 'CREATE') {
        await log(context, 'info', `Automation create started: policyId=${desiredPolicy.policyId} family=${family} automationName=${operation.definition.name} scope=${desiredPolicy.scopeType}`);
        const created = await createAndReplaceAutomation(context, desiredPolicy, operation.definition, client, correlations, options.signedSchedules?.get(operation.automationGroupId));
        await log(context, 'info', `Automation created: policyId=${desiredPolicy.policyId} family=${family} automationId=${created.id}`);
        await log(context, 'debug', `Correlation activated: ${operation.automationGroupId}`);
        await log(context, 'debug', `CREATE family completed: ${family}`);
        applied.created += 1;
        familyOutcomes.push({ familyName: family, outcome: 'Created' });
      } else if (operation.type === 'DELETE') {
        await log(context, 'info', `Automation delete started: policyId=${desiredPolicy.policyId} family=${family} automationId=${operation.correlation.action1AutomationId}`);
        await log(context, 'debug', `Deleting Action1 automation ${operation.correlation.action1AutomationId}`);
        const deletion = await client.deleteAutomation(desiredPolicy.organizationId, operation.correlation.action1AutomationId);
        await correlations.markInactive(desiredPolicy.policyId, operation.automationGroupId);
        if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${operation.correlation.action1AutomationId}; cleanup satisfied`);
        await log(context, 'debug', `Correlation marked inactive: ${operation.automationGroupId}`);
        await log(context, 'info', `Automation deleted: policyId=${desiredPolicy.policyId} family=${family} automationId=${operation.correlation.action1AutomationId}`);
        applied.deleted += 1;
        familyOutcomes.push({ familyName: family, outcome: 'Removed' });
      }
    }
    applied.removedControls = removedControlIds.length;
    await log(context, 'info', `Policy Edit completed: ${desiredPolicy.policyId}`);
    return { policy: desiredPolicy, history: { counts: applied, familyOutcomes, cleanup } };
  } catch (error) {
    if (currentFamilyName && !familyOutcomes.some((outcome) => outcome.familyName === currentFamilyName && outcome.outcome === 'Failed')) {
      familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    }
    error.history = { counts: { ...applied, removedControls: removedControlIds.length, failed: Math.max(1, operations.length - familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes, cleanup };
    await log(context, 'error', `Policy Edit failed: ${desiredPolicy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function disablePolicy(context, policy, options = {}) {
  const startedAt = Date.now();
  const client = options.client || createAction1AutomationClient(context);
  const correlations = options.correlations || createAutomationCorrelationStore(context);
  const active = await correlations.listCorrelations(policy.policyId);
  const history = { counts: { deleted: 0, failed: 0 }, familyOutcomes: [] };
  let currentFamilyName = '';
  await log(context, 'debug', `Disable started: ${policy.policyId}`);
  try {
    for (const correlation of active) {
      currentFamilyName = correlation.controlFamilyNameSnapshot;
      await log(context, 'debug', `DELETE family started: ${correlation.controlFamilyNameSnapshot}`);
      await log(context, 'debug', `Automation delete started: policyId=${policy.policyId} family=${correlation.controlFamilyNameSnapshot} automationId=${correlation.action1AutomationId}`);
      const deletion = await client.deleteAutomation(policy.organizationId, correlation.action1AutomationId);
      await correlations.markInactive(policy.policyId, correlation.automationGroupId);
      if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${correlation.action1AutomationId}; cleanup satisfied`);
      await log(context, 'debug', `Automation deleted: policyId=${policy.policyId} family=${correlation.controlFamilyNameSnapshot} automationId=${correlation.action1AutomationId}`);
      history.counts.deleted += 1;
      history.familyOutcomes.push({ familyName: correlation.controlFamilyNameSnapshot, outcome: 'Removed' });
    }
    await writeOperationalLog(context, 'info', 'Scheduled Automations deleted', { policy: policy.policyId, deleted: history.counts.deleted });
    await writeOperationalLog(context, 'info', 'Policy disable completed', { policy: policy.policyId, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
    return history;
  } catch (error) {
    if (currentFamilyName) history.familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    error.history = { counts: { ...history.counts, failed: Math.max(1, active.length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes: history.familyOutcomes };
    await log(context, 'error', `Disable partial failure: ${policy.policyId}, message=${safeError(error)}`);
    throw error;
  }
}

async function enablePolicy(context, policy, options = {}) {
  const startedAt = Date.now();
  const client = createAction1AutomationClient(context);
  const correlations = createAutomationCorrelationStore(context);
  const definitions = buildAutomationDefinitions(policy);
  const signedSchedules = options.signedSchedules;
  const existing = signedSchedules ? await correlations.listCorrelations(policy.policyId) : [];
  for (const correlation of existing) {
    if (signedSchedules.get(correlation.automationGroupId)?.configuration.id !== correlation.action1AutomationConfigurationId) {
      throw new Error('Policy correlations changed. Review existing automations before retrying.');
    }
  }
  const history = { counts: { created: 0, failed: 0 }, familyOutcomes: [] };
  let currentFamilyName = '';
  await log(context, 'debug', `Enable started: ${policy.policyId}`);
  try {
    for (const definition of definitions) {
      currentFamilyName = definition.familyName;
      await log(context, 'debug', `Automation create started: policyId=${policy.policyId} family=${definition.familyName} automationName=${definition.name} scope=${policy.scopeType}`);
      if (existing.some(c => c.automationGroupId === definition.automationGroupId)) {
        history.counts.created += 1;
        history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Unchanged' });
        continue;
      }
      const created = await client.createAutomation(policy.organizationId, definition, signedSchedules?.get(definition.automationGroupId));
      await correlations.activateCorrelation({
        policyId: policy.policyId,
        automationGroupId: definition.automationGroupId,
        automationGroupVersion: definition.automationGroupVersion,
        controlFamilyNameSnapshot: definition.familyName,
        action1OrganizationId: policy.organizationId,
        action1AutomationId: created.id,
        action1AutomationConfigurationId: created.configurationId || null,
        action1AutomationActionId: created.actionId,
        action1AutomationName: created.name,
        action1AutomationSelf: created.self,
        desiredDefinitionFingerprint: definition.fingerprint,
        lastAppliedAt: new Date().toISOString()
      });
      await log(context, 'debug', `Automation created: policyId=${policy.policyId} family=${definition.familyName} automationId=${created.id}`);
      await log(context, 'debug', `Correlation activated/replaced: ${definition.automationGroupId}`);
      history.counts.created += 1;
      history.familyOutcomes.push({ familyName: definition.familyName, outcome: 'Created' });
    }
    await writeOperationalLog(context, 'info', 'Scheduled Automations created', { policy: policy.policyId, created: history.counts.created });
    await writeOperationalLog(context, 'info', 'Policy enable completed', { policy: policy.policyId, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
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
  const active = owned.filter((entry) => entry.active !== false);
  const cleanupInstance = options.cleanupInstance || buildPolicyEndpointCleanupInstance(policy);
  const history = { counts: { deleted: 0, failed: 0 }, familyOutcomes: [] };
  let accepted;
  try {
    await validateCleanupSigning(client, policy, cleanupInstance, options.signedCleanup);
    accepted = await client.createAutomationInstance(policy.organizationId, cleanupInstance, options.signedCleanup);
    if (!accepted?.id) throw new Error('Action1 endpoint cleanup instance was not accepted.');
  } catch (error) {
    error.history = {
      counts: { deleted: 0, failed: 1 }, familyOutcomes: [], ...(error.history || {}),
      errorCategory: error.history?.errorCategory || 'Endpoint cleanup instance create failed'
    };
    await log(context, 'error', `Policy endpoint cleanup instance was not accepted: ${safeError(error)}`);
    throw error;
  }
  history.cleanup = { scheduled: true, instanceId: accepted.id };
  let currentFamilyName = '';
  await log(context, 'info', `Policy Delete started: ${policy.policyId}`);
  await appendProgressCheckpoint(options.run, progressCheckpoint({
    operation: 'delete', completed: 0, total: active.length, operationId: options.progressOperationId
  }));
  try {
    for (const correlation of active) {
      currentFamilyName = correlation.controlFamilyNameSnapshot;
      await log(context, 'info', `Automation delete started: policyId=${policy.policyId} family=${correlation.controlFamilyNameSnapshot} automationId=${correlation.action1AutomationId}`);
      const deletion = await client.deleteAutomation(policy.organizationId, correlation.action1AutomationId);
      await correlations.markInactive(policy.policyId, correlation.automationGroupId);
      if (deletion.status === 'alreadyAbsent') await log(context, 'info', `Action1 automation already absent: ${correlation.action1AutomationId}; cleanup satisfied`);
      await log(context, 'debug', `Correlation marked inactive: ${correlation.automationGroupId}`);
      history.counts.deleted += 1;
      history.familyOutcomes.push({ familyName: correlation.controlFamilyNameSnapshot, outcome: 'Removed' });
      await appendProgressCheckpoint(options.run, progressCheckpoint({
        operation: 'delete', completed: history.counts.deleted, total: active.length, operationId: options.progressOperationId
      }));
    }
  } catch (error) {
    if (currentFamilyName) history.familyOutcomes.push({ familyName: currentFamilyName, outcome: 'Failed' });
    error.history = { counts: { ...history.counts, failed: Math.max(1, owned.filter((entry) => entry.active !== false).length - history.familyOutcomes.filter((outcome) => outcome.outcome !== 'Failed').length) }, familyOutcomes: history.familyOutcomes, cleanup: history.cleanup };
    throw error;
  }
  await log(context, 'info', `Policy endpoint cleanup instance accepted: ${accepted.id}`);
  await log(context, 'info', `Policy cleanup request accepted: ${policy.policyId}`);
  return history;
}

module.exports = { planSignedEdit, planSignedDelete, applyEdit, cleanupDeselectedControls, cleanupPolicy, disablePolicy, enablePolicy, createAndReplaceAutomation, getRemovedControlIds };
