const assert = require('assert');
const { PROVIDER_ADAPTER_OPERATIONS } = require('../providerAdapterContract');
const { createConnectWiseAdapter } = require('../providers/connectwisePsaAdapter');
const { createProviderDispatcher, PROVIDER_REGISTRY, resolveProvider } = require('../providerRegistry');

function createConnection() {
  return {
    TicketingProvider_connectwise_psa_ApiRegion: 'NA',
    TicketingProvider_connectwise_psa_CompanyId: 'tenant',
    TicketingProvider_connectwise_psa_PublicApiKey: 'public',
    TicketingProvider_connectwise_psa_PrivateApiKey: 'private'
  };
}

async function run() {
  const calls = [];
  const adapter = createConnectWiseAdapter({ clientId: 'synthetic-action1-client-id' });
  assert.deepStrictEqual(Object.keys(adapter).sort(), [...PROVIDER_ADAPTER_OPERATIONS].sort());
  const productionProvider = resolveProvider('connectwise-psa');
  assert.strictEqual(productionProvider.ok, true, 'the static production registry exposes the real adapter');
  assert.strictEqual(PROVIDER_REGISTRY['connectwise-psa'].contractMajor, 1);
  assert.strictEqual(typeof PROVIDER_REGISTRY['connectwise-psa'].adapter.validateConfiguration, 'function');
  const productionDispatcher = createProviderDispatcher({
    'connectwise-psa': { providerId: 'connectwise-psa', label: 'ConnectWise PSA', contractMajor: 1, adapter }
  });
  const dispatched = await productionDispatcher.invoke({
    providerId: 'connectwise-psa', operation: 'validateConfiguration',
    input: { mode: 'test-connection', settings: createConnection() }
  });
  assert.strictEqual(dispatched.ok, true);
  const probeTransport = async (options) => {
    calls.push(options);
    if (options.url.endsWith('/system/info')) return { statusCode: 200, data: { version: 'synthetic' } };
    return { status: 200, data: [] };
  };
  const config = await adapter.validateConfiguration({ input: { mode: 'test-connection', settings: createConnection() } });
  assert.deepStrictEqual(config, { ok: true, errors: [] });
  const tested = await adapter.testConnection({ input: { settings: createConnection() }, transport: probeTransport });
  assert.strictEqual(tested.ok, true);
  assert.strictEqual(calls.length, 3);
  assert(calls[0].url.endsWith('/system/info'));
  assert(calls[1].url.endsWith('/service/boards?pageSize=1'));
  assert(calls[2].url.endsWith('/company/companies?pageSize=1'));
  assert(calls.every((call) => call.method === 'GET'));
  assert(calls.every((call) => !call.url.includes('/tickets')));

  const incomplete = await adapter.validateConfiguration({ input: { mode: 'full-provider', settings: createConnection() } });
  assert.strictEqual(incomplete.ok, false, 'routing is not implemented in Slice 7.1');
  const discovered = await adapter.discover({ input: { kind: 'service-boards' }, connection: createConnection(), transport: probeTransport });
  assert(Array.isArray(discovered.options));

  const cwConnection = {
    ...createConnection(),
    TicketingProvider_connectwise_psa_ServiceBoardId: '1',
    TicketingProvider_connectwise_psa_InitialStatusId: '2',
    TicketingProvider_connectwise_psa_TicketTypeId: '3'
  };
  const prepared = await adapter.prepareTicket({
    input: {
      candidate: { identity: { signalType: 'AUTOMATION_FAILED' } },
      content: { summary: 'Automation failed', details: 'Generated description' },
      route: { destinationId: '42' }
    }, connection: cwConnection
  });
  assert.strictEqual(prepared.payload.summary, 'Automation failed');
  assert.strictEqual(prepared.payload.initialDescription, 'Generated description');
  assert.strictEqual(prepared.payload.externalXRef, 'Action1:AUTOMATION_FAILED');
  assert.strictEqual(prepared.payload.company.id, 42);
  assert.strictEqual(prepared.payload.board.id, 1);
  assert(prepared.comparisonValue && prepared.comparisonVersion);
  assert.strictEqual(Object.hasOwn(prepared.payload, 'priority'), false, 'unset optional routing values are omitted');
  const configuredOptional = await adapter.prepareTicket({ input: { candidate: { signal: { type: 'UPDATE' } }, content: { summary: 'Update', details: 'Details' }, effectiveRoute: { destinationId: '42' } }, connection: {
    ...cwConnection,
    TicketingProvider_connectwise_psa_TicketSubtypeId: '7', TicketingProvider_connectwise_psa_TicketItemId: '8',
    TicketingProvider_connectwise_psa_PriorityId: '9', TicketingProvider_connectwise_psa_SourceId: '10'
  } });
  assert.deepStrictEqual({ subType: configuredOptional.payload.subType, item: configuredOptional.payload.item, priority: configuredOptional.payload.priority, source: configuredOptional.payload.source }, {
    subType: { id: 7 }, item: { id: 8 }, priority: { id: 9 }, source: { id: 10 }
  }, 'configured optional ConnectWise references are mapped explicitly');
  for (const [signalType, marker] of Object.entries({ VULNERABILITY: 'Action1:VULNERABILITY', UPDATE: 'Action1:UPDATE', OFFLINE: 'Action1:OFFLINE', REBOOT_REQUIRED: 'Action1:REBOOT_REQUIRED', AUTOMATION_FAILED: 'Action1:AUTOMATION_FAILED' })) {
    const markerPrepared = await adapter.prepareTicket({ input: { candidate: { signal: { type: signalType } }, content: { summary: 'Issue', details: 'Description' }, effectiveRoute: { haloClientId: '42' } }, connection: cwConnection });
    assert.strictEqual(markerPrepared.payload.externalXRef, marker, `${signalType} uses its approved external XRef marker`);
  }
  const longPrepared = await adapter.prepareTicket({ input: { candidate: { signal: { type: 'UPDATE' } }, content: { summary: `${'A'.repeat(99)}😀tail`, details: 'Description' }, effectiveRoute: { destinationId: '42' } }, connection: cwConnection });
  assert.strictEqual([...longPrepared.payload.summary].length, 100, 'summary truncation uses Unicode code points');
  assert.strictEqual(longPrepared.payload.summary.endsWith('😀'), true, 'summary truncation does not split a surrogate pair');
  const createCalls = [];
  const createTransport = async (options) => {
    createCalls.push(options);
    if (options.url.includes('/company/companies/statuses')) return { status: 200, data: [{ id: 5, disallowSavingFlag: false }] };
    if (options.url.includes('/company/companies/42')) return { status: 200, data: { id: 42, name: 'Synthetic Company', status: { id: 5 } } };
    if (options.method === 'POST' && options.url.endsWith('/service/tickets')) return { status: 201, data: { id: 987, summary: 'Automation failed' } };
    throw new Error(`Unexpected request ${options.method} ${options.url}`);
  };
  const created = await adapter.createTicket({ input: { preparedTicket: prepared.payload }, connection: cwConnection, transport: createTransport });
  assert.deepStrictEqual(created.externalTicketRef, { id: '987', displayId: '987' });
  assert.strictEqual(createCalls.filter((call) => call.method === 'POST').length, 1);
  const createRequest = createCalls.find((call) => call.method === 'POST');
  assert.strictEqual(createRequest.data.processNotifications, undefined, 'provider does not manage or suppress notifications');
  let deniedPostCount = 0;
  const ineligible = await adapter.createTicket({ input: { preparedTicket: prepared.payload }, connection: cwConnection, transport: async (options) => {
    if (options.url.includes('/company/companies/statuses')) return { status: 200, data: [{ id: 5, disallowSavingFlag: true }] };
    if (options.url.endsWith('/company/companies/42')) return { status: 200, data: { id: 42, name: 'Blocked', status: { id: 5 } } };
    if (options.method === 'POST') deniedPostCount += 1;
    throw new Error('unexpected request');
  } }).then(() => null, (error) => error);
  assert.strictEqual(ineligible.code, 'CONNECTWISE_COMPANY_INELIGIBLE', 'ineligible destination company blocks ticket creation');
  assert.strictEqual(deniedPostCount, 0, 'ineligible company never reaches destination ticket POST');

  const readTransport = async (options) => {
    if (options.url.includes('/service/tickets/987')) return { status: 200, data: { id: 987, recordType: 'ServiceTicket', company: { id: 42 }, closedFlag: false, status: { id: 6 } } };
    throw new Error(`Unexpected request ${options.method} ${options.url}`);
  };
  const read = await adapter.getTicket({ input: { externalTicketRef: { id: '987' }, expectedRoute: { destinationId: '42' } }, connection: cwConnection, transport: readTransport });
  assert.strictEqual(read.state, 'found');
  assert.strictEqual(read.openState, 'open');
  const ownershipError = await adapter.getTicket({ input: { externalTicketRef: { id: '987' }, expectedRoute: { destinationId: '99' } }, connection: cwConnection, transport: readTransport }).then(() => null, (error) => error);
  assert.strictEqual(ownershipError.code, 'CONNECTWISE_TICKET_OWNERSHIP_MISMATCH', 'ticket owned by another mapped company is rejected');
  const closed = await adapter.getTicket({ input: { externalTicketRef: { id: '987' }, expectedRoute: { destinationId: '42' } }, connection: { ...cwConnection, TicketingProvider_connectwise_psa_AdditionalClosedStatusIds: '6' }, transport: readTransport });
  assert.strictEqual(closed.openState, 'closed', 'configured additional resolved status classifies a technically open ticket as closed for lifecycle');
  const nativeClosed = await adapter.getTicket({ input: { externalTicketRef: { id: '987' }, expectedRoute: { destinationId: '42' } }, connection: cwConnection, transport: async (options) => ({ status: 200, data: { id: 987, recordType: 'ServiceTicket', company: { id: 42 }, closedFlag: true, status: { id: 16 } } }) });
  assert.strictEqual(nativeClosed.openState, 'closed', 'native closedFlag classifies a closed ticket without requiring it in the additional list');
  const missingTransport = async (options) => {
    if (options.url.includes('/service/tickets/987')) return { status: 404, data: 'Not found' };
    if (options.url.endsWith('/system/info')) return { status: 200, data: { version: 'synthetic' } };
    throw new Error(`Unexpected request ${options.method} ${options.url}`);
  };
  const missing = await adapter.getTicket({ input: { externalTicketRef: { id: '987' }, expectedRoute: { destinationId: '42' } }, connection: cwConnection, transport: missingTransport });
  assert.deepStrictEqual(missing, { state: 'missing', confirmed: true }, 'ticket 404 is missing only after same-credential probe succeeds');
  const uncertain404 = await adapter.getTicket({ input: { externalTicketRef: { id: '987' }, expectedRoute: { destinationId: '42' } }, connection: cwConnection, transport: async (options) => options.url.includes('/service/tickets/') ? { status: 404, data: '' } : { status: 403, data: 'denied' } }).then(() => null, (error) => error);
  assert.strictEqual(uncertain404.code, 'CONNECTWISE_TICKET_STATE_UNKNOWN', 'failed verification after ticket 404 stays unknown');
  const ambiguousCalls = [];
  const ambiguousCreate = await adapter.createTicket({ input: { preparedTicket: prepared.payload }, connection: cwConnection, transport: async (options) => {
    ambiguousCalls.push(options);
    if (options.url.includes('/company/companies/statuses')) return { status: 200, data: [{ id: 5, disallowSavingFlag: false }] };
    if (options.url.endsWith('/company/companies/42')) return { status: 200, data: { id: 42, status: { id: 5 } } };
    throw Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' });
  } }).then(() => null, (error) => error);
  assert.strictEqual(ambiguousCreate.ambiguous, true, 'uncertain POST failure is marked ambiguous');
  assert.strictEqual(ambiguousCalls.filter((call) => call.method === 'POST').length, 1, 'ambiguous ticket create is never retried');

  for (const [response, expectedCode] of [
    [{ status: 400, data: 'Invalid Token' }, 'CONNECTWISE_AUTHENTICATION_FAILED'],
    [{ status: 403, data: { message: 'denied' } }, 'CONNECTWISE_PERMISSION_DENIED'],
    [{ status: 200, data: [] }, 'CONNECTWISE_INVALID_PROBE_RESPONSE']
  ]) {
    let index = 0;
    const failing = async () => { index += 1; return response; };
    const result = await adapter.testConnection({ input: { settings: createConnection() }, transport: failing });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, expectedCode);
    assert(index <= 1, 'Test Connection stops at the first failed probe');
    assert(!JSON.stringify(result).includes('private'));
  }

  console.log('ConnectWise adapter contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
