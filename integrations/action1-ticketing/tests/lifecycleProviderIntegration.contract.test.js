const assert = require('assert');

const { runStage4CandidatePipeline } = require('../stage4CandidatePipeline');
const { createLifecycleRunService } = require('../lifecycleRunService');
const { createProviderDispatcher, PROVIDER_REGISTRY } = require('../providerRegistry');
const { createDbMappingStore } = require('../mappingStore');
const { createDbCorrelationStore } = require('../correlationStore');
const { createConnectWiseAdapter } = require('../providers/connectwisePsaAdapter');
const { buildTicketContentFromCandidate } = require('../lifecycle/ticketContentBuilder');
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');

const CONTRACT_MAJOR = 1;

function createFakeProvider(providerId, state, calls) {
  return {
    providerId,
    contractMajor: CONTRACT_MAJOR,
    adapter: {
      async validateConfiguration() { return { ok: true, errors: [] }; },
      async testConnection() { return { ok: true, message: 'Connected.' }; },
      async discover() { return { options: [] }; },
      async prepareTicket({ input }) {
        calls.prepare.push({ providerId, input });
        const content = input.content || {};
        return {
          payload: { summary: content.summary || '', details: content.details || '' },
          comparisonValue: JSON.stringify(input.comparisonInput),
          comparisonVersion: 'fake-content-v1'
        };
      },
      async getTicket({ input }) {
        const ref = input.externalTicketRef;
        calls.get.push({ providerId, id: ref.id });
        const ticket = state.get(`${providerId}:${ref.id}`);
        if (ticket?.error) throw ticket.error;
        return ticket
          ? { state: 'found', openState: ticket.openState, externalTicketRef: ticket.externalTicketRef, comparisonValue: ticket.comparisonValue, comparisonVersion: ticket.comparisonVersion }
          : { state: 'missing', confirmed: true };
      },
      async createTicket({ input }) {
        calls.create.push({ providerId, input });
        const control = state.get(`${providerId}:create-error`);
        if (control) throw control;
        const prepared = input.preparedTicket;
        const id = `${providerId}-ticket-${calls.create.length}`;
        const externalTicketRef = { id, displayId: `${providerId.toUpperCase()}-${calls.create.length}` };
        state.set(`${providerId}:${id}`, { openState: 'open', externalTicketRef, comparisonValue: prepared.comparisonValue, comparisonVersion: prepared.comparisonVersion });
        return { externalTicketRef };
      },
      async updateTicket({ input }) {
        calls.update.push({ providerId, input });
        const ref = input.externalTicketRef;
        const ticket = state.get(`${providerId}:${ref.id}`);
        if (!ticket) throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_TICKET' });
        ticket.comparisonValue = input.preparedTicket.comparisonValue;
        ticket.comparisonVersion = input.preparedTicket.comparisonVersion;
        return { ok: true, externalTicketRef: ticket.externalTicketRef };
      }
    }
  };
}

function createTestDispatcher(providerIds = ['provider-a', 'provider-b']) {
  const state = new Map();
  const calls = { get: [], prepare: [], create: [], update: [] };
  const registry = Object.fromEntries(providerIds.map((providerId) => [providerId, createFakeProvider(providerId, state, calls)]));
  return { dispatcher: createProviderDispatcher(registry), state, calls };
}

function candidate(overrides = {}) {
  const base = {
    ticketModel: 'endpoint',
    identity: { orgLinkId: '1', endpointId: 'ep-1', signalType: 'OFFLINE', key: '1|ep-1|OFFLINE' },
    routing: { action1OrgId: 'org-1', destinationId: 'dest-1' },
    signal: { type: 'OFFLINE', reason: 'offline_threshold_met' },
    endpoint: { id: 'ep-1', name: 'Host 1' }
  };
  const identity = { ...base.identity, ...(overrides.identity || {}) };
  identity.key = overrides.identity?.key || `${identity.orgLinkId}|${identity.endpointId}|${identity.signalType}`;
  return { ...base, ...overrides, identity, signal: { ...base.signal, ...(overrides.signal || {}) }, endpoint: { ...base.endpoint, ...(overrides.endpoint || {}) } };
}

function pipelineConfig(mappingId) {
  return {
    ticketDestination: {},
    signalFilters: {
      offline: { enabled: true, thresholdDays: 7 },
      rebootRequired: { enabled: false },
      automationFailed: { enabled: false },
      vulnerability: { severities: [], remediationStatuses: [] },
      update: { severities: [], remediationStatuses: [] }
    },
    orgClientMappings: [{ mappingId, action1OrgId: 'org-1', haloClientId: 'dest-1', enabled: true }]
  };
}

async function createOwnedStores(providerId, fixture = createInMemoryTicketingDb()) {
  const mappings = createDbMappingStore(fixture.context, providerId);
  const correlations = createDbCorrelationStore(fixture.context, providerId);
  const mapping = await mappings.save({ action1OrgId: `org-${providerId}`, action1OrgName: providerId, destinationId: `dest-${providerId}`, destinationName: providerId });
  return { ...fixture, mappings, correlations, mapping };
}

async function runNonqualifyingSignalHasNoLifecycleEffectsTest() {
  const fixture = await createOwnedStores('provider-a');
  const mapId = String(fixture.mapping.id);
  await fixture.correlations.upsertEndpointCorrelation({
    orgLinkId: mapId,
    endpointId: 'ep-1',
    signalType: 'OFFLINE',
    externalTicketRef: { id: 'existing-ticket', displayId: 'A-100' },
    comparisonValue: 'previously-qualified-content',
    comparisonVersion: 'fake-content-v1'
  });
  const { dispatcher, calls } = createTestDispatcher(['provider-a']);
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });

  const pipeline = runStage4CandidatePipeline({
    config: pipelineConfig(mapId),
    action1Organizations: [{ id: 'org-1', name: 'Acme' }],
    action1EndpointsByOrg: { 'org-1': [{ id: 'ep-1', name: 'Host 1', last_seen: '2026-11-16_12-00-00' }] },
    now: '2026-11-17T12:00:00Z'
  });
  assert.strictEqual(pipeline.candidates.length, 0, 'signal no longer meeting its threshold produces no lifecycle candidate');

  const result = await service.runOnce({ candidates: pipeline.candidates, config: { operationalSafeguards: { maxOpenTicketsPerOrganization: 30 } } });
  assert.deepStrictEqual(result.results, [], 'absent signal produces no lifecycle action/result');
  assert.strictEqual(result.summary.candidatesSeen, 0);
  assert.strictEqual(result.summary.skipped, 0, 'absent signal does not add a lifecycle skipped counter');
  assert.deepStrictEqual(calls, { get: [], prepare: [], create: [], update: [] }, 'absent signal causes no provider operation');
  const retained = await fixture.correlations.getEndpointCorrelation(mapId, 'ep-1', 'OFFLINE');
  assert.strictEqual(retained.externalTicketRef.id, 'existing-ticket', 'absent signal leaves the existing correlation untouched');
  assert.strictEqual(retained.comparisonValue, 'previously-qualified-content');

  const defensive = await service.runOnce({ candidates: [{ candidate: candidate({ identity: { orgLinkId: mapId } }), signalQualifies: false }] });
  assert.deepStrictEqual(defensive.results, [], 'explicitly nonqualifying envelopes are excluded before lifecycle execution');
  assert.strictEqual(defensive.summary.skipped, 0);
  assert.deepStrictEqual(calls, { get: [], prepare: [], create: [], update: [] });
}

async function runCreateAndUnchangedSkipTest() {
  const fixture = await createOwnedStores('provider-a');
  const { dispatcher, calls } = createTestDispatcher(['provider-a']);
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations, now: () => 1794916800000 });
  const work = candidate({ identity: { orgLinkId: String(fixture.mapping.id) } });
  const created = await service.runOnce({ candidates: [work] });
  assert.strictEqual(created.summary.created, 1);
  assert.strictEqual(calls.create.length, 1);
  assert.strictEqual(calls.create[0].providerId, 'provider-a');
  const stored = await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE');
  assert.strictEqual(stored.externalTicketRef.id, created.results[0].ticketId);
  assert.strictEqual(stored.externalTicketRef.displayId, 'PROVIDER-A-1');
  assert.strictEqual(stored.comparisonVersion, 'fake-content-v1');

  const unchanged = await service.runOnce({ candidates: [work] });
  assert.strictEqual(unchanged.summary.skipped, 1);
  assert.strictEqual(calls.create.length, 1);
  assert.strictEqual(calls.update.length, 0);
}

async function runUpdateAndExistingOpenSkipPolicyTest() {
  const fixture = await createOwnedStores('provider-a');
  const { dispatcher, state, calls } = createTestDispatcher(['provider-a']);
  const work = candidate({ identity: { orgLinkId: String(fixture.mapping.id) }, signal: { reason: 'changed facts' } });
  const ref = { id: 'ticket-existing', displayId: 'A-55' };
  state.set('provider-a:ticket-existing', { openState: 'open', externalTicketRef: ref, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
  await fixture.correlations.upsertEndpointCorrelation({ orgLinkId: String(fixture.mapping.id), endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: ref, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });

  const updated = await service.runOnce({ candidates: [work], config: { operationalSafeguards: { maxOpenTicketsPerOrganization: 1 } } });
  assert.strictEqual(updated.summary.updated, 1, 'updates remain allowed while an org is at its create cap');
  assert.strictEqual(calls.update.length, 1);
  assert.strictEqual(calls.update[0].input.externalTicketRef.id, 'ticket-existing');
  const current = await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE');
  assert.strictEqual(current.externalTicketRef.id, 'ticket-existing');
  assert.notStrictEqual(current.comparisonValue, 'old');

  const skipped = await service.runOnce({ candidates: [candidate({ identity: { orgLinkId: String(fixture.mapping.id) }, signal: { reason: 'policy skip' } })], lifecycle: { existingOpenTicketBehavior: 'skip_existing_open' } });
  assert.strictEqual(skipped.summary.skipped, 1);
  assert.strictEqual(calls.update.length, 1, 'Skip policy suppresses changed-content updates');
}

async function runMissingAndClosedReplacementTest() {
  for (const openState of ['missing', 'closed']) {
    const fixture = await createOwnedStores('provider-a');
    const { dispatcher, state, calls } = createTestDispatcher(['provider-a']);
    const oldRef = { id: `old-${openState}` };
    if (openState === 'closed') state.set(`provider-a:${oldRef.id}`, { openState: 'closed', externalTicketRef: oldRef, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
    await fixture.correlations.upsertEndpointCorrelation({ orgLinkId: String(fixture.mapping.id), endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: oldRef, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
    const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });
    const work = candidate({ identity: { orgLinkId: String(fixture.mapping.id) } });
    const result = await service.runOnce({ candidates: [work] });
    assert.strictEqual(result.summary.created, 1, `confirmed ${openState} ticket is replaced`);
    assert.strictEqual(calls.create.length, 1);
    const firstRef = (await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE')).externalTicketRef;
    assert.notStrictEqual(firstRef.id, oldRef.id);
    const next = await service.runOnce({ candidates: [work] });
    assert.strictEqual(next.summary.skipped, 1, 'the replacement reference is used by the next lifecycle run');
    assert.strictEqual(calls.create.length, 1);
  }
}

async function runUnknownReadPreservesTrackingTest() {
  const fixture = await createOwnedStores('provider-a');
  const { dispatcher, state, calls } = createTestDispatcher(['provider-a']);
  const ref = { id: 'ticket-unknown' };
  state.set('provider-a:ticket-unknown', { error: Object.assign(new Error('secret authorization response body'), { code: 'AUTH_FAILED' }) });
  await fixture.correlations.upsertEndpointCorrelation({ orgLinkId: String(fixture.mapping.id), endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: ref, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });
  const failed = await service.runOnce({ candidates: [candidate({ identity: { orgLinkId: String(fixture.mapping.id) } })] });
  assert.strictEqual(failed.summary.failed, 1);
  assert.strictEqual(calls.create.length, 0, 'an unknown/auth read failure is never treated as missing');
  const retained = await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE');
  assert.strictEqual(retained.externalTicketRef.id, ref.id);
  assert.strictEqual(retained.comparisonValue, 'old');
}

async function runMalformedReadPreservesTrackingTest() {
  const fixture = await createOwnedStores('provider-a');
  const { dispatcher, calls } = createTestDispatcher(['provider-a']);
  fixture.tables.set('action1_ticketing_endpoint_correlations', [{
    provider_id: 'provider-a',
    identity_key: `${fixture.mapping.id}|ep-1|OFFLINE`,
    org_link_id: String(fixture.mapping.id),
    action1_org_id: `org-provider-a`,
    endpoint_id: 'ep-1',
    signal_type: 'OFFLINE',
    external_ticket_id: null,
    comparison_value: 'old',
    comparison_version: 'fake-content-v1'
  }]);
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });
  const result = await service.runOnce({ candidates: [candidate({ identity: { orgLinkId: String(fixture.mapping.id) } })] });
  assert.strictEqual(result.summary.failed, 1, 'a stored correlation without an external reference is a failed item');
  assert.strictEqual(calls.create.length, 0, 'malformed reference is never treated as missing');
  assert.strictEqual((await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE')).comparisonValue, 'old');
}

async function runProductionRegistryHasNoFakeLifecycleAccessTest() {
  assert.strictEqual(typeof PROVIDER_REGISTRY['connectwise-psa'].adapter.createTicket, 'function', 'production ConnectWise implements the create operation');
  assert.strictEqual(Object.values(PROVIDER_REGISTRY).some((entry) => /fake|test/i.test(entry.providerId)), false, 'test adapters are not registered in production');
  const fixture = createInMemoryTicketingDb();
  const dispatcher = createProviderDispatcher();
  await assert.rejects(
    () => dispatcher.invoke({ providerId: 'connectwise-psa', operation: 'createTicket', input: { preparedTicket: {} } }),
    (error) => error.code === 'CONNECTWISE_TICKET_PAYLOAD_INVALID'
  );
  assert.strictEqual(fixture.context.db.calls.length, 0, 'invalid production provider operation fails before tracking persistence');
}

async function runConnectWiseLifecycleCreateSkipAndUnavailableUpdateTest() {
  const fixture = await createOwnedStores('connectwise-psa');
  const adapter = createConnectWiseAdapter({ clientId: 'synthetic-client-id' });
  const dispatcher = createProviderDispatcher({ 'connectwise-psa': { providerId: 'connectwise-psa', label: 'ConnectWise PSA', contractMajor: CONTRACT_MAJOR, adapter } });
  const connection = {
    TicketingProvider_connectwise_psa_ApiRegion: 'NA',
    TicketingProvider_connectwise_psa_CompanyId: 'tenant',
    TicketingProvider_connectwise_psa_PublicApiKey: 'public',
    TicketingProvider_connectwise_psa_PrivateApiKey: 'private',
    TicketingProvider_connectwise_psa_ServiceBoardId: '1',
    TicketingProvider_connectwise_psa_InitialStatusId: '2',
    TicketingProvider_connectwise_psa_TicketTypeId: '3'
  };
  const requests = [];
  let nextTicketId = 540;
  const transport = async (request) => {
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/company/companies/statuses')) return { status: 200, data: [{ id: 5, disallowSavingFlag: false }] };
    if (path.endsWith('/company/companies/42')) return { status: 200, data: { id: 42, name: 'Synthetic Company', status: { id: 5 } } };
    if (path.endsWith('/service/tickets') && request.method === 'POST') return { status: 201, data: { id: ++nextTicketId } };
    if (/\/service\/tickets\/\d+$/.test(path)) return { status: 200, data: { id: Number(path.split('/').pop()), recordType: 'ServiceTicket', company: { id: 42 }, status: { id: 2 }, closedFlag: false } };
    throw new Error(`Unexpected synthetic ConnectWise request ${request.method} ${path}`);
  };
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'connectwise-psa', connection, transport, correlationStore: fixture.correlations });
  const work = candidate({ identity: { orgLinkId: String(fixture.mapping.id), signalType: 'AUTOMATION_FAILED', key: `${fixture.mapping.id}|ep-1|AUTOMATION_FAILED` }, routing: { action1OrgId: 'org-connectwise-psa', destinationId: '42' }, signal: { type: 'AUTOMATION_FAILED', reason: 'failed run' } });
  const created = await service.runOnce({ candidates: [work] });
  assert.strictEqual(created.summary.created, 1, 'shared lifecycle creates through the production ConnectWise adapter');
  assert.strictEqual(requests.filter((request) => request.method === 'POST').length, 1, 'lifecycle create uses a single destination POST');
  const stored = await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'AUTOMATION_FAILED');
  assert.strictEqual(stored.externalTicketRef.id, '541', 'shared correlation store owns the created ticket identity');
  const samePrepared = await adapter.prepareTicket({ input: { candidate: work, content: buildTicketContentFromCandidate({ candidate: work }), effectiveRoute: work.routing }, connection });
  assert.strictEqual(stored.comparisonValue, samePrepared.comparisonValue, 'same Action1-managed content has a stable provider comparison');
  assert.strictEqual(stored.comparisonVersion, samePrepared.comparisonVersion, 'same Action1-managed content retains the comparison version');
  const groupedWork = {
    ticketModel: 'grouped',
    identity: { orgLinkId: String(fixture.mapping.id), signalType: 'AUTOMATION_FAILED', identityKey: `${fixture.mapping.id}|AUTOMATION_FAILED|inst-grouped` },
    issueKey: 'inst-grouped',
    routing: work.routing,
    signal: { type: 'AUTOMATION_FAILED', reason: 'grouped failure' },
    grouped: {
      issueKey: 'inst-grouped',
      issueMetadata: { automationInstanceId: 'inst-grouped', automationName: 'Deployment' },
      impactedEndpointCount: 2,
      impactedEndpoints: [{ endpointId: 'ep-1', endpointName: 'Host One' }, { endpointId: 'ep-2', endpointName: 'Host Two' }]
    }
  };
  const groupedCreate = await service.runOnce({ candidates: [groupedWork] });
  assert.strictEqual(groupedCreate.summary.created, 1, 'grouped automation signal creates through the same shared lifecycle');
  const groupedStored = await fixture.correlations.getGroupedCorrelation(String(fixture.mapping.id), 'AUTOMATION_FAILED', 'inst-grouped');
  assert.strictEqual(groupedStored.externalTicketRef.id, '542', 'grouped automation uses its existing automation-instance correlation identity');
  assert.strictEqual(groupedCreate.results[0].identityKey, `${fixture.mapping.id}|AUTOMATION_FAILED|inst-grouped`);
  const postCountBeforeUpdate = requests.filter((request) => request.method === 'POST').length;
  const changed = { ...work, signal: { ...work.signal, reason: 'changed failure detail' } };
  const update = await service.runOnce({ candidates: [changed] });
  assert.strictEqual(update.summary.failed, 1, 'changed open ticket fails safely while ConnectWise update remains unavailable');
  assert.strictEqual(requests.filter((request) => request.method === 'POST').length, postCountBeforeUpdate, 'unimplemented update never falls back to a create');
  const retained = await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'AUTOMATION_FAILED');
  assert.strictEqual(retained.externalTicketRef.id, '541');
  assert.strictEqual(retained.comparisonValue, stored.comparisonValue, 'failed update does not advance shared comparison state');
}

async function runProviderIsolationTest() {
  const shared = createInMemoryTicketingDb();
  const fixtureA = await createOwnedStores('provider-a', shared);
  const fixtureB = await createOwnedStores('provider-b', shared);
  const { dispatcher, state, calls } = createTestDispatcher(['provider-a', 'provider-b']);
  const ref = { id: 'same-external-id' };
  for (const [providerId, fixture, prior] of [['provider-a', fixtureA, 'old-a'], ['provider-b', fixtureB, 'old-b']]) {
    await fixture.correlations.upsertEndpointCorrelation({ orgLinkId: String(fixture.mapping.id), endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: ref, comparisonValue: prior, comparisonVersion: 'fake-content-v1' });
    state.set(`${providerId}:same-external-id`, { openState: 'open', externalTicketRef: ref, comparisonValue: prior, comparisonVersion: 'fake-content-v1' });
  }
  const serviceA = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixtureA.correlations });
  await serviceA.runOnce({ candidates: [candidate({ identity: { orgLinkId: String(fixtureA.mapping.id) }, signal: { reason: 'A changed' } })] });
  assert(calls.update.every((entry) => entry.providerId === 'provider-a'));
  assert(calls.get.every((entry) => entry.providerId === 'provider-a'), 'provider A cap and lifecycle reads never invoke provider B');
  assert.notStrictEqual((await fixtureA.correlations.getEndpointCorrelation(String(fixtureA.mapping.id), 'ep-1', 'OFFLINE')).comparisonValue, 'old-a');
  assert.strictEqual((await fixtureB.correlations.getEndpointCorrelation(String(fixtureB.mapping.id), 'ep-1', 'OFFLINE')).comparisonValue, 'old-b', 'provider A cannot mutate provider B correlation');
}

async function runGroupedFamilyAndCapIsolationTest() {
  const shared = createInMemoryTicketingDb();
  const fixtureA = await createOwnedStores('provider-a', shared);
  const fixtureB = await createOwnedStores('provider-b', shared);
  const { dispatcher, state, calls } = createTestDispatcher(['provider-a', 'provider-b']);
  const ref = { id: 'shared-cap-ticket' };
  state.set('provider-a:shared-cap-ticket', { openState: 'open', externalTicketRef: ref });
  await fixtureA.correlations.upsertEndpointCorrelation({ orgLinkId: String(fixtureA.mapping.id), endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: ref, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
  await fixtureA.correlations.upsertGroupedCorrelation({ orgLinkId: String(fixtureA.mapping.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', externalTicketRef: ref, comparisonValue: 'group-old', comparisonVersion: 'fake-content-v1' });
  await fixtureB.correlations.upsertEndpointCorrelation({ orgLinkId: String(fixtureB.mapping.id), endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: { id: 'provider-b-only' }, comparisonValue: 'B', comparisonVersion: 'fake-content-v1' });

  const serviceA = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixtureA.correlations });
  const grouped = {
    ticketModel: 'grouped',
    identity: { orgLinkId: String(fixtureA.mapping.id), signalType: 'VULNERABILITY', identityKey: `${fixtureA.mapping.id}|VULNERABILITY|CVE-2` },
    issueKey: 'CVE-2',
    routing: { action1OrgId: 'org-provider-a', destinationId: 'dest-provider-a' },
    signal: { type: 'VULNERABILITY', reason: 'new group' },
    grouped: { issueKey: 'CVE-2', issueMetadata: { cveId: 'CVE-2' }, impactedEndpointCount: 1, impactedEndpoints: [{ endpointId: 'ep-2', endpointName: 'Host 2', endpoint: { id: 'ep-2', name: 'Host 2' } }] }
  };
  const cap = await serviceA.runOnce({ candidates: [grouped], config: { operationalSafeguards: { maxOpenTicketsPerOrganization: 1 } } });
  assert.strictEqual(cap.summary.skipped, 1, 'endpoint and grouped links count together toward the provider A create cap');
  assert.strictEqual(cap.results[0].reason, 'ORG_OPEN_TICKET_LIMIT_REACHED');
  assert.strictEqual(calls.create.length, 0, 'provider B links do not add to A count, while A endpoint/grouped share a ref and count once');
  assert.deepStrictEqual(await fixtureA.correlations.getGroupedCorrelation(String(fixtureA.mapping.id), 'VULNERABILITY', 'CVE-2'), null);

  const endpoint = candidate({ identity: { orgLinkId: String(fixtureA.mapping.id), endpointId: 'ep-duplicate' }, endpoint: { id: 'ep-duplicate', name: 'Duplicate fixture' } });
  const duplicate = await serviceA.runOnce({ candidates: [endpoint, endpoint] });
  assert.strictEqual(duplicate.summary.created, 1);
  assert.strictEqual(duplicate.summary.skipped, 1);
  assert.strictEqual(duplicate.summary.skippedByReason.duplicate_candidate, 1);
  assert.strictEqual(calls.create.length, 1, 'duplicate identities have at most one create attempt');
}

async function runBestEffortCapReadFailureCharacterizationTest() {
  const fixture = await createOwnedStores('provider-a');
  const { dispatcher, state, calls } = createTestDispatcher(['provider-a']);
  await fixture.correlations.upsertGroupedCorrelation({ orgLinkId: String(fixture.mapping.id), signalType: 'VULNERABILITY', issueKey: 'CVE-OLD', externalTicketRef: { id: 'unreadable-linked-ticket' }, comparisonValue: 'old', comparisonVersion: 'fake-content-v1' });
  state.set('provider-a:unreadable-linked-ticket', { error: Object.assign(new Error('temporary read error'), { code: 'TEMPORARY_READ_ERROR' }) });
  const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });
  const work = candidate({ identity: { orgLinkId: String(fixture.mapping.id), endpointId: 'ep-cap' }, endpoint: { id: 'ep-cap', name: 'Cap test' } });
  const result = await service.runOnce({ candidates: [work], config: { operationalSafeguards: { maxOpenTicketsPerOrganization: 1 } } });
  assert.strictEqual(result.summary.created, 1, 'the donor best-effort cap can undercount when an existing linked-ticket read fails');
  assert.strictEqual(calls.create.length, 1);
}

async function runAmbiguousCreateAndCorrelationFailureTest() {
  {
    const fixture = await createOwnedStores('provider-a');
    const { dispatcher, state, calls } = createTestDispatcher(['provider-a']);
    state.set('provider-a:create-error', Object.assign(new Error('timeout after write'), { code: 'CREATE_TIMEOUT', ambiguous: true }));
    const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });
    const result = await service.runOnce({ candidates: [candidate({ identity: { orgLinkId: String(fixture.mapping.id) } })] });
    assert.strictEqual(result.summary.failed, 1);
    assert.strictEqual(calls.create.length, 1, 'ambiguous create is not replayed in the same lifecycle attempt');
    assert.strictEqual(await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE'), null);
  }
  {
    const fixture = await createOwnedStores('provider-a');
    const originalRun = fixture.context.db.run.bind(fixture.context.db);
    fixture.context.db.run = async (sql, params) => {
      if (/INSERT\s+INTO\s+action1_ticketing_endpoint_correlations/i.test(sql)) throw Object.assign(new Error('controlled persistence failure'), { code: 'DB_WRITE_FAILED' });
      return originalRun(sql, params);
    };
    const { dispatcher, calls } = createTestDispatcher(['provider-a']);
    const service = createLifecycleRunService({ providerDispatcher: dispatcher, providerId: 'provider-a', correlationStore: fixture.correlations });
    const result = await service.runOnce({ candidates: [candidate({ identity: { orgLinkId: String(fixture.mapping.id) } })] });
    assert.strictEqual(result.summary.failed, 1, 'confirmed destination create plus persistence failure is reported honestly');
    assert.strictEqual(calls.create.length, 1, 'persistence failure does not cause a blind create retry');
    assert.strictEqual(await fixture.correlations.getEndpointCorrelation(String(fixture.mapping.id), 'ep-1', 'OFFLINE'), null);
  }
}

async function run() {
  await runNonqualifyingSignalHasNoLifecycleEffectsTest();
  await runCreateAndUnchangedSkipTest();
  await runUpdateAndExistingOpenSkipPolicyTest();
  await runMissingAndClosedReplacementTest();
  await runUnknownReadPreservesTrackingTest();
  await runMalformedReadPreservesTrackingTest();
  await runProductionRegistryHasNoFakeLifecycleAccessTest();
  await runConnectWiseLifecycleCreateSkipAndUnavailableUpdateTest();
  await runProviderIsolationTest();
  await runGroupedFamilyAndCapIsolationTest();
  await runBestEffortCapReadFailureCharacterizationTest();
  await runAmbiguousCreateAndCorrelationFailureTest();
  console.log('Action1 Ticketing provider lifecycle integration tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
