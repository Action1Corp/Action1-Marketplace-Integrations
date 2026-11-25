'use strict';

const assert = require('assert');
const { createConnectWiseAdapter } = require('../providers/connectwisePsaAdapter');
const { createProviderDispatcher } = require('../providerRegistry');
const { PROVIDER_REGISTRY } = require('../providerRegistry');
const { createLifecycleWriteOrchestrator } = require('../lifecycle/lifecycleWriteOrchestrator');

const adapter = createConnectWiseAdapter();
const dispatcher = createProviderDispatcher(PROVIDER_REGISTRY);
const connection = {
  TicketingProvider_connectwise_psa_ApiRegion: 'NA',
  TicketingProvider_connectwise_psa_CompanyId: 'tenant',
  TicketingProvider_connectwise_psa_PublicApiKey: 'public',
  TicketingProvider_connectwise_psa_PrivateApiKey: 'private',
  TicketingProvider_connectwise_psa_TicketContentUpdateMode: 'replace-original-description'
};
const input = (overrides = {}) => ({
  externalTicketRef: { id: '123' }, expectedRoute: { destinationId: '42' },
  preparedTicket: { summary: 'New summary', initialDescription: 'New description', company: { id: 42 } }, ...overrides
});
const ticket = (overrides = {}) => ({ id: 123, recordType: 'ServiceTicket', summary: 'Old summary', company: { id: 42 }, status: { id: 6 }, closedFlag: false, ...overrides });
const note = (overrides = {}) => ({ id: 8, detailDescriptionFlag: true, text: 'Old description', ...overrides });

function transportFor({ ticketResponse = ticket(), pages = [[note()]], patchResults = [], postResults = [], statusRows = [{ id: 2, disallowSavingFlag: false }], company = { id: 42, deletedFlag: false, status: { id: 2 } } } = {}) {
  const calls = [];
  let page = 0;
  let patch = 0;
  let post = 0;
  const transport = async (options) => {
    calls.push(options);
    const url = new URL(options.url);
    if (url.pathname.endsWith('/service/tickets/123')) {
      if (options.method === 'GET') return { status: 200, data: ticketResponse };
      const configured = patchResults[patch++];
      if (configured instanceof Error) throw configured;
      return configured || { status: 200, data: { ...ticketResponse, summary: 'New summary' } };
    }
    if (url.pathname.endsWith('/service/tickets/123/notes')) {
      if (options.method === 'POST') {
        const configured = postResults[post++];
        if (configured instanceof Error) throw configured;
        return configured || { status: 201, data: { id: 99, text: options.data.text, internalAnalysisFlag: true } };
      }
      const index = page++;
      const next = index < pages.length - 1 ? { link: `<${url.pathname}?page=${index + 2}&pageSize=1000>; rel="next"` } : {};
      return { status: 200, headers: next, data: pages[index] };
    }
    if (url.pathname.includes('/service/tickets/123/notes/')) {
      const configured = patchResults[patch++];
      if (configured instanceof Error) throw configured;
      return configured || { status: 200, data: { id: 8, text: 'New description' } };
    }
    if (url.pathname.endsWith('/company/companies/42')) return { status: 200, data: company };
    if (url.pathname.endsWith('/company/companies/statuses')) return { status: 200, data: statusRows };
    throw new Error(`Unexpected request ${options.method} ${url.pathname}`);
  };
  return { transport, calls };
}

async function rejected(call, code) {
  const error = await call.then(() => null, (value) => value);
  assert(error, `expected failure ${code}`);
  assert.strictEqual(error.code, code);
  return error;
}

async function run() {
  const paged = transportFor({ pages: [[{ id: 1, detailDescriptionFlag: false, text: 'Tech note' }], [note()]] });
  const result = await dispatcher.invoke({ providerId: 'connectwise-psa', operation: 'updateTicket', input: input(), connection, transport: paged.transport });
  assert.deepStrictEqual(result, { ok: true });
  const notesCalls = paged.calls.filter((call) => new URL(call.url).pathname.endsWith('/notes'));
  assert.strictEqual(notesCalls.length, 2, 'follows ConnectWise Link pagination before selecting the original description');
  assert.strictEqual(new URL(notesCalls[0].url).searchParams.get('pageSize'), '1000');
  assert.strictEqual(new URL(notesCalls[1].url).searchParams.get('page'), '2');
  const patches = paged.calls.filter((call) => call.method === 'PATCH');
  assert.strictEqual(patches.length, 2);
  assert.strictEqual(patches[0].data[0].path, 'summary');
  assert.strictEqual(patches[1].data[0].path, 'text');
  assert(patches.every((call) => call.maxAttempts === 1), 'each write has one transport attempt');
  assert(paged.calls.find((call) => call.method === 'GET' && new URL(call.url).pathname.endsWith('/service/tickets/123')));

  const current = transportFor({ ticketResponse: ticket({ summary: 'New summary' }), pages: [[note({ text: 'New description' })]] });
  assert.deepStrictEqual(await adapter.updateTicket({ input: input(), connection, transport: current.transport }), { ok: true });
  assert.strictEqual(current.calls.filter((call) => call.method === 'PATCH').length, 0, 'current summary and note do not cause writes');
  const summaryOnly = transportFor({ pages: [[note({ text: 'New description' })]] });
  await adapter.updateTicket({ input: input(), connection, transport: summaryOnly.transport });
  assert.deepStrictEqual(summaryOnly.calls.filter((call) => call.method === 'PATCH').map((call) => call.data[0].path), ['summary']);
  const descriptionOnly = transportFor({ ticketResponse: ticket({ summary: 'New summary' }) });
  await adapter.updateTicket({ input: input(), connection, transport: descriptionOnly.transport });
  assert.deepStrictEqual(descriptionOnly.calls.filter((call) => call.method === 'PATCH').map((call) => call.data[0].path), ['text']);

  for (const notes of [[], [note(), note({ id: 9 })]]) {
    const unsafe = transportFor({ pages: [notes] });
    await rejected(adapter.updateTicket({ input: input(), connection, transport: unsafe.transport }), 'CONNECTWISE_DESCRIPTION_NOTE_AMBIGUOUS');
    assert.strictEqual(unsafe.calls.filter((call) => call.method === 'PATCH').length, 0, 'unsafe note identity prevents every write');
  }

  const incompleteNotes = transportFor();
  const incompleteTransport = async (options) => {
    const url = new URL(options.url);
    if (url.pathname.endsWith('/notes')) return { status: 200, headers: { link: `<${url.pathname}>; rel="next"` }, data: [note()] };
    return incompleteNotes.transport(options);
  };
  await rejected(adapter.updateTicket({ input: input(), connection, transport: incompleteTransport }), 'CONNECTWISE_NOTES_PAGINATION_INVALID');
  assert.strictEqual(incompleteNotes.calls.filter((call) => call.method === 'PATCH').length, 0, 'unusable next-page link blocks writes');

  const appendConnection = { ...connection, TicketingProvider_connectwise_psa_TicketContentUpdateMode: 'append-new-note' };
  const append = transportFor({ ticketResponse: ticket() });
  assert.deepStrictEqual(await dispatcher.invoke({ providerId: 'connectwise-psa', operation: 'updateTicket', input: input(), connection: appendConnection, transport: append.transport }), { ok: true });
  assert.strictEqual(append.calls.filter((call) => new URL(call.url).pathname.endsWith('/notes') && call.method === 'GET').length, 0, 'ordinary Append does not retrieve Notes');
  const appendPost = append.calls.find((call) => call.method === 'POST');
  assert(appendPost, 'Append writes exactly one new Internal Note');
  assert.deepStrictEqual(appendPost.data, { text: 'New description', internalAnalysisFlag: true });
  for (const forbidden of ['detailDescriptionFlag', 'resolutionFlag', 'internalFlag', 'externalFlag', 'processNotifications']) assert.strictEqual(Object.hasOwn(appendPost.data, forbidden), false);
  assert.strictEqual(appendPost.maxAttempts, 1);
  assert.deepStrictEqual(append.calls.filter((call) => call.method === 'PATCH').map((call) => call.data[0].path), ['summary']);
  assert(append.calls.findIndex((call) => call.method === 'PATCH') < append.calls.findIndex((call) => call.method === 'POST'), 'Summary PATCH precedes note POST');
  assert.strictEqual(append.calls.some((call) => call.method === 'PATCH' && new URL(call.url).pathname.includes('/notes/')), false, 'Append never modifies existing notes');
  const appendNoSummary = transportFor({ ticketResponse: ticket({ summary: 'New summary' }) });
  await adapter.updateTicket({ input: input(), connection: appendConnection, transport: appendNoSummary.transport });
  assert.strictEqual(appendNoSummary.calls.some((call) => call.method === 'PATCH'), false, 'unchanged Summary is not patched in Append mode');
  assert.strictEqual(appendNoSummary.calls.filter((call) => call.method === 'POST').length, 1);
  const invalidMode = transportFor();
  await rejected(adapter.updateTicket({ input: input(), connection: { ...connection, TicketingProvider_connectwise_psa_TicketContentUpdateMode: 'unknown' }, transport: invalidMode.transport }), 'CONNECTWISE_CONTENT_MODE_INVALID');
  assert.strictEqual(invalidMode.calls.length, 0);
  const invalidSummary = transportFor();
  await rejected(adapter.updateTicket({ input: input({ preparedTicket: { summary: 'x'.repeat(101), initialDescription: 'Description', company: { id: 42 } } }), connection, transport: invalidSummary.transport }), 'CONNECTWISE_UPDATE_INPUT_INVALID');
  assert.strictEqual(invalidSummary.calls.length, 0, 'overlong summary is rejected before requests');

  const wrongCompany = transportFor({ ticketResponse: ticket({ company: { id: 99 } }) });
  await rejected(adapter.updateTicket({ input: input(), connection, transport: wrongCompany.transport }), 'CONNECTWISE_TICKET_OWNERSHIP_MISMATCH');
  assert.strictEqual(wrongCompany.calls.filter((call) => call.method === 'PATCH').length, 0);
  const closed = transportFor({ ticketResponse: ticket({ status: { id: 9 }, closedFlag: true }) });
  await rejected(adapter.updateTicket({ input: input(), connection, transport: closed.transport }), 'CONNECTWISE_TICKET_CLOSED');
  assert.strictEqual(closed.calls.filter((call) => call.method === 'PATCH').length, 0);
  const resolved = transportFor({ ticketResponse: ticket({ status: { id: 9 } }) });
  await rejected(adapter.updateTicket({ input: input(), connection: { ...connection, TicketingProvider_connectwise_psa_AdditionalClosedStatusIds: '9' }, transport: resolved.transport }), 'CONNECTWISE_TICKET_CLOSED');
  const missing = transportFor();
  await rejected(adapter.updateTicket({ input: input(), connection, transport: async (options) => {
    missing.calls.push(options);
    if (new URL(options.url).pathname.endsWith('/service/tickets/123')) return { status: 404, data: 'not found' };
    return missing.transport(options);
  } }), 'CONNECTWISE_HTTP_ERROR');
  assert.strictEqual(missing.calls.filter((call) => call.method === 'PATCH').length, 0);

  const ineligible = transportFor({ statusRows: [{ id: 2, disallowSavingFlag: true }] });
  await rejected(adapter.updateTicket({ input: input(), connection, transport: ineligible.transport }), 'CONNECTWISE_COMPANY_INELIGIBLE');
  assert.strictEqual(ineligible.calls.filter((call) => call.method === 'PATCH').length, 0);

  const partial = transportFor({ patchResults: [null, Object.assign(new Error('write failed'), { code: 'ETIMEDOUT' })] });
  const partialError = await adapter.updateTicket({ input: input(), connection, transport: partial.transport }).then(() => null, (error) => error);
  assert(partialError && partialError.ambiguous, 'note timeout after summary success is surfaced as ambiguous failure');
  assert.strictEqual(partial.calls.filter((call) => call.method === 'PATCH').length, 2, 'there is no automatic write retry');
  assert(!partialError.message.includes('Old description') && !partialError.message.includes('private'));
  for (const [response, expectedCode] of [
    [{ status: 400, data: { errors: [{ code: 'Unauthorized', message: 'sensitive body' }] } }, 'CONNECTWISE_PERMISSION_DENIED'],
    [{ status: 403, data: 'sensitive body' }, 'CONNECTWISE_PERMISSION_DENIED'],
    [{ status: 429, data: 'sensitive body' }, 'CONNECTWISE_RATE_LIMITED']
  ]) {
    const denied = transportFor({ patchResults: [response] });
    const error = await rejected(adapter.updateTicket({ input: input(), connection, transport: denied.transport }), expectedCode);
    assert(!error.message.includes('sensitive body'));
    assert.strictEqual(denied.calls.filter((call) => call.method === 'PATCH').length, 1);
  }
  const appendDenied = transportFor({ postResults: [{ status: 403, data: 'private vendor response' }] });
  const appendDeniedError = await adapter.updateTicket({ input: input(), connection: appendConnection, transport: appendDenied.transport }).then(() => null, (error) => error);
  assert.strictEqual(appendDeniedError.code, 'CONNECTWISE_PERMISSION_DENIED');
  assert(!appendDeniedError.message.includes('private vendor response'));
  assert.strictEqual(appendDenied.calls.filter((call) => call.method === 'POST').length, 1, 'definite POST failure is not retried');
  assert.strictEqual(appendDenied.calls.filter((call) => new URL(call.url).pathname.endsWith('/notes') && call.method === 'GET').length, 0);
  const appendAmbiguous = transportFor({ postResults: [Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })] });
  const appendAmbiguousError = await adapter.updateTicket({ input: input(), connection: appendConnection, transport: appendAmbiguous.transport }).then(() => null, (error) => error);
  assert(appendAmbiguousError?.ambiguous, 'uncertain append POST is reported as ambiguous');
  assert.strictEqual(appendAmbiguous.calls.filter((call) => call.method === 'POST').length, 1, 'uncertain POST is not retried in-call');
  assert.strictEqual(appendAmbiguous.calls.filter((call) => new URL(call.url).pathname.endsWith('/notes') && call.method === 'GET').length, 0);
  const malformedSuccess = transportFor({ patchResults: [{ status: 200, data: { id: 999, summary: 'unrelated' } }] });
  const malformedError = await adapter.updateTicket({ input: input(), connection, transport: malformedSuccess.transport }).then(() => null, (error) => error);
  assert(malformedError?.ambiguous, 'malformed successful response is not treated as confirmed');
  assert.strictEqual(malformedSuccess.calls.filter((call) => call.method === 'PATCH').length, 1);

  let persistedSummary = 'Old summary';
  let persistedDescription = 'Old description';
  let firstPass = true;
  const reconciliationCalls = [];
  const reconcileTransport = async (options) => {
    reconciliationCalls.push(options);
    const url = new URL(options.url);
    if (url.pathname.endsWith('/service/tickets/123')) {
      if (options.method === 'PATCH') { persistedSummary = options.data[0].value; return { status: 200, data: { id: 123, summary: persistedSummary } }; }
      return { status: 200, data: ticket({ summary: persistedSummary }) };
    }
    if (url.pathname.endsWith('/notes')) return { status: 200, data: [note({ text: persistedDescription })] };
    if (url.pathname.includes('/notes/')) {
      if (firstPass) { firstPass = false; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }
      persistedDescription = options.data[0].value;
      return { status: 200, data: { id: 8, text: persistedDescription } };
    }
    if (url.pathname.endsWith('/company/companies/42')) return { status: 200, data: { id: 42, status: { id: 2 } } };
    if (url.pathname.endsWith('/company/companies/statuses')) return { status: 200, data: [{ id: 2, disallowSavingFlag: false }] };
    throw new Error(`Unexpected request ${options.method} ${url.pathname}`);
  };
  const failedPass = await adapter.updateTicket({ input: input(), connection, transport: reconcileTransport }).then(() => null, (error) => error);
  assert(failedPass?.ambiguous);
  assert.strictEqual(persistedSummary, 'New summary');
  assert.strictEqual(persistedDescription, 'Old description');
  await adapter.updateTicket({ input: input(), connection, transport: reconcileTransport });
  assert.strictEqual(reconciliationCalls.filter((call) => call.method === 'PATCH' && new URL(call.url).pathname.endsWith('/service/tickets/123')).length, 1, 'later Sync does not repeat already-applied Summary PATCH');
  assert.strictEqual(reconciliationCalls.filter((call) => call.method === 'PATCH' && new URL(call.url).pathname.includes('/notes/')).length, 2, 'later Sync re-evaluates and retries only the description that remains different');
  assert.strictEqual(persistedDescription, 'New description');

  const lifecycleConnection = {
    ...connection,
    TicketingProvider_connectwise_psa_ServiceBoardId: '1',
    TicketingProvider_connectwise_psa_InitialStatusId: '2',
    TicketingProvider_connectwise_psa_TicketTypeId: '3'
  };
  let lifecycleSummary = 'Previous summary';
  let lifecycleDescription = 'Previous description';
  let failLifecycleNote = true;
  let savedCorrelation = { orgLinkId: '1', endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: { id: '123' }, comparisonValue: 'old-comparison', comparisonVersion: 'old-version' };
  let correlationWrites = 0;
  const correlationStore = {
    providerId: 'connectwise-psa',
    async getEndpointCorrelation() { return { ...savedCorrelation }; },
    async getGroupedCorrelation() { return null; },
    async upsertEndpointCorrelation(value) { savedCorrelation = { ...savedCorrelation, ...value }; correlationWrites += 1; },
    async upsertGroupedCorrelation() { throw new Error('unexpected grouped write'); },
    async listCorrelationsByOrgLink() { return []; }
  };
  const lifecycleTransport = async (options) => {
    const url = new URL(options.url);
    if (url.pathname.endsWith('/service/tickets/123')) {
      if (options.method === 'PATCH') { lifecycleSummary = options.data[0].value; return { status: 200, data: { id: 123, summary: lifecycleSummary } }; }
      return { status: 200, data: ticket({ summary: lifecycleSummary }) };
    }
    if (url.pathname.endsWith('/service/tickets/123/notes')) return { status: 200, data: [note({ text: lifecycleDescription })] };
    if (url.pathname.includes('/service/tickets/123/notes/')) {
      if (failLifecycleNote) { failLifecycleNote = false; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }
      lifecycleDescription = options.data[0].value;
      return { status: 200, data: { id: 8, text: lifecycleDescription } };
    }
    if (url.pathname.endsWith('/company/companies/42')) return { status: 200, data: { id: 42, status: { id: 2 } } };
    if (url.pathname.endsWith('/company/companies/statuses')) return { status: 200, data: [{ id: 2, disallowSavingFlag: false }] };
    throw new Error(`Unexpected lifecycle request ${options.method} ${url.pathname}`);
  };
  const lifecycleDispatcher = { invoke: (request) => dispatcher.invoke({ ...request, connection: lifecycleConnection, transport: lifecycleTransport }) };
  const orchestrator = createLifecycleWriteOrchestrator({ providerDispatcher: lifecycleDispatcher, providerId: 'connectwise-psa', connection: lifecycleConnection, transport: lifecycleTransport, correlationStore, now: () => 1 });
  const lifecycleCandidate = {
    ticketModel: 'endpoint', identity: { orgLinkId: '1', endpointId: 'ep-1', signalType: 'OFFLINE', key: '1|ep-1|OFFLINE' },
    routing: { action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: '42' },
    signal: { type: 'OFFLINE', reason: 'offline threshold met' }, endpoint: { id: 'ep-1', name: 'Host One' }
  };
  await assert.rejects(orchestrator.processCandidate({ candidate: lifecycleCandidate, lifecycle: { existingOpenTicketBehavior: 'update_existing_open' } }));
  assert.strictEqual(correlationWrites, 0, 'partial update failure does not persist new comparison state');
  assert.strictEqual(savedCorrelation.comparisonValue, 'old-comparison');
  await orchestrator.processCandidate({ candidate: lifecycleCandidate, lifecycle: { existingOpenTicketBehavior: 'update_existing_open' } });
  assert.strictEqual(correlationWrites, 1, 'comparison state advances after subsequent successful reconciliation');
  assert.notStrictEqual(savedCorrelation.comparisonValue, 'old-comparison');

  let appendSummary = 'Previous summary';
  let appendPostCount = 0;
  let failAppendOnce = true;
  let appendEndpoint = { orgLinkId: '1', endpointId: 'ep-1', signalType: 'OFFLINE', externalTicketRef: { id: '123' }, comparisonValue: 'old-endpoint', comparisonVersion: 'old-version' };
  let appendGrouped = { orgLinkId: '1', signalType: 'AUTOMATION_FAILED', issueKey: 'run-1', externalTicketRef: { id: '124' }, comparisonValue: 'old-grouped', comparisonVersion: 'old-version' };
  let endpointWrites = 0;
  let groupedWrites = 0;
  const appendStore = {
    providerId: 'connectwise-psa',
    async getEndpointCorrelation() { return { ...appendEndpoint }; },
    async getGroupedCorrelation() { return { ...appendGrouped }; },
    async upsertEndpointCorrelation(value) { appendEndpoint = { ...appendEndpoint, ...value }; endpointWrites += 1; },
    async upsertGroupedCorrelation(value) { appendGrouped = { ...appendGrouped, ...value }; groupedWrites += 1; },
    async listCorrelationsByOrgLink() { return []; }
  };
  const appendLifecycleCalls = [];
  const appendLifecycleTransport = async (options) => {
    appendLifecycleCalls.push(options);
    const url = new URL(options.url);
    const id = url.pathname.match(/\/service\/tickets\/(\d+)/)?.[1];
    if (id && /\/service\/tickets\/\d+$/.test(url.pathname)) {
      if (options.method === 'PATCH') { appendSummary = options.data[0].value; return { status: 200, data: { id: Number(id), summary: appendSummary } }; }
      return { status: 200, data: ticket({ id: Number(id), summary: appendSummary }) };
    }
    if (url.pathname.endsWith('/service/tickets/123/notes') && options.method === 'POST') {
      appendPostCount += 1;
      if (failAppendOnce) { failAppendOnce = false; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }
      return { status: 201, data: { id: 88, text: options.data.text, internalAnalysisFlag: true } };
    }
    if (url.pathname.endsWith('/service/tickets/124/notes') && options.method === 'POST') {
      appendPostCount += 1;
      return { status: 201, data: { id: 89, text: options.data.text, internalAnalysisFlag: true } };
    }
    if (url.pathname.endsWith('/company/companies/42')) return { status: 200, data: { id: 42, status: { id: 2 } } };
    if (url.pathname.endsWith('/company/companies/statuses')) return { status: 200, data: [{ id: 2, disallowSavingFlag: false }] };
    throw new Error(`Unexpected Append lifecycle request ${options.method} ${url.pathname}`);
  };
  const lifecycleAppendConnection = { ...lifecycleConnection, TicketingProvider_connectwise_psa_TicketContentUpdateMode: 'append-new-note' };
  const appendDispatcher = { invoke: (request) => dispatcher.invoke({ ...request, connection: lifecycleAppendConnection, transport: appendLifecycleTransport }) };
  const appendOrchestrator = createLifecycleWriteOrchestrator({ providerDispatcher: appendDispatcher, providerId: 'connectwise-psa', connection: lifecycleAppendConnection, transport: appendLifecycleTransport, correlationStore: appendStore, now: () => 2 });
  await assert.rejects(appendOrchestrator.processCandidate({ candidate: lifecycleCandidate, lifecycle: { existingOpenTicketBehavior: 'update_existing_open' } }));
  assert.strictEqual(endpointWrites, 0, 'failed Append does not advance endpoint comparison/correlation');
  assert.strictEqual(appendEndpoint.comparisonValue, 'old-endpoint');
  await appendOrchestrator.processCandidate({ candidate: lifecycleCandidate, lifecycle: { existingOpenTicketBehavior: 'update_existing_open' } });
  assert.strictEqual(endpointWrites, 1, 'later Sync may repeat Append and advance comparison after success');
  assert.strictEqual(appendPostCount, 2, 'ambiguous POST may be duplicated on a later Sync by approved MVP behavior');
  const groupedAppendCandidate = {
    ticketModel: 'grouped', identity: { orgLinkId: '1', signalType: 'AUTOMATION_FAILED', identityKey: '1|AUTOMATION_FAILED|run-1' }, issueKey: 'run-1',
    routing: lifecycleCandidate.routing, signal: { type: 'AUTOMATION_FAILED', reason: 'failed execution' },
    grouped: { issueKey: 'run-1', issueMetadata: { automationInstanceId: 'run-1', automationName: 'Job' }, impactedEndpointCount: 1, impactedEndpoints: [{ endpointId: 'ep-1', endpointName: 'Host One' }] }
  };
  await appendOrchestrator.processCandidate({ candidate: groupedAppendCandidate, lifecycle: { existingOpenTicketBehavior: 'update_existing_open' } });
  assert.strictEqual(groupedWrites, 1, 'grouped AUTOMATION_FAILED appends through the same Lifecycle path');
  assert.strictEqual(appendPostCount, 3);
  assert.strictEqual(appendLifecycleCalls.filter((call) => call.method === 'GET' && new URL(call.url).pathname.endsWith('/notes')).length, 0, 'ordinary Append never reads Notes');

  const noPaginationProof = transportFor({ pages: [[note()]] });
  assert.deepStrictEqual(await adapter.updateTicket({ input: input(), connection, transport: noPaginationProof.transport }), { ok: true }, 'no Link next page establishes completion under the ConnectWise list contract');
  console.log('ConnectWise update contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
