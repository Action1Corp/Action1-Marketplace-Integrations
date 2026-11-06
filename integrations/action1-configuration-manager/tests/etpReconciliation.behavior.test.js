const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { loadPolicyCatalogContract, normalizeParameterValues } = require('../policyCatalogContract');
const { normalizeAndValidatePolicyInput } = require('../policyStore');
const { buildAutomationDefinitions } = require('../automationDefinition');
const { buildApi4CreatePayload, createAction1AutomationClient } = require('../action1AutomationClient');
const { prepareReconciliationSigning, reconcilePoliciesAction } = require('../reconciliation');
const { extractHistoryEnvelope } = require('../historyContract');

function digest(value) {
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function fixture({ missing = 1, multiplePolicies = false, unsigned = false, legacy = false } = {}) {
  const catalog = loadPolicyCatalogContract(), seen = new Set();
  const controls = Object.values(catalog.controlsById).filter(c => {
    if (seen.has(c.automationGroupId) || seen.size >= 3) return false;
    seen.add(c.automationGroupId); return true;
  }).map(c => ({ controlId: c.controlId, controlVersion: c.version, automationGroupId: c.automationGroupId,
    automationGroupVersion: catalog.controlFamiliesById[c.automationGroupId].version, parameters: normalizeParameterValues(c, {}) }));
  const policies = Array.from({ length: multiplePolicies ? 2 : 1 }, (_, i) => normalizeAndValidatePolicyInput({
    mode: 'edit', policyId: `POL-00000${i + 1}`, baseName: `Recovery ${i}`, enabled: true,
    organizationId: `synthetic-org-${i}`, organizationName: `Synthetic org ${i}`, scopeType: 'ALL_ENDPOINTS',
    policyMode: 'ASSESS_ONLY', runSchedule: { runEveryHours: 6, startDate: '2026-11-06', startTime: '09:00', timezone: 'UTC' },
    completionDeadlineMinutes: 360, selectedControls: controls }, catalog));
  const rows = [], remotes = new Map(), calls = [], states = [], logs = [], jobs = new Map();
  for (const policy of policies) for (const [i, definition] of buildAutomationDefinitions(policy).entries()) {
    const id = `${policy.policyId}-remote-${i}`;
    const payload = buildApi4CreatePayload(definition, policy.organizationId, crypto.randomUUID).payload;
    rows.push({ policyId: policy.policyId, automationGroupId: definition.automationGroupId, active: true,
      action1OrganizationId: policy.organizationId, action1AutomationId: id, action1AutomationConfigurationId: payload.configuration.id,
      action1AutomationActionId: payload.configuration.actions[0].id, desiredDefinitionFingerprint: definition.fingerprint });
    if (i >= missing) remotes.set(id, { id, type: 'AutomationSchedule', ...payload });
  }
  let postNumber = 0, failPostAt = 0, postGate, onGetSigning;
  const credentials = { apiKey: 'synthetic-client', apiSecret: 'synthetic-secret', baseUrl: `https://app.action1.test/api/${legacy ? '3.0' : '4.0'}`,
    etpEnabled: !(unsigned || legacy), etpMode: unsigned ? 'api4' : legacy ? 'legacy' : 'etp' };
  const context = { integrationId: 'action1-configuration-manager', logger: { info() {}, warn() {}, error() {} },
    action1: { getCredentials: async () => credentials, provisioner: {
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
      async getSigning(id) { onGetSigning?.(); return [...jobs.values()].find(j => j.id === id); }
    } },
    async http(input) {
      calls.push(input);
      if (input.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'synthetic-token', expires_in: 3600 } };
      const id = input.url.split('/').pop();
      if (input.method === 'GET') {
        if (!remotes.has(id)) return { status: 404, data: { message: `Automation with id=${id} not found` }, headers: { 'content-type': 'application/json' } };
        const data = structuredClone(remotes.get(id));
        return { status: 200, data: legacy ? { ...data, name: data.configuration.name } : data };
      }
      assert.equal(input.method, 'POST', 'Reconciliation never PATCHes or DELETEs');
      postNumber += 1;
      if (postGate) await postGate();
      if (postNumber === failPostAt) throw Object.assign(Error('Synthetic create failure'), { statusCode: 500 });
      const result = { id: `replacement-${postNumber}`, type: 'AutomationSchedule', ...input.data };
      if (legacy) result.self = `${credentials.baseUrl}/automations/schedules/synthetic-org-0/${result.id}`;
      if (legacy) result.actions = result.actions.map(action => ({ ...action, id: `legacy-action-${postNumber}` }));
      remotes.set(result.id, structuredClone(result));
      return { status: 201, data: result };
    } };
  const options = { client: createAction1AutomationClient(context),
    policyStore: { listPolicies: async () => structuredClone(policies) },
    correlations: { listCorrelations: async id => structuredClone(rows.filter(r => r.policyId === id && r.active)),
      async activateCorrelation(input) {
        const index = rows.findIndex(r => r.policyId === input.policyId && r.automationGroupId === input.automationGroupId);
        if (index < 0) rows.push({ ...input, active: true }); else rows[index] = { ...input, active: true };
      } },
    stateStore: { save: async state => states.push(structuredClone(state)) } };
  const payload = { operation: 'reconcile', intentId: crypto.randomUUID() };
  const run = { id: 'synthetic-run', appendLog: async message => logs.push(message), setAssetsProcessed: async count => logs.push(count) };
  const prepare = () => prepareReconciliationSigning(context, { payload }, options);
  const complete = prepared => reconcilePoliciesAction(context, { payload: { ...payload, ...prepared }, run }, options);
  const background = () => reconcilePoliciesAction(context, { run }, options);
  function sign() { for (const job of jobs.values()) { job.state = 'signed'; job.results = job.objects.map(o => ({ id: o.id,
    configurationDigest: digest(o.configuration), signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-signature' } })).reverse(); } }
  return { context, policies, rows, remotes, calls, states, logs, jobs, options, prepare, complete, background, sign,
    mutations: () => calls.filter(c => c.url?.includes('/automations/') && c.method !== 'GET'),
    failPost: number => { failPostAt = number; }, gate: callback => { postGate = callback; },
    duringRetrieval: callback => { onGetSigning = callback; } };
}

test('background ETP discovery reports missing and absent correlations without invoking a writer or signer', async () => {
  const f = fixture({ missing: 2 }); f.rows.splice(0, 1);
  f.options.client.createAutomation = async () => { throw Error('Background must not invoke a writer'); };
  const result = await f.background();
  assert.equal(result.ok, false);
  assert.match(result.message, /Manual reconciliation required: 2 automation/);
  assert.match(result.message, /Run Reconcile Now/);
  assert.equal(f.mutations().length, 0);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.states[0].lastResult, 'Failed');
  assert.match(f.states[0].lastError, /ETP.*signing/);
  assert.equal(result.summary.created, 0);
  assert.equal(result.summary.unchanged, 1);
  assert(!extractHistoryEnvelope(result.details).summary.includes('Restored'));
  assert(f.logs.some(value => typeof value === 'string' && value.includes('Manual reconciliation required')));
});

test('manual recovery signs only missing schedules, batches across Policies/organizations and preserves exact configurations', async () => {
  for (const settings of [{ missing: 1 }, { missing: 2, multiplePolicies: true }]) {
    const f = fixture(settings), healthy = structuredClone(f.rows.filter(r => f.remotes.has(r.action1AutomationId)));
    const prepared = await f.prepare();
    assert.equal(prepared.signingRequired, true);
    const job = [...f.jobs.values()][0];
    assert.equal(job.objects.length, settings.multiplePolicies ? 4 : 1);
    assert.equal(f.jobs.size, 1);
    assert.equal(f.mutations().length, 0);
    f.sign();
    const result = await f.complete(prepared);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.summary.created, job.objects.length);
    assert.equal(f.mutations().length, job.objects.length);
    for (const post of f.mutations()) {
      assert(job.objects.some(o => JSON.stringify(o.configuration) === JSON.stringify(post.data.configuration)));
      assert.deepEqual(post.data.signatures[0].object_reference, { type: 'AutomationScheduleConfiguration',
        id: post.data.configuration.id, organization_id: post.data.configuration.organization_id });
    }
    for (const row of healthy) assert.deepEqual(f.rows.find(r => r.action1AutomationId === row.action1AutomationId), row);
    assert(f.states.every(s => s.lastResult === 'Success'));
    assert(!/synthetic-signature|synthetic-secret|run_script_text/.test(JSON.stringify({ states: f.states, logs: f.logs, details: result.details })),
      'History, state and progress must not expose signing results, credentials or scripts');
    const replay = await f.complete(prepared);
    assert.equal(replay.ok, false, 'Completed recovery cannot replay a consumed correlation snapshot');
    assert.equal(f.mutations().length, job.objects.length);
  }
});

test('healthy ETP reconciliation completes without preparing a signing job', async () => {
  const f = fixture({ missing: 0 });
  assert.equal((await f.prepare()).signingRequired, false);
  const result = await f.background();
  assert.equal(result.ok, true);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.mutations().length, 0);
});

test('manual recovery restores a missing correlation without touching healthy schedules', async () => {
  const f = fixture(); f.rows.splice(0, 1);
  const prepared = await f.prepare(); f.sign();
  const result = await f.complete(prepared);
  assert.equal(result.ok, true, result.message);
  assert.equal(f.rows.length, 3);
  assert.equal(f.mutations().length, 1);
  assert.equal(result.summary.unchanged, 2);
});

test('cancelled, failed, expired and stale signing cause no replacement writes', async () => {
  for (const failure of ['cancel', 'signing', 'expiry', 'policy', 'disabled', 'identity', 'returned', 'correlation', 'during-retrieval']) {
    const f = fixture(), prepared = await f.prepare();
    if (failure !== 'cancel') f.sign();
    if (failure === 'signing') f.context.action1.provisioner.getSigning = async () => { throw Error('Signing failed'); };
    if (failure === 'expiry') [...f.jobs.values()][0].expiresAt = Date.now() - 1;
    if (failure === 'policy') f.policies[0].baseName = 'Changed';
    if (failure === 'disabled') f.policies[0].enabled = false;
    if (failure === 'identity') [...f.remotes.values()][0].configuration.id = crypto.randomUUID();
    if (failure === 'returned') {
      const row = f.rows[0], definition = buildAutomationDefinitions(f.policies[0])[0];
      f.remotes.set(row.action1AutomationId, { id: row.action1AutomationId,
        ...buildApi4CreatePayload(definition, f.policies[0].organizationId, crypto.randomUUID).payload });
    }
    if (failure === 'correlation') f.rows[0].action1AutomationId = 'another-missing-resource';
    if (failure === 'during-retrieval') f.duringRetrieval(() => { f.policies[0].description = 'Changed during retrieval'; });
    const result = await f.complete(prepared);
    assert.equal(result.ok, false, failure);
    assert.equal(f.mutations().length, 0, failure);
    assert.equal(f.jobs.size, 1);
  }
});

test('unresolved discovery blocks preparation and reports an existing failed History outcome', async () => {
  const f = fixture();
  f.options.client.observeAutomation = async () => ({ state: 'UNRESOLVED', reason: 'transport-failure' });
  await assert.rejects(() => f.prepare(), /verif|resolve/i);
  assert.equal(f.jobs.size, 0);
  const result = await f.background();
  assert.equal(result.ok, false);
  assert.equal(f.states[0].lastResult, 'Failed');
  assert(!extractHistoryEnvelope(result.details).summary.includes('No missing automations found'));
});

test('partial POST failure preserves accepted correlations and never falls back or reopens signing', async () => {
  const f = fixture({ missing: 2 }), original = structuredClone(f.rows), prepared = await f.prepare(); f.sign(); f.failPost(2);
  const result = await f.complete(prepared);
  assert.equal(result.ok, false);
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(f.mutations().length, 2);
  assert.equal(f.jobs.size, 1);
  assert.notEqual(f.rows[0].action1AutomationId, original[0].action1AutomationId);
  assert.equal(f.rows[1].action1AutomationId, original[1].action1AutomationId);
  assert.equal(f.states[0].lastResult, 'Failed');
  const replay = await f.complete(prepared);
  assert.equal(replay.ok, false);
  assert.equal(f.mutations().length, 2);
});

test('concurrent signed reconciliation attempts cannot duplicate replacement POSTs', async () => {
  const f = fixture(), prepared = await f.prepare();
  const otherPayload = { operation: 'reconcile', intentId: crypto.randomUUID() };
  const otherPrepared = await prepareReconciliationSigning(f.context, { payload: otherPayload }, f.options);
  f.sign();
  let release, entered;
  const entry = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.gate(async () => { entered(); await gate; });
  const first = f.complete(prepared); await entry;
  const otherCompletion = () => reconcilePoliciesAction(f.context, { payload: { ...otherPayload, ...otherPrepared } }, f.options);
  const second = await otherCompletion();
  assert.equal(second.ok, false);
  assert.match(second.message, /already running/);
  release();
  assert.equal((await first).ok, true);
  assert.equal((await otherCompletion()).ok, false, 'The second approved intent becomes stale after the first repair');
  assert.equal(f.mutations().length, 1);
});

test('legacy and unsigned API 4 retain automatic and manual repair without signer calls', async () => {
  for (const mode of [{ unsigned: true }, { legacy: true }]) {
    for (const manual of [false, true]) {
      const f = fixture(mode);
      if (manual) assert.equal((await f.prepare()).signingRequired, false);
      const result = await f.background();
      assert.equal(result.ok, true, JSON.stringify({ mode, manual, states: f.states, message: result.message }));
      assert.equal(f.mutations().length, 1);
      assert.equal(f.mutations()[0].data.signatures, undefined);
      assert.equal(f.jobs.size, 0);
    }
  }
});
