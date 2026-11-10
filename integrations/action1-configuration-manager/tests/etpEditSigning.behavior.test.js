const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { loadPolicyCatalogContract, normalizeParameterValues } = require('../policyCatalogContract');
const { normalizeAndValidatePolicyInput } = require('../policyStore');
const { buildAutomationDefinitions } = require('../automationDefinition');
const { buildApi4CreatePayload, createAction1AutomationClient } = require('../action1AutomationClient');
const { planSignedEdit, planSignedDelete, applyEdit, cleanupPolicy, cleanupDeselectedControls } = require('../lifecycleMutations');
const { prepareScheduleSigning, getSignedSchedules } = require('../scheduleSigning');
const { buildPolicyEndpointCleanupInstance } = require('../policyEndpointCleanup');

function digest(value) {
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function fixture() {
  const catalog = loadPolicyCatalogContract(), seen = new Set();
  const controls = Object.values(catalog.controlsById).filter(c => {
    if (seen.has(c.automationGroupId) || seen.size >= 3) return false;
    seen.add(c.automationGroupId); return true;
  }).map(c => ({ controlId: c.controlId, controlVersion: c.version, automationGroupId: c.automationGroupId,
    automationGroupVersion: catalog.controlFamiliesById[c.automationGroupId].version, parameters: normalizeParameterValues(c, {}) }));
  const previous = normalizeAndValidatePolicyInput({ mode: 'edit', policyId: 'POL-000001', baseName: 'Signed edit', enabled: true,
    organizationId: 'synthetic-org', organizationName: 'Synthetic org', scopeType: 'ENDPOINT_GROUP', endpointGroupId: 'group', endpointGroupName: 'Group',
    policyMode: 'ASSESS_ONLY', runSchedule: { runEveryHours: 6, startDate: '2026-11-05', startTime: '09:00', timezone: 'UTC' },
    completionDeadlineMinutes: 360, selectedControls: [controls[0]] }, catalog);
  const desired = normalizeAndValidatePolicyInput({ ...previous, baseName: 'Changed signed edit', selectedControls: controls.slice(0, 2) }, catalog);
  const initialDefinition = buildAutomationDefinitions(previous)[0];
  const initial = buildApi4CreatePayload(initialDefinition, previous.organizationId, crypto.randomUUID).payload;
  const rows = [{ policyId: previous.policyId, automationGroupId: initialDefinition.automationGroupId,
    automationGroupVersion: initialDefinition.automationGroupVersion, controlFamilyNameSnapshot: initialDefinition.familyName,
    action1OrganizationId: previous.organizationId, action1AutomationId: 'resource-1', action1AutomationConfigurationId: initial.configuration.id,
    action1AutomationActionId: initial.configuration.actions[0].id, action1AutomationName: initialDefinition.name,
    action1AutomationSelf: 'https://app.action1.test/api/4.0/automations/schedules/synthetic-org/resource-1',
    desiredDefinitionFingerprint: initialDefinition.fingerprint, active: true }];
  const remotes = new Map([['resource-1', { id: 'resource-1', type: 'AutomationSchedule', ...initial }]]);
  const calls = [], jobs = new Map();
  let failPatch = false, failCreate = false, failInstance = false, failDelete = false;
  const context = { integrationId: 'action1-configuration-manager', logger: { info() {}, warn() {}, error() {} },
    action1: { getCredentials: async () => ({ apiKey: 'synthetic-client', apiSecret: 'synthetic-secret', baseUrl: 'https://app.action1.test/api/4.0', etpEnabled: true, etpMode: 'etp' }),
      provisioner: {
        async prepareSigning(input) {
          calls.push({ method: 'PREPARE' });
          let job = jobs.get(input.idempotencyKey);
          if (job && digest(job.objects) !== digest(input.objects)) throw Error('Signing intent changed');
          if (!job) {
            job = { id: crypto.randomUUID(), purpose: 'sign-only', integrationId: context.integrationId, digest: digest(input.objects),
              origin: 'https://app.action1.test', state: 'awaiting_signature', expiresAt: Date.now() + 60000, objects: structuredClone(input.objects) };
            jobs.set(input.idempotencyKey, job);
          }
          return { ok: true, signingId: job.id, digest: job.digest, outcome: job.state };
        },
        async getSigning(id) { return [...jobs.values()].find(j => j.id === id); }
      } },
    async http(input) {
      calls.push(input);
      if (input.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'synthetic-token', expires_in: 3600 } };
      const resourceId = input.url.split('/').pop();
      if (input.method === 'GET') {
        if (!remotes.has(resourceId)) return { status: 404, data: { message: `Automation with id=${resourceId} not found` }, headers: { 'content-type': 'application/json' } };
        return { status: 200, data: structuredClone(remotes.get(resourceId)) };
      }
      if (input.method === 'PATCH' && failPatch) throw Object.assign(Error('PATCH failed'), { statusCode: 500 });
      if (input.url.includes('/automations/instances/')) {
        if (failInstance) throw Object.assign(Error('Instance POST outcome unresolved'), { statusCode: 500 });
        return { status: 200, data: { id: 'cleanup-resource', type: 'AutomationInstance', status: 'Running', actions: input.data.configuration.actions } };
      }
      if (input.method === 'POST' && failCreate) throw Object.assign(Error('POST failed'), { statusCode: 500 });
      if (input.method === 'DELETE') {
        if (failDelete) throw Object.assign(Error('DELETE failed'), { statusCode: 500 });
        remotes.delete(resourceId); return { status: 200, data: { type: 'Success', status: 200 } };
      }
      const id = input.method === 'PATCH' ? resourceId : `created-${remotes.size}`;
      const result = { id, type: 'AutomationSchedule', ...input.data };
      remotes.set(id, structuredClone(result));
      return { status: 200, data: result };
    } };
  const correlations = {
    listCorrelations: async (_id, options = {}) => structuredClone(rows.filter(r => options.includeInactive || r.active)),
    async activateCorrelation(input) {
      const index = rows.findIndex(r => r.automationGroupId === input.automationGroupId);
      if (index < 0) rows.push({ ...input, active: true }); else rows[index] = { ...input, active: true };
    },
    async updateCorrelation(_id, group, input) { Object.assign(rows.find(r => r.automationGroupId === group), input); },
    async markInactive(_id, group) { rows.find(r => r.automationGroupId === group).active = false; }
  };
  const client = createAction1AutomationClient(context);
  const options = { client, correlations };
  const intentId = crypto.randomUUID();
  async function plan() { return planSignedEdit(context, previous, desired, options); }
  async function prepare(editPlan, operation = 'edit') { return prepareScheduleSigning(context, { policy: operation === 'delete' ? previous : desired, operation, intentId, editPlan }); }
  function sign() { for (const job of jobs.values()) { job.state = 'signed'; job.results = job.objects.map(o => ({ id: o.id,
    configurationDigest: digest(o.configuration), signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-signature' } })).reverse(); } }
  async function signed(prepared, editPlan, operation = 'edit') { return getSignedSchedules(context, { policy: operation === 'delete' ? previous : desired, operation, intentId, ...prepared, editPlan }); }
  const mutations = () => calls.filter(c => c.url?.includes('/automations/') && ['POST', 'PATCH', 'DELETE'].includes(c.method));
  return { context, previous, desired, controls, rows, remotes, calls, jobs, options, plan, prepare, sign, signed, mutations,
    planDelete: () => planSignedDelete(context, previous, options),
    failPatch: () => { failPatch = true; }, failCreate: () => { failCreate = true; }, setCreateFailure: value => { failCreate = value; },
    failInstance: () => { failInstance = true; }, failDelete: () => { failDelete = true; },
    setDeleteFailure: value => { failDelete = value; }, setInstanceFailure: value => { failInstance = value; } };
}

test('mixed edit preflights, signs one batch, preserves PATCH identities and submits exact host configurations', async () => {
  const f = fixture(), editPlan = await f.plan();
  const identity = structuredClone(f.rows[0]);
  assert.deepEqual(editPlan.operations.map(o => o.type).sort(), ['CREATE', 'PATCH']);
  const prepared = await f.prepare(editPlan);
  assert.equal(f.jobs.size, 1);
  assert.equal([...f.jobs.values()][0].objects.length, 2);
  assert.equal(f.mutations().length, 0);
  f.sign();
  const current = await f.plan(), signedSchedules = await f.signed(prepared, current);
  const result = await applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: current.operations, signedSchedules });
  assert.equal(result.history.counts.updated, 1);
  assert.equal(result.history.counts.created, 1);
  const patch = f.mutations().find(c => c.method === 'PATCH');
  assert(patch.url.endsWith('/resource-1'));
  assert.equal(patch.data.configuration.id, identity.action1AutomationConfigurationId);
  assert.equal(patch.data.configuration.actions[0].id, identity.action1AutomationActionId);
  for (const mutation of f.mutations()) {
    const original = [...f.jobs.values()][0].objects.find(o => o.configuration.id === mutation.data.configuration.id).configuration;
    assert.equal(JSON.stringify(mutation.data.configuration), JSON.stringify(original));
    assert.equal(mutation.data.signatures.length, 1);
  }
  assert.equal(f.rows[0].action1AutomationId, 'resource-1');
});

test('cancelled signing, changed draft, remote drift and missing-after-signing prevent every edit mutation', async () => {
  for (const change of ['cancel', 'draft', 'remote', 'missing']) {
    const f = fixture(), prepared = await f.prepare(await f.plan());
    if (change !== 'cancel') f.sign();
    if (change === 'draft') f.desired.baseName = 'Tampered';
    if (change === 'remote') f.remotes.get('resource-1').configuration.name = 'Other editor';
    if (change === 'missing') f.remotes.delete('resource-1');
    await assert.rejects(async () => f.signed(prepared, await f.plan()), undefined, change);
    assert.equal(f.mutations().length, 0);
  }
});

test('cleanup-required edits prepare a cleanup entry before any resource mutation', async () => {
  const f = fixture();
  f.previous.selectedControls.push(f.desired.selectedControls[1]);
  f.desired.selectedControls = [f.desired.selectedControls[0]];
  const plan = await f.plan();
  assert(plan.cleanupInstance);
  await f.prepare(plan);
  assert.equal([...f.jobs.values()][0].objects.length, 2);
  assert.equal(f.mutations().length, 0);
});

test('missing persisted configuration/action identities recover from GET without persistence before signing', async () => {
  const f = fixture();
  f.rows[0].action1AutomationConfigurationId = null;
  f.rows[0].action1AutomationActionId = null;
  const editPlan = await f.plan();
  const patch = editPlan.operations.find(o => o.type === 'PATCH');
  assert.equal(patch.correlation.action1AutomationConfigurationId, f.remotes.get('resource-1').configuration.id);
  assert.equal(patch.correlation.action1AutomationActionId, f.remotes.get('resource-1').configuration.actions[0].id);
  assert.equal(f.rows[0].action1AutomationConfigurationId, null);
  const prepared = await f.prepare(editPlan); f.sign();
  const signedSchedules = await f.signed(prepared, await f.plan());
  await applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: editPlan.operations, signedSchedules });
  assert.equal(f.rows[0].action1AutomationConfigurationId, patch.correlation.action1AutomationConfigurationId);
  assert.equal(f.rows[0].action1AutomationActionId, patch.correlation.action1AutomationActionId);
});

test('late missing PATCH never falls back to POST or a second signing batch', async () => {
  const f = fixture();
  f.desired.selectedControls = f.previous.selectedControls;
  const editPlan = await f.plan(), prepared = await f.prepare(editPlan); f.sign();
  const signedSchedules = await f.signed(prepared, await f.plan());
  f.context.http = async input => {
    f.calls.push(input);
    throw Object.assign(Error('Schedule missing'), { statusCode: 404, diagnostics: { responseContentType: 'application/json', errorMessage: 'Automation with id=resource-1 not found' } });
  };
  await assert.rejects(() => applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: editPlan.operations, signedSchedules }));
  assert.equal(f.mutations().some(c => c.method === 'POST'), false);
  assert.equal(f.jobs.size, 1);
});

test('unsigned DELETE waits for all required signatures and preserves lifecycle ordering', async () => {
  const f = fixture();
  f.rows.push({ ...f.rows[0], automationGroupId: 'aaa-obsolete', action1AutomationId: 'obsolete' });
  f.remotes.set('obsolete', { ...structuredClone(f.remotes.get('resource-1')), id: 'obsolete' });
  const editPlan = await f.plan(), prepared = await f.prepare(editPlan);
  await assert.rejects(() => f.signed(prepared, editPlan));
  assert.equal(f.mutations().length, 0);
  f.sign();
  const signedSchedules = await f.signed(prepared, await f.plan());
  const expiry = [...signedSchedules.values()][0].expiresAt;
  for (const signed of signedSchedules.values()) signed.expiresAt = Date.now() - 1;
  await assert.rejects(() => applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: editPlan.operations, signedSchedules }), /expired/i);
  assert.equal(f.mutations().length, 0, 'Expired approval must not permit an earlier unsigned DELETE');
  for (const signed of signedSchedules.values()) signed.expiresAt = expiry;
  await applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: editPlan.operations, signedSchedules });
  assert.equal(f.mutations()[0].method, 'DELETE');
  assert.equal(f.mutations()[0].data, undefined);
});

test('a later POST failure retains an accepted PATCH correlation and reports partial failure', async () => {
  const f = fixture();
  const plan = await f.plan(), prepared = await f.prepare(plan); f.sign();
  const signedSchedules = await f.signed(prepared, await f.plan()); f.failCreate();
  // Put PATCH first to exercise partial success independently of family ordering.
  const operations = [...plan.operations].sort(o => o.type === 'PATCH' ? -1 : 1);
  await assert.rejects(() => applyEdit(f.context, f.previous, f.desired, { ...f.options, operations, signedSchedules }), error => {
    assert.equal(error.history.counts.updated, 1); return true;
  });
  assert.equal(f.rows[0].desiredDefinitionFingerprint, operations[0].definition.fingerprint);
  assert.equal(f.rows.length, 1);
});

test('confirmed missing schedules are finalized as signed replacements before the first mutation', async () => {
  const f = fixture(), previousIdentity = f.rows[0].action1AutomationConfigurationId;
  f.remotes.clear();
  const plan = await f.plan();
  assert(plan.operations.every(o => o.type === 'CREATE'));
  const prepared = await f.prepare(plan); f.sign();
  const current = await f.plan(), signedSchedules = await f.signed(prepared, current);
  assert.equal(f.mutations().length, 0);
  await applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: current.operations, signedSchedules });
  assert.equal(f.mutations().filter(c => c.method === 'POST').length, 2);
  assert.notEqual(f.rows[0].action1AutomationConfigurationId, previousIdentity);
});

test('unresolved lookups, persisted identity mismatches and immutable scope changes fail before preparation', async () => {
  for (const failure of ['malformed', 'mismatched-id', 'scope', 'unresolved']) {
    const f = fixture();
    if (failure === 'malformed') f.remotes.get('resource-1').configuration.actions = [];
    if (failure === 'mismatched-id') f.rows[0].action1AutomationActionId = 'wrong-action';
    if (failure === 'scope') f.desired.endpointGroupId = 'another-group';
    if (failure === 'unresolved') f.options.client.getAutomation = async () => { throw Object.assign(Error('Permission denied'), { statusCode: 403 }); };
    await assert.rejects(() => f.plan(), undefined, failure);
    assert.equal(f.calls.some(c => c.method === 'PREPARE'), false);
    assert.equal(f.mutations().length, 0);
  }
});

test('signed PATCH cannot target another resource or use an expired approval', async () => {
  for (const failure of ['resource', 'expiry']) {
    const f = fixture(), plan = await f.plan(), prepared = await f.prepare(plan); f.sign();
    const signed = await f.signed(prepared, await f.plan());
    const patch = plan.operations.find(o => o.type === 'PATCH'), item = signed.get(patch.automationGroupId);
    if (failure === 'expiry') item.expiresAt = Date.now() - 1;
    await assert.rejects(() => f.options.client.updateAutomation(f.desired.organizationId,
      failure === 'resource' ? 'another-resource' : patch.correlation.action1AutomationId,
      patch.definition, patch.correlation.action1AutomationActionId, patch.correlation.action1AutomationConfigurationId, item), /changed|expired/i);
    assert.equal(f.mutations().length, 0);
  }
});

test('mixed POST/PATCH/cleanup uses one batch and posts the exact signed instance and timestamp', async () => {
  const f = fixture();
  f.previous.selectedControls.push(f.controls[1]);
  f.desired.selectedControls = [f.controls[0], f.controls[2]];
  const removedDefinition = buildAutomationDefinitions({ ...f.previous, selectedControls: [f.controls[1]] })[0];
  const removedSchedule = buildApi4CreatePayload(removedDefinition, f.previous.organizationId, crypto.randomUUID).payload;
  f.rows.push({ policyId: f.previous.policyId, automationGroupId: removedDefinition.automationGroupId,
    automationGroupVersion: removedDefinition.automationGroupVersion, controlFamilyNameSnapshot: removedDefinition.familyName,
    action1OrganizationId: f.previous.organizationId, action1AutomationId: 'resource-to-delete',
    action1AutomationConfigurationId: removedSchedule.configuration.id, action1AutomationActionId: removedSchedule.configuration.actions[0].id,
    action1AutomationName: removedDefinition.name, action1AutomationSelf: 'https://app.action1.test/api/4.0/automations/schedules/synthetic-org/resource-to-delete',
    desiredDefinitionFingerprint: removedDefinition.fingerprint, active: true });
  f.remotes.set('resource-to-delete', { id: 'resource-to-delete', type: 'AutomationSchedule', ...removedSchedule });
  const plan = await f.plan(), prepared = await f.prepare(plan);
  assert.equal(f.jobs.size, 1);
  assert.deepEqual(plan.operations.map(operation => operation.type).sort(), ['CREATE', 'DELETE', 'PATCH']);
  assert.equal([...f.jobs.values()][0].objects.length, 3, 'Only Cleanup, PATCH and POST configurations require signatures');
  f.sign();
  const current = await f.plan(), signedSchedules = await f.signed(prepared, current);
  const original = structuredClone(signedSchedules.get('cleanup').configuration);
  const result = await applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: current.operations,
    cleanupInstance: current.cleanupInstance, signedSchedules });
  assert.equal(result.history.cleanup.instanceId, 'cleanup-resource');
  const instance = f.mutations().find(c => c.url.includes('/automations/instances/'));
  assert.equal(JSON.stringify(instance.data.configuration), JSON.stringify(original));
  assert.equal(instance.data.configuration.type, 'AutomationScheduleConfiguration');
  assert.equal(instance.data.configuration.settings, undefined);
  assert.deepEqual(instance.data.signatures[0].object_reference, { type: original.type, id: original.id, organization_id: original.organization_id });
  assert.equal(f.mutations()[0], instance);
  const expectedScheduleMethods = current.operations.filter(o => ['PATCH', 'CREATE'].includes(o.type)).map(o => ({ PATCH: 'PATCH', CREATE: 'POST' })[o.type]);
  assert.deepEqual(f.mutations().slice(1).map(c => c.method), ['DELETE', ...expectedScheduleMethods]);
  assert.equal(f.rows.some(r => r.action1AutomationId === 'cleanup-resource'), false);
});

test('explicit edit retry submits fresh cleanup after later Schedule failure', async () => {
  const f = fixture();
  f.previous.selectedControls.push(f.controls[1]);
  f.desired.selectedControls = [f.controls[0], f.controls[2]];
  const removedDefinition = buildAutomationDefinitions({ ...f.previous, selectedControls: [f.controls[1]] })[0];
  const removedSchedule = buildApi4CreatePayload(removedDefinition, f.previous.organizationId, crypto.randomUUID).payload;
  f.rows.push({ policyId: f.previous.policyId, automationGroupId: removedDefinition.automationGroupId,
    automationGroupVersion: removedDefinition.automationGroupVersion, controlFamilyNameSnapshot: removedDefinition.familyName,
    action1OrganizationId: f.previous.organizationId, action1AutomationId: 'resource-to-delete',
    action1AutomationConfigurationId: removedSchedule.configuration.id, action1AutomationActionId: removedSchedule.configuration.actions[0].id,
    action1AutomationName: removedDefinition.name, action1AutomationSelf: 'https://app.action1.test/api/4.0/automations/schedules/synthetic-org/resource-to-delete',
    desiredDefinitionFingerprint: removedDefinition.fingerprint, active: true });
  f.remotes.set('resource-to-delete', { id: 'resource-to-delete', type: 'AutomationSchedule', ...removedSchedule });
  const plan = await f.plan(), prepared = await f.prepare(plan); f.sign();
  const signedSchedules = await f.signed(prepared, await f.plan());
  f.failCreate();
  await assert.rejects(() => applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: plan.operations, signedSchedules }), error => {
    assert.equal(error.history.cleanup.instanceId, 'cleanup-resource');
    assert(error.history.counts.failed >= 1);
    return true;
  });
  assert.deepEqual(f.mutations().map(call => call.method), ['POST', 'DELETE', 'POST']);
  f.setCreateFailure(false);
  const retryPlan = await f.plan();
  await applyEdit(f.context, f.previous, f.desired, { ...f.options, operations: retryPlan.operations, signedSchedules });
  assert.equal(f.mutations().filter(call => call.url.includes('/automations/instances/')).length, 2,
    'A new user-initiated edit may repeat endpoint cleanup');
  const retryMethods = retryPlan.operations.filter(operation => ['DELETE', 'PATCH', 'CREATE'].includes(operation.type))
    .map(operation => ({ DELETE: 'DELETE', PATCH: 'PATCH', CREATE: 'POST' })[operation.type]);
  assert.deepEqual(f.mutations().slice(4).map(call => call.method), retryMethods);
});

test('enabled and disabled deletion sign before cleanup-first sequential schedule mutations', async () => {
  for (const enabled of [true, false]) {
    const f = fixture(); f.previous.enabled = enabled;
    if (!enabled) f.rows[0].active = false;
    const plan = await f.planDelete(), prepared = await f.prepare(plan, 'delete');
    assert.equal(f.mutations().length, 0);
    await assert.rejects(() => f.signed(prepared, plan, 'delete'));
    assert.equal(f.mutations().length, 0);
    f.sign();
    const current = await f.planDelete(), signed = await f.signed(prepared, current, 'delete');
    const history = await cleanupPolicy(f.context, f.previous, { ...f.options, operations: current.operations,
      cleanupInstance: current.cleanupInstance, signedCleanup: signed.get('cleanup') });
    assert.equal(history.cleanup.instanceId, 'cleanup-resource');
    assert.deepEqual(f.mutations().map(c => c.method), enabled ? ['POST', 'DELETE'] : ['POST']);
    assert.equal(f.rows[0].active, false);
  }
});

test('74 sequential Schedule DELETEs cannot age the exact signed Cleanup Instance before its POST', async () => {
  const f = fixture(), instance = buildPolicyEndpointCleanupInstance(f.previous);
  const editPlan = { snapshot: {}, operations: [], cleanupInstance: instance };
  const prepared = await f.prepare(editPlan, 'delete'); f.sign();
  const signed = await f.signed(prepared, editPlan, 'delete');
  const signedCleanup = signed.get('cleanup'), exactConfiguration = structuredClone(signedCleanup.configuration);
  const rows = Array.from({ length: 74 }, (_, index) => ({ policyId: f.previous.policyId, active: true,
    automationGroupId: `family-${index}`, controlFamilyNameSnapshot: `Family ${index}`, action1AutomationId: `schedule-${index}` }));
  const correlations = {
    async listCorrelations() { return rows; },
    async markInactive(_policyId, group) { rows.find(row => row.automationGroupId === group).active = false; }
  };
  const actualNow = Date.now, originalHttp = f.context.http;
  let clock = actualNow(), inFlightDeletes = 0, maxInFlightDeletes = 0;
  Date.now = () => clock;
  f.context.http = async input => {
    if (input.method === 'DELETE') {
      inFlightDeletes += 1; maxInFlightDeletes = Math.max(maxInFlightDeletes, inFlightDeletes);
      try { const result = await originalHttp(input); clock += 3000; return result; }
      finally { inFlightDeletes -= 1; }
    }
    if (input.method === 'POST' && input.url.includes('/automations/instances/')) {
      const [date, time] = input.data.configuration.start_time.split('_');
      const start = new Date(`${date}T${time.replaceAll('-', ':')}Z`).getTime();
      assert(Math.abs(clock - start) <= 120000, 'Action1 start_time must be within two minutes at POST time');
    }
    return originalHttp(input);
  };
  try {
    const history = await cleanupPolicy(f.context, f.previous, { ...f.options, correlations, operations: [],
      cleanupInstance: instance, signedCleanup });
    assert.equal(history.counts.deleted, 74);
    assert.equal(f.mutations().length, 75);
    assert(f.mutations()[0].url.includes('/automations/instances/'));
    assert.deepEqual(f.mutations().slice(1).map(call => call.method), Array(74).fill('DELETE'));
    assert.equal(maxInFlightDeletes, 1, 'Schedule DELETE requests remain sequential');
    assert.deepEqual(f.mutations()[0].data.configuration, exactConfiguration, 'POST must preserve the exact signed configuration');
    assert(clock - new Date(`${exactConfiguration.start_time.split('_')[0]}T${exactConfiguration.start_time.split('_')[1].replaceAll('-', ':')}Z`).getTime() > 120000,
      'The simulated deletion phase exceeds Action1 start_time validity');
  } finally {
    f.context.http = originalHttp;
    Date.now = actualNow;
  }
});

test('disabled edits preserve schedules and use the same signed removed-Control cleanup', async () => {
  const f = fixture();
  f.previous.enabled = false; f.desired.enabled = false;
  f.previous.selectedControls.push(f.controls[1]);
  f.desired.selectedControls = [f.controls[0]];
  const plan = await f.plan();
  assert.deepEqual(plan.operations, []);
  const prepared = await f.prepare(plan); f.sign();
  const signed = await f.signed(prepared, await f.plan());
  const cleanup = await cleanupDeselectedControls(f.context, f.desired, [f.controls[1].controlId], {
    ...f.options, instance: plan.cleanupInstance, signedCleanup: signed.get('cleanup') });
  assert.equal(cleanup.instanceId, 'cleanup-resource');
  assert.deepEqual(f.mutations().map(c => c.method), ['POST']);
  assert.equal(f.rows[0].active, true, 'Disabled edit does not introduce schedule deletion');
});

test('delete rejects cancelled, expired, changed Policy/identity and failed signing before Schedule DELETE', async () => {
  for (const failure of ['cancel', 'expiry', 'policy', 'identity', 'signing-failure']) {
    const f = fixture(), plan = await f.planDelete(), prepared = await f.prepare(plan, 'delete');
    if (failure !== 'cancel') f.sign();
    if (failure === 'expiry') [...f.jobs.values()][0].expiresAt = Date.now() - 1;
    if (failure === 'policy') f.previous.baseName = 'Changed while signing';
    if (failure === 'identity') f.remotes.get('resource-1').configuration.id = crypto.randomUUID();
    if (failure === 'signing-failure') f.context.action1.provisioner.prepareSigning = async () => { throw Error('Signing failed'); };
    await assert.rejects(async () => f.signed(prepared, await f.planDelete(), 'delete'), undefined, failure);
    assert.equal(f.mutations().length, 0);
    assert.equal(f.rows[0].active, true);
  }
});

test('cleanup POST failure prevents schedule DELETE and leaves correlations active', async () => {
  const f = fixture(), plan = await f.planDelete(), prepared = await f.prepare(plan, 'delete'); f.sign();
  const signed = await f.signed(prepared, await f.planDelete(), 'delete'); f.failInstance();
  await assert.rejects(() => cleanupPolicy(f.context, f.previous, { ...f.options, operations: plan.operations,
    cleanupInstance: plan.cleanupInstance, signedCleanup: signed.get('cleanup') }), error => {
    assert.equal(error.history.counts.deleted, 0); assert.equal(error.history.counts.failed, 1); return true;
  });
  assert.equal(f.rows[0].active, true);
  assert.deepEqual(f.mutations().map(c => c.method), ['POST']);
  assert.equal(f.jobs.size, 1);
});

test('cleanup POST precedes a failed Schedule DELETE and the next explicit operation may clean again', async () => {
  const f = fixture(), plan = await f.planDelete(), prepared = await f.prepare(plan, 'delete'); f.sign();
  const signed = await f.signed(prepared, await f.planDelete(), 'delete'); f.failDelete();
  await assert.rejects(() => cleanupPolicy(f.context, f.previous, { ...f.options, operations: plan.operations,
    cleanupInstance: plan.cleanupInstance, signedCleanup: signed.get('cleanup') }));
  assert.equal(f.rows[0].active, true);
  assert.deepEqual(f.mutations().map(c => c.method), ['POST', 'DELETE']);
  assert.deepEqual(f.mutations().map(c => c.method), ['POST', 'DELETE']);
});

test('an explicit delete retry submits fresh cleanup and targets only correlations left active after partial deletion', async () => {
  const f = fixture();
  f.previous.selectedControls.push(...f.controls.slice(1));
  const definitions = buildAutomationDefinitions(f.previous).filter(definition => definition.automationGroupId !== f.rows[0].automationGroupId);
  for (const [index, definition] of definitions.entries()) {
    const schedule = buildApi4CreatePayload(definition, f.previous.organizationId, crypto.randomUUID).payload;
    const id = `schedule-${index + 1}`;
    f.rows.push({ policyId: f.previous.policyId, automationGroupId: definition.automationGroupId,
      automationGroupVersion: definition.automationGroupVersion, controlFamilyNameSnapshot: definition.familyName,
      action1OrganizationId: f.previous.organizationId, action1AutomationId: id,
      action1AutomationConfigurationId: schedule.configuration.id, action1AutomationActionId: schedule.configuration.actions[0].id,
      action1AutomationName: definition.name, action1AutomationSelf: `https://app.action1.test/api/4.0/automations/schedules/synthetic-org/${id}`,
      desiredDefinitionFingerprint: definition.fingerprint, active: true });
    f.remotes.set(id, { id, type: 'AutomationSchedule', ...schedule });
  }
  const originalHttp = f.context.http;
  let failRemainingOnce = true;
  f.context.http = async input => {
    if (input.method === 'DELETE' && input.url.endsWith('/schedule-1') && failRemainingOnce) {
      failRemainingOnce = false;
      throw Object.assign(new Error('DELETE failed'), { statusCode: 500 });
    }
    return originalHttp(input);
  };
  const newIntent = () => crypto.randomUUID();
  const prepareDelete = async (editPlan, intentId) => prepareScheduleSigning(f.context, { policy: f.previous,
    operation: 'delete', intentId, editPlan });
  const signedDelete = async (prepared, editPlan, intentId) => getSignedSchedules(f.context, { policy: f.previous,
    operation: 'delete', intentId, ...prepared, editPlan });
  const runDelete = async (editPlan, signing) => cleanupPolicy(f.context, f.previous, { ...f.options,
    operations: editPlan.operations, cleanupInstance: editPlan.cleanupInstance, signedCleanup: signing.get('cleanup') });

  const initialPlan = await f.planDelete(), firstIntent = newIntent();
  const firstPrepared = await prepareDelete(initialPlan, firstIntent);
  f.sign();
  const firstSigned = await signedDelete(firstPrepared, initialPlan, firstIntent);
  try {
    await assert.rejects(() => runDelete(initialPlan, firstSigned), error => {
      assert.equal(error.history.counts.deleted, 1);
      return true;
    });
    assert.deepEqual(f.rows.map(row => row.active), [false, true, true], 'confirmed deletes remain persisted while remaining correlations stay active');

    const retryPlan = await f.planDelete(), retryIntent = newIntent();
    const retryPrepared = await prepareDelete(retryPlan, retryIntent);
    f.sign();
    const retrySigned = await signedDelete(retryPrepared, retryPlan, retryIntent);
    const retry = await runDelete(retryPlan, retrySigned);
    assert.equal(retry.counts.deleted, definitions.length);
    assert.equal(f.mutations().filter(call => call.url.includes('/automations/instances/')).length, 2,
      'an explicit user retry prepares/signs and submits a fresh Cleanup Instance');
    assert.deepEqual(f.mutations().filter(call => call.method === 'DELETE').map(call => call.url.split('/').pop()),
      ['resource-1', ...definitions.map((_, index) => `schedule-${index + 1}`)],
      'retry targets only still-active Schedule correlations');
    assert.deepEqual(f.rows.map(row => row.active), f.rows.map(() => false));
  } finally {
    f.context.http = originalHttp;
  }
});

test('ambiguous Cleanup Instance POST is not automatically replayed within the operation', async () => {
  const f = fixture(), plan = await f.planDelete(), prepared = await f.prepare(plan, 'delete'); f.sign();
  const signed = await f.signed(prepared, await f.planDelete(), 'delete'); f.failInstance();
  await assert.rejects(() => cleanupPolicy(f.context, f.previous, { ...f.options, operations: plan.operations,
    cleanupInstance: plan.cleanupInstance, signedCleanup: signed.get('cleanup') }));
  assert.deepEqual(f.mutations().map(c => c.method), ['POST']);
});

test('incomplete, expired or modified cleanup approval cannot start Schedule DELETE', async () => {
  for (const failure of ['missing', 'expired', 'script', 'origin']) {
    const f = fixture(), plan = await f.planDelete(), prepared = await f.prepare(plan, 'delete'); f.sign();
    const signed = await f.signed(prepared, await f.planDelete(), 'delete');
    const cleanup = signed.get('cleanup');
    if (failure === 'expired') cleanup.expiresAt = Date.now() - 1;
    if (failure === 'script') cleanup.configuration.actions[0].params.run_script_text += '\nchanged';
    if (failure === 'origin') cleanup.origin = 'https://another-origin.test';
    await assert.rejects(() => cleanupPolicy(f.context, f.previous, { ...f.options,
      cleanupInstance: plan.cleanupInstance, signedCleanup: failure === 'missing' ? undefined : cleanup }));
    assert.equal(f.mutations().length, 0);
    assert.equal(f.rows[0].active, true);
  }
});
