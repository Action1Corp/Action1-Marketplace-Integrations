const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { loadPolicyCatalogContract } = require('../policyCatalogContract');
const { normalizeAndValidatePolicyInput } = require('../policyStore');
const { resolveCanonicalConnection } = require('../action1DiscoveryClient');
const { createAction1AutomationClient } = require('../action1AutomationClient');
const { buildAutomationDefinitions } = require('../automationDefinition');
const { prepareScheduleSigning, getSignedSchedules } = require('../scheduleSigning');

function digest(value) {
  function stable(v) { return Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v; }
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function policy(count = 3) {
  const catalog = loadPolicyCatalogContract();
  const seen = new Set();
  const controls = Object.values(catalog.controlsById).filter(c => {
    if (seen.has(c.automationGroupId) || seen.size >= count) return false;
    seen.add(c.automationGroupId); return true;
  }).map(c => ({ controlId: c.controlId, controlVersion: c.version, automationGroupId: c.automationGroupId,
    automationGroupVersion: catalog.controlFamiliesById[c.automationGroupId].version, parameters: {} }));
  return normalizeAndValidatePolicyInput({ mode: 'edit', policyId: 'POL-000001', baseName: 'Signing test',
    organizationId: 'synthetic-org', organizationName: 'Synthetic organization', scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'synthetic-group', endpointGroupName: 'Synthetic group', enabled: false,
    policyMode: 'ASSESS_ONLY', runSchedule: { runEveryHours: 6, startDate: '2026-11-05', startTime: '09:00', timezone: 'UTC' },
    completionDeadlineMinutes: 360, selectedControls: controls }, catalog);
}
function fixture() {
  const calls = [], jobs = new Map();
  let currentRevision = 'revision-1';
  const credentials = { apiKey: 'synthetic-client', apiSecret: 'synthetic-secret', baseUrl: 'https://app.action1.test/api/4.0',
    etpEnabled: true, etpMode: 'etp', etpCapabilitySource: 'marketplace-setting' };
  const context = {
    integrationId: 'action1-configuration-manager', logger: { info() {}, warn() {}, error() {} },
    action1: { getCredentials: async () => credentials, provisioner: {
      async prepareSigning(input) {
        calls.push('prepare');
        const fingerprint = digest({ objects: input.objects, revision: currentRevision });
        let job = jobs.get(input.idempotencyKey);
        if (job && job.digest !== fingerprint) throw new Error('Signing intent changed or expired; prepare a new intent.');
        if (!job) {
          job = { id: crypto.randomUUID(), integrationId: context.integrationId, purpose: 'sign-only', state: 'awaiting_signature',
            objects: JSON.parse(JSON.stringify(input.objects)), digest: fingerprint, origin: 'https://app.action1.test', expiresAt: Date.now() + 60000 };
          jobs.set(input.idempotencyKey, job);
        }
        return { ok: true, outcome: job.state, signingId: job.id, digest: job.digest };
      },
      async getSigning(id) { calls.push('get'); return [...jobs.values()].find(j => j.id === id); }
    } },
    async http(input) {
      calls.push(input);
      if (input.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'synthetic-token', expires_in: 3600 } };
      return { status: 200, data: { id: 'remote-resource', type: 'AutomationSchedule', ...input.data } };
    }
  };
  function sign() {
    for (const job of jobs.values()) {
      job.state = 'signed';
      job.results = job.objects.map(o => ({ id: o.id, configurationDigest: digest(o.configuration),
        signature: { alg: 'synthetic-algorithm', iat: 1, kid: 'synthetic-key', value: 'synthetic-signature-' + o.id } })).reverse();
    }
  }
  return { context, calls, credentials, jobs, sign, rotate: () => { currentRevision = 'revision-2'; } };
}
const intentId = '11111111-1111-4111-8111-111111111111';

test('connection preserves independent host ETP metadata and rejects contradictions', async () => {
  const f = fixture();
  const connection = await resolveCanonicalConnection(f.context);
  assert.equal(connection.etpEnabled, true);
  assert.equal(connection.etpMode, 'etp');
  assert.equal(connection.etpCapabilitySource, 'marketplace-setting');
  f.credentials.etpMode = 'api4';
  await assert.rejects(() => resolveCanonicalConnection(f.context), /mode|metadata/i);
});

test('three finalized schedules form one job and use individually mapped signatures through the existing client', async () => {
  const f = fixture(), p = policy();
  const prepared = await prepareScheduleSigning(f.context, { policy: p, operation: 'create', intentId });
  assert.equal(f.jobs.size, 1);
  assert.equal([...f.jobs.values()][0].objects.length, 3);
  assert.equal(f.calls.filter(c => typeof c === 'object').length, 0);
  f.sign();
  const signed = await getSignedSchedules(f.context, { policy: p, operation: 'create', intentId, ...prepared });
  assert.equal(f.calls.filter(c => c === 'prepare').length, 2, 'revalidate using the original idempotent prepare before submission');
  const definitions = buildAutomationDefinitions(p);
  for (const definition of definitions) {
    const item = signed.get(definition.automationGroupId);
    const original = JSON.stringify(item.configuration);
    const client = createAction1AutomationClient(f.context, { uuidGenerator: () => { throw Error('IDs must not be regenerated'); } });
    const result = await client.createAutomation(p.organizationId, definition, item);
    const post = f.calls.filter(c => c.method === 'POST' && c.url.includes('/automations/schedules/')).at(-1);
    assert.equal(JSON.stringify(post.data.configuration), original);
    assert.deepEqual(post.data.endpoints, definition.payload.endpoints);
    assert.deepEqual(post.data.signatures, [{ object_reference: { type: item.configuration.type, id: item.configuration.id, organization_id: p.organizationId }, object_signature: item.signature }]);
    assert.equal(result.configurationId, item.configuration.id);
    assert.equal(result.actionId, item.configuration.actions[0].id);
  }
});

test('unsigned ETP POST/PATCH/instance paths fail before any HTTP, including background callers', async () => {
  const f = fixture(), p = policy(1), definition = buildAutomationDefinitions(p)[0];
  const client = createAction1AutomationClient(f.context);
  await assert.rejects(() => client.createAutomation(p.organizationId, definition), /sign|interactive/i);
  await assert.rejects(() => client.updateAutomation(p.organizationId, 'remote', definition, 'action', 'config'), /sign|interactive/i);
  await assert.rejects(() => client.createAutomationInstance(p.organizationId, definition), /sign|interactive/i);
  assert.equal(f.calls.length, 0);
});

test('pending/cancelled, expired, incomplete, changed policy and rotated profile prevent submission', async () => {
  for (const failure of ['pending', 'expired', 'incomplete', 'changed-policy', 'rotated-profile', 'wrong-operation', 'wrong-digest', 'wrong-integration', 'changed-mode', 'wrong-configuration-digest']) {
    const f = fixture(), p = policy(1);
    const prepared = await prepareScheduleSigning(f.context, { policy: p, operation: 'create', intentId });
    f.sign();
    const job = [...f.jobs.values()][0];
    if (failure === 'pending') job.state = 'awaiting_signature';
    if (failure === 'expired') job.expiresAt = Date.now() - 1;
    if (failure === 'incomplete') job.results = [];
    if (failure === 'changed-policy') p.baseName = 'Changed after signing';
    if (failure === 'rotated-profile') f.rotate();
    if (failure === 'wrong-digest') prepared.digest = 'different';
    if (failure === 'wrong-integration') job.integrationId = 'other-integration';
    if (failure === 'changed-mode') { f.credentials.etpEnabled = false; f.credentials.etpMode = 'api4'; }
    if (failure === 'wrong-configuration-digest') job.results[0].configurationDigest = 'different';
    await assert.rejects(() => getSignedSchedules(f.context, { policy: p, operation: failure === 'wrong-operation' ? 'enable' : 'create', intentId, ...prepared }), undefined, failure);
    assert.equal(f.calls.filter(c => typeof c === 'object').length, 0);
  }
});

test('host batch rejection is propagated without package capacity rules', async () => {
  const f = fixture();
  f.context.action1.provisioner.prepareSigning = async () => { throw Error('Supply 1–100 finalized configurations, up to 2 MB total.'); };
  await assert.rejects(() => prepareScheduleSigning(f.context, { policy: policy(1), operation: 'create', intentId }), /2 MB/);
  assert.equal(f.calls.length, 0);
});

test('a connection change or job expiry after retrieval prevents a protected POST', async () => {
  for (const change of ['origin', 'expiry']) {
    const f = fixture(), p = policy(1);
    const prepared = await prepareScheduleSigning(f.context, { policy: p, operation: 'create', intentId });
    f.sign();
    const signed = await getSignedSchedules(f.context, { policy: p, operation: 'create', intentId, ...prepared });
    const definition = buildAutomationDefinitions(p)[0], item = signed.get(definition.automationGroupId);
    if (change === 'origin') f.credentials.baseUrl = 'https://other.action1.test/api/4.0';
    else item.expiresAt = Date.now() - 1;
    await assert.rejects(() => createAction1AutomationClient(f.context).createAutomation(p.organizationId, definition, item), /changed|expired/i);
    assert.equal(f.calls.filter(c => typeof c === 'object').length, 0);
  }
});

test('background reconciliation reports interactive repair and creates no unsigned schedules', async () => {
  const { reconcileEnabledPolicy } = require('../reconciliation');
  const f = fixture(), p = { ...policy(1), enabled: true };
  const result = await reconcileEnabledPolicy(f.context, p, {
    correlations: { listCorrelations: async () => [], activateCorrelation: async () => { throw Error('Must not persist an unsigned replacement'); } }
  });
  assert.equal(result.failed, true);
  assert.equal(result.created, 0);
  assert.match(result.errors.join(' '), /interactive signing/i);
  assert.equal(f.calls.filter(c => typeof c === 'object').length, 0);
});
