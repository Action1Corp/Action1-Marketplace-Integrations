const assert = require('assert');
const { createMappingActionHandlers } = require('../mappingActions');
const { createProviderDispatcher } = require('../providerRegistry');
const { createDbMappingStore } = require('../mappingStore');
const { createDbCorrelationStore } = require('../correlationStore');
const { createDbSignalWatermarkStore } = require('../signalWatermarkStore');
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');

function makeHarness({ organizations, destinations, activeProviderId = 'provider-a', limits, onDiscover, now } = {}) {
  const { context, tables } = createInMemoryTicketingDb();
  const calls = [];
  const state = { activeProviderId, organizations: organizations || [], destinations: destinations || [] };
  context.settings = { async get(key) { return key === 'TicketingActiveProvider' ? state.activeProviderId : ''; } };
  const registry = Object.fromEntries(['provider-a', 'provider-b'].map((providerId) => [providerId, {
    providerId, label: providerId, contractMajor: 1,
    adapter: {
      validateConfiguration: async () => ({ ok: true, errors: [] }),
      testConnection: async () => ({ ok: true }),
      discover: async ({ input }) => {
        calls.push({ providerId, input });
        if (onDiscover) return onDiscover({ providerId, input, state, calls });
        const offset = input.continuationToken ? Number(input.continuationToken.replace('offset:', '')) : 0;
        const options = state.destinations.slice(offset, offset + input.pageSize);
        const nextOffset = offset + options.length;
        const hasMore = nextOffset < state.destinations.length;
        return { options, hasMore, nextPageToken: hasMore ? `offset:${nextOffset}` : null, complete: !hasMore, searchSupported: true, paginationSupported: true };
      },
      prepareTicket: async () => ({ payload: {}, comparisonValue: '', comparisonVersion: '1' }),
      getTicket: async () => ({ state: 'missing', confirmed: true }),
      createTicket: async () => ({ externalTicketRef: { id: 'synthetic' } }),
      updateTicket: async () => ({ ok: true })
    }
  }]));
  const definitions = Object.fromEntries(Object.keys(registry).map((providerId) => [providerId, {
    providerId, label: providerId, available: true, fields: [], accountSelectors: []
  }]));
  const handlers = createMappingActionHandlers({
    registry,
    definitions,
    dispatcher: createProviderDispatcher(registry),
    loadAction1Organizations: async () => state.organizations,
    autoMatchLimits: limits,
    now
  });
  return { context, tables, state, calls, handlers, registry };
}

function discoveryRows(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({ id: `dest-${index + 1}`, label: overrides[index + 1] || `Customer ${index + 1}` }));
}

async function testPreviewTraversesCompleteDirectoryWithoutWrites() {
  const organizations = [
    { id: 'org-exact', name: ' Customer   1001 ' },
    { id: 'org-missing', name: 'No Such Customer' },
    { id: 'org-ambiguous', name: 'Twin' }
  ];
  const destinations = discoveryRows(1201, { 1200: 'Twin', 1201: ' Twin ' });
  const harness = makeHarness({ organizations, destinations });
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  assert.strictEqual(preview.ok, true, JSON.stringify(preview));
  assert.strictEqual(preview.complete, true);
  assert.strictEqual(preview.analyzedCount, 3);
  assert.deepStrictEqual(preview.exactMatches.map((match) => match.action1OrgId), ['org-exact']);
  assert.deepStrictEqual(preview.unmatched.map((match) => match.action1OrgId), ['org-missing']);
  assert.strictEqual(preview.ambiguous[0].reason, 'duplicate_destination_names');
  assert.strictEqual(harness.calls.length, 3, 'the server traverses all 1,201 destinations in 500-option pages');
  assert(harness.calls.every((call) => call.input.pageSize === 500));
  assert(!Object.prototype.hasOwnProperty.call(preview, 'destinationOptions'), 'the browser receives categorized matches, not the destination directory');
  assert.strictEqual(harness.context.db.calls.filter((call) => call.method === 'run').length, 0, 'Preview performs no persistence writes');
}

async function testApplyRevalidatesAndIsSafeWhenRepeatedOrConcurrent() {
  const harness = makeHarness({
    organizations: [{ id: 'org-one', name: 'One' }, { id: 'org-two', name: 'Two' }],
    destinations: [{ id: 'dest-one', label: 'One' }, { id: 'dest-two', label: 'Two' }]
  });
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  const matches = preview.exactMatches;
  const first = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches, draftRows: [] });
  assert.strictEqual(first.ok, true, JSON.stringify(first));
  assert.strictEqual(first.applied, 2);
  assert.strictEqual(first.skipped, 0);
  const repeated = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches, draftRows: [] });
  assert.strictEqual(repeated.applied, 0);
  assert.strictEqual(repeated.skipped, 2, 'duplicate Apply requests revalidate and never insert duplicate relationships');
  assert.strictEqual((await createDbMappingStore(harness.context, 'provider-a').list()).length, 2);
  assert.strictEqual(harness.tables.has('action1_ticketing_endpoint_correlations'), false);
  assert.strictEqual(harness.tables.has('action1_ticketing_signal_watermarks'), false);
}

async function testSimultaneousDuplicateApplyRequestsRespectUniqueMappings() {
  const harness = makeHarness({ organizations: [{ id: 'org-one', name: 'One' }], destinations: [{ id: 'dest-one', label: 'One' }] });
  const originalRun = harness.context.db.run.bind(harness.context.db);
  harness.context.db.run = async (sql, params) => {
    if (sql.startsWith('INSERT INTO action1_ticketing_org_client_mappings')) {
      const existing = harness.tables.get('action1_ticketing_org_client_mappings') || [];
      if (existing.some((row) => row.provider_id === params[0] && row.action1_org_id === params[1])) throw new Error('UNIQUE constraint failed: provider_id, action1_org_id');
    }
    return originalRun(sql, params);
  };
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  const request = { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [] };
  const results = await Promise.all([
    harness.handlers.applyAutoMatch(harness.context, request),
    harness.handlers.applyAutoMatch(harness.context, request)
  ]);
  assert.strictEqual(results.reduce((total, item) => total + item.applied, 0), 1);
  assert.strictEqual((await createDbMappingStore(harness.context, 'provider-a').list()).length, 1);
}

async function testApplyRejectsProviderDriftAndSkipsChangedDirectoryIdentity() {
  const harness = makeHarness({ organizations: [{ id: 'org-one', name: 'One' }], destinations: [{ id: 'dest-one', label: 'One' }] });
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  harness.state.activeProviderId = 'provider-b';
  const switched = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [] });
  assert.strictEqual(switched.ok, false);
  assert.strictEqual(switched.applied, 0);
  assert.strictEqual(harness.calls.filter((call) => call.providerId === 'provider-b').length, 0);
  harness.state.activeProviderId = 'provider-a';
  harness.state.destinations = [{ id: 'dest-one', label: 'Renamed' }];
  const changed = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [] });
  assert.strictEqual(changed.applied, 0);
  assert.strictEqual(changed.skipped, 1, 'a destination that changed since Preview is not inserted');
  assert.strictEqual((await createDbMappingStore(harness.context, 'provider-a').list()).length, 0);
  harness.state.destinations = [{ id: 'dest-one', label: 'One' }];
  harness.state.organizations = [{ id: 'org-one', name: 'Renamed source' }];
  const sourceChanged = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [] });
  assert.strictEqual(sourceChanged.skipped, 1, 'a source name changed since Preview is not inserted');
}

async function testIncompleteDiscoveryNeverReturnsUnmatchedResults() {
  const harness = makeHarness({
    organizations: [{ id: 'org-one', name: 'One' }],
    onDiscover: async ({ input }) => ({ options: [{ id: 'dest-one', label: 'One' }], hasMore: false, nextPageToken: null, complete: false, searchSupported: true, paginationSupported: false })
  });
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.complete, false);
  assert.deepStrictEqual(preview.exactMatches, []);
  assert.deepStrictEqual(preview.unmatched, []);
  assert.deepStrictEqual(preview.ambiguous, []);
  assert.match(preview.message, /incomplete/i);
}

async function testOperationalBoundReturnsIncompleteAndApplyReportsPartialFailure() {
  const bounded = makeHarness({
    organizations: [{ id: 'org-one', name: 'One' }],
    destinations: discoveryRows(600),
    limits: { maxPages: 1 }
  });
  const incomplete = await bounded.handlers.previewAutoMatch(bounded.context, { providerId: 'provider-a', draftRows: [] });
  assert.strictEqual(incomplete.complete, false);
  assert.match(incomplete.message, /incomplete/i);
  assert.deepStrictEqual(incomplete.unmatched, []);
  assert.strictEqual(bounded.calls.length, 1, 'the traversal stops at the operational page bound');

  const harness = makeHarness({
    organizations: [{ id: 'org-one', name: 'One' }, { id: 'org-two', name: 'Two' }],
    destinations: [{ id: 'dest-one', label: 'One' }, { id: 'dest-two', label: 'Two' }]
  });
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  const originalRun = harness.context.db.run.bind(harness.context.db);
  harness.context.db.run = async (sql, params) => {
    if (sql.startsWith('INSERT INTO action1_ticketing_org_client_mappings') && params[3] === 'dest-two') throw new Error('synthetic database failure');
    return originalRun(sql, params);
  };
  const partial = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [] });
  assert.strictEqual(partial.applied, 1);
  assert.strictEqual(partial.failed, 1);
  assert.strictEqual(partial.results.find((row) => row.action1OrgId === 'org-two').reason, 'mapping_save_failed');
  assert.strictEqual(partial.mappings.length, 1, 'partial Apply returns the authoritative persisted state');
}

async function testApplySkipsDraftChangesAndRetainsProviderScopedIsolation() {
  const harness = makeHarness({
    organizations: [{ id: 'org-one', name: 'One' }],
    destinations: [{ id: 'dest-one', label: 'One' }]
  });
  const incompleteDraft = { id: null, action1OrgId: 'org-one', action1OrgName: 'One', destinationId: '', destinationName: '' };
  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [incompleteDraft] });
  assert.strictEqual(preview.exactMatches.length, 1);
  const changedDraft = { ...incompleteDraft, action1OrgName: 'User edited name' };
  const skipped = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [changedDraft] });
  assert.strictEqual(skipped.skipped, 1);
  assert.strictEqual(skipped.results[0].reason, 'draft_changed');
  assert.strictEqual((await createDbMappingStore(harness.context, 'provider-a').list()).length, 0);

  const firstPreview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  const firstApply = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: firstPreview.exactMatches, draftRows: [] });
  assert.strictEqual(firstApply.applied, 1);
  harness.state.activeProviderId = 'provider-b';
  const providerBPreview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-b', draftRows: [] });
  const providerBApply = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-b', matches: providerBPreview.exactMatches, draftRows: [] });
  assert.strictEqual(providerBApply.applied, 1);
  assert.notStrictEqual(providerBApply.mappings[0].id, firstApply.mappings[0].id);
  harness.state.activeProviderId = 'provider-a';
  const providerAList = await harness.handlers.listHaloOrgClientMappings(harness.context, { providerId: 'provider-a' });
  assert.deepStrictEqual(providerAList.mappings.map((row) => row.providerId), ['provider-a']);
  assert.strictEqual((await createDbMappingStore(harness.context, 'provider-b').list())[0].providerId, 'provider-b');
}

async function testApplyPreservesExistingMappingIdentityCorrelationsAndWatermark() {
  const harness = makeHarness({
    organizations: [{ id: 'org-existing', name: 'Existing' }, { id: 'org-new', name: 'New' }],
    destinations: [{ id: 'dest-existing', label: 'Existing' }, { id: 'dest-new', label: 'New' }]
  });
  const mappings = createDbMappingStore(harness.context, 'provider-a');
  const existing = await mappings.save({ action1OrgId: 'org-existing', action1OrgName: 'Existing', destinationId: 'dest-existing', destinationName: 'Existing' });
  const correlations = createDbCorrelationStore(harness.context, 'provider-a');
  await correlations.upsertEndpointCorrelation({ orgLinkId: String(existing.id), endpointId: 'endpoint-stable', signalType: 'OFFLINE', linkedTicketId: 'ticket-stable', payloadHash: 'hash' });
  await correlations.upsertGroupedCorrelation({ orgLinkId: String(existing.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', linkedTicketId: 'group-stable', payloadHash: 'group-hash' });
  const watermarks = createDbSignalWatermarkStore(harness.context, 'provider-a');
  await watermarks.upsertWatermark({ orgLinkId: String(existing.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'checkpoint-stable' });

  const preview = await harness.handlers.previewAutoMatch(harness.context, { providerId: 'provider-a', draftRows: [] });
  assert.deepStrictEqual(preview.exactMatches.map((row) => row.action1OrgId), ['org-new'], 'complete mappings are excluded from Auto Match');
  const applied = await harness.handlers.applyAutoMatch(harness.context, { providerId: 'provider-a', matches: preview.exactMatches, draftRows: [] });
  assert.strictEqual(applied.applied, 1);
  const reloaded = await mappings.getByAction1OrgId('org-existing');
  assert.strictEqual(reloaded.id, existing.id, 'Auto Match does not replace or reidentify an existing mapping');
  assert.strictEqual((await correlations.listEndpointCorrelationsByOrgLink(String(existing.id))).length, 1);
  assert.strictEqual((await correlations.listGroupedCorrelationsByOrgLink(String(existing.id))).length, 1);
  assert.strictEqual((await watermarks.getWatermark(String(existing.id), 'AUTOMATION_FAILED')).watermarkValue, 'checkpoint-stable');
}

async function run() {
  await testPreviewTraversesCompleteDirectoryWithoutWrites();
  await testApplyRevalidatesAndIsSafeWhenRepeatedOrConcurrent();
  await testSimultaneousDuplicateApplyRequestsRespectUniqueMappings();
  await testApplyRejectsProviderDriftAndSkipsChangedDirectoryIdentity();
  await testIncompleteDiscoveryNeverReturnsUnmatchedResults();
  await testOperationalBoundReturnsIncompleteAndApplyReportsPartialFailure();
  await testApplySkipsDraftChangesAndRetainsProviderScopedIsolation();
  await testApplyPreservesExistingMappingIdentityCorrelationsAndWatermark();
  console.log('Action1 Ticketing Auto Match action contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
