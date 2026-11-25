const assert = require('assert');
const { PROVIDER_ADAPTER_OPERATIONS, PROVIDER_ADAPTER_CONTRACT_MAJOR, validateProviderAdapter, validateProviderOperationResult, normalizeExternalTicketReference, normalizeProviderError } = require('../providerAdapterContract');
const { createProviderDispatcher, resolveProvider, INITIAL_PROVIDER_ID, PROVIDER_REGISTRY } = require('../providerRegistry');

function fakeAdapter(onCall = () => {}, results = {}) {
  return Object.fromEntries(PROVIDER_ADAPTER_OPERATIONS.map((operation) => [operation, async (args) => { onCall(operation, args); return results[operation] || { ok: true }; }]));
}

async function run() {
  assert.strictEqual(PROVIDER_ADAPTER_CONTRACT_MAJOR, 1);
  assert.deepStrictEqual(PROVIDER_ADAPTER_OPERATIONS, ['validateConfiguration', 'testConnection', 'discover', 'prepareTicket', 'getTicket', 'createTicket', 'updateTicket']);

  const discoveryPage = validateProviderOperationResult('discover', {
    options: [{ id: 'customer-1', label: 'Acme' }], hasMore: true, nextPageToken: 'cursor-2',
    complete: false, searchSupported: true, paginationSupported: true
  }, { kind: 'mapping-destinations', continuationToken: null });
  assert.deepStrictEqual(discoveryPage, {
    options: [{ id: 'customer-1', label: 'Acme' }], hasMore: true, nextPageToken: 'cursor-2',
    complete: false, searchSupported: true, paginationSupported: true
  }, 'mapping discovery pages expose explicit continuation and capability semantics');
  assert.throws(() => validateProviderOperationResult('discover', { options: [], hasMore: false, nextPageToken: 'cursor', complete: true, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations' }), /page|continuation|discovery/i);
  assert.throws(() => validateProviderOperationResult('discover', { options: [], hasMore: true, nextPageToken: null, complete: false, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations' }), /page|continuation|discovery/i);
  assert.throws(() => validateProviderOperationResult('discover', { options: [], hasMore: false, complete: true, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations' }), /page|continuation|discovery/i);
  assert.strictEqual(validateProviderOperationResult('discover', { options: [{ id: 'x', label: 'X' }], hasMore: false, nextPageToken: null, complete: false, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations' }).complete, false, 'providers can report that they cannot prove directory completeness');
  assert.throws(() => validateProviderOperationResult('discover', { options: [], hasMore: true, nextPageToken: 'cursor', complete: false, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations', continuationToken: 'cursor' }), /repeat|continuation|discovery/i);
  assert.deepStrictEqual(validateProviderOperationResult('discover', { options: [{ id: 'one-page', label: 'One Page' }] }, { kind: 'mapping-destinations' }), {
    options: [{ id: 'one-page', label: 'One Page' }], hasMore: false, nextPageToken: null, complete: false, searchSupported: false, paginationSupported: false
  }, 'legacy single-page providers stay usable without pretending the whole directory was found');
  assert.throws(() => validateProviderOperationResult('discover', { options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations' }), /duplicate|identifier/i);
  assert.throws(() => validateProviderOperationResult('discover', { options: Array.from({ length: 501 }, (_, index) => ({ id: `dest-${index}`, label: `Destination ${index}` })), hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true }, { kind: 'mapping-destinations' }), /too many/i);

  const missing = fakeAdapter();
  delete missing.updateTicket;
  assert.throws(() => validateProviderAdapter({ providerId: 'provider-a', contractMajor: 1, adapter: missing }), (error) => error.code === 'provider_incompatible');
  assert.throws(() => validateProviderAdapter({ providerId: 'provider-a', contractMajor: 2, adapter: fakeAdapter() }), (error) => error.code === 'provider_incompatible');

  const reference = normalizeExternalTicketReference({ id: '  0007/A  ', displayId: 'CASE-7', url: 'https://tickets.example.test/t/7', metadata: { queue: 'support' } });
  assert.strictEqual(reference.id, '0007/A', 'external ID remains an opaque trimmed string');
  assert.strictEqual(reference.displayId, 'CASE-7');
  assert.throws(() => normalizeExternalTicketReference({ id: 7 }), /string|reference/i);
  assert.throws(() => normalizeExternalTicketReference({ id: 'x', url: 'javascript:alert(1)' }), /url/i);
  assert.throws(() => normalizeExternalTicketReference({ id: 'x', url: 'https://tickets.example.test/?access_token=synthetic-secret' }), /url/i);
  assert.throws(() => normalizeExternalTicketReference({ id: 'x', metadata: { accessToken: 'synthetic-secret' } }), /metadata|sensitive/i);
  assert.throws(() => normalizeExternalTicketReference({ id: 'x', metadata: { notes: 'x'.repeat(5000) } }), /metadata|limit/i);

  const safe = normalizeProviderError(Object.assign(new Error('token=synthetic-secret response body'), { code: 'HTTP_500', retryable: true, ambiguous: true }), 'createTicket');
  assert.strictEqual(safe.operation, 'createTicket');
  assert.strictEqual(safe.retryable, true);
  assert.strictEqual(safe.ambiguous, true);
  assert(!JSON.stringify(safe).includes('synthetic-secret'));

  const production = resolveProvider(INITIAL_PROVIDER_ID);
  assert.strictEqual(production.ok, true, 'ConnectWise is the first available provider');
  assert.deepStrictEqual(Object.keys(PROVIDER_REGISTRY), [INITIAL_PROVIDER_ID], 'the production registry contains only its static provider key');
  assert.strictEqual(typeof PROVIDER_REGISTRY[INITIAL_PROVIDER_ID].adapter.validateConfiguration, 'function');
  let calls = 0;
  let productionTransportCalls = 0;
  const productionDispatcher = createProviderDispatcher();
  await assert.rejects(() => productionDispatcher.invoke({ providerId: INITIAL_PROVIDER_ID, operation: 'createTicket', input: {}, transport: { async request() { productionTransportCalls += 1; } } }), (error) => error.code === 'CONNECTWISE_TICKET_PAYLOAD_INVALID');
  await assert.rejects(() => productionDispatcher.invoke({ providerId: 'provider-a', operation: 'createTicket', input: {} }), (error) => error.code === 'provider_unavailable');
  assert.strictEqual(calls, 0);
  assert.strictEqual(productionTransportCalls, 0, 'invalid production ticket writes stop before transport');

  const injected = createProviderDispatcher({
    'provider-a': {
      providerId: 'provider-a', label: 'Synthetic A', contractMajor: 1,
      adapter: fakeAdapter((operation, args) => { calls += 1; assert.deepStrictEqual(Object.keys(args).sort(), ['connection', 'input', 'logger', 'transport']); }, {
        validateConfiguration: { ok: true, errors: [] },
        testConnection: { ok: true, message: 'Connected to synthetic provider.' },
        discover: { options: [{ id: 'queue-1', label: 'Support' }], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true },
        prepareTicket: { payload: { title: 'Synthetic' }, comparisonValue: 'comparison-1', comparisonVersion: '1' },
        getTicket: { state: 'missing', confirmed: true },
        createTicket: { externalTicketRef: { id: '00007', displayId: 'SYN-7' } },
        updateTicket: { ok: true }
      })
    }
  });
  let normalizedDiscoveryInput;
  const inputValidator = createProviderDispatcher({
    'provider-a': { providerId: 'provider-a', label: 'Synthetic A', contractMajor: 1, adapter: fakeAdapter((operation, args) => { if (operation === 'discover') normalizedDiscoveryInput = args.input; }, {
      discover: { options: [], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true }
    }) }
  });
  await inputValidator.invoke({ providerId: 'provider-a', operation: 'discover', input: { kind: 'mapping-destinations', query: '  Acme   CO ', pageSize: 50, continuationToken: null, settings: {} } });
  assert.deepStrictEqual(normalizedDiscoveryInput, { kind: 'mapping-destinations', query: 'Acme CO', pageSize: 50, continuationToken: null, settings: {} });
  for (const input of [
    { kind: 'mapping-destinations', query: 'x'.repeat(201), pageSize: 50, settings: {} },
    { kind: 'mapping-destinations', query: '', pageSize: 501, settings: {} },
    { kind: 'mapping-destinations', query: '', pageSize: 50, continuationToken: 'x'.repeat(1025), settings: {} }
  ]) await assert.rejects(() => inputValidator.invoke({ providerId: 'provider-a', operation: 'discover', input }), (error) => error.code === 'provider_input_invalid');
  for (const operation of PROVIDER_ADAPTER_OPERATIONS) {
    await injected.invoke({ providerId: 'provider-a', operation, input: { challenge: 'safe' }, connection: { host: 'fixture' }, transport: {}, logger: {} });
  }
  assert.strictEqual(calls, 7, 'the isolated fixture dispatcher exercises all seven contract operations without production registration');
  assert.strictEqual(resolveProvider('provider-b', { 'provider-b': { providerId: 'provider-b', label: 'Synthetic B', contractMajor: 99, adapter: fakeAdapter() } }).error.code, 'provider_incompatible');
  await assert.rejects(() => injected.invoke({ providerId: 'provider-a', operation: 'createTicket', input: { payload: {} }, connection: {}, transport: {}, logger: {}, db: {} }), /input|boundary|unsupported/i);

  console.log('Action1 Ticketing provider adapter contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
