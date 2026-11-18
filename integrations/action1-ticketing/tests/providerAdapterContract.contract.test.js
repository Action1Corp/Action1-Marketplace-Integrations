const assert = require('assert');
const { PROVIDER_ADAPTER_OPERATIONS, PROVIDER_ADAPTER_CONTRACT_MAJOR, validateProviderAdapter, normalizeExternalTicketReference, normalizeProviderError } = require('../providerAdapterContract');
const { createProviderDispatcher, resolveProvider, INITIAL_PROVIDER_ID, PROVIDER_REGISTRY } = require('../providerRegistry');

function fakeAdapter(onCall = () => {}, results = {}) {
  return Object.fromEntries(PROVIDER_ADAPTER_OPERATIONS.map((operation) => [operation, async (args) => { onCall(operation, args); return results[operation] || { ok: true }; }]));
}

async function run() {
  assert.strictEqual(PROVIDER_ADAPTER_CONTRACT_MAJOR, 1);
  assert.deepStrictEqual(PROVIDER_ADAPTER_OPERATIONS, ['validateConfiguration', 'testConnection', 'discover', 'prepareTicket', 'getTicket', 'createTicket', 'updateTicket']);

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
  assert.strictEqual(production.ok, false, 'the initial provider remains unavailable until a real adapter is approved and implemented');
  assert.deepStrictEqual(Object.keys(PROVIDER_REGISTRY), [INITIAL_PROVIDER_ID], 'the production registry contains only its static provider key');
  assert.strictEqual(PROVIDER_REGISTRY[INITIAL_PROVIDER_ID].adapter, null, 'the production registry has no fake or Halo adapter');
  let calls = 0;
  let productionTransportCalls = 0;
  const productionDispatcher = createProviderDispatcher();
  await assert.rejects(() => productionDispatcher.invoke({ providerId: INITIAL_PROVIDER_ID, operation: 'createTicket', input: {}, transport: { async request() { productionTransportCalls += 1; } } }), (error) => error.code === 'provider_unavailable');
  await assert.rejects(() => productionDispatcher.invoke({ providerId: 'provider-a', operation: 'createTicket', input: {} }), (error) => error.code === 'provider_unavailable');
  assert.strictEqual(calls, 0);
  assert.strictEqual(productionTransportCalls, 0, 'unavailable production resolution stops before transport');

  const injected = createProviderDispatcher({
    'provider-a': {
      providerId: 'provider-a', label: 'Synthetic A', contractMajor: 1,
      adapter: fakeAdapter((operation, args) => { calls += 1; assert.deepStrictEqual(Object.keys(args).sort(), ['connection', 'input', 'logger', 'transport']); }, {
        validateConfiguration: { ok: true, errors: [] },
        testConnection: { ok: true, message: 'Connected to synthetic provider.' },
        discover: { options: [{ id: 'queue-1', label: 'Support' }] },
        prepareTicket: { payload: { title: 'Synthetic' }, comparisonValue: 'comparison-1', comparisonVersion: '1' },
        getTicket: { state: 'missing', confirmed: true },
        createTicket: { externalTicketRef: { id: '00007', displayId: 'SYN-7' } },
        updateTicket: { ok: true }
      })
    }
  });
  for (const operation of PROVIDER_ADAPTER_OPERATIONS) {
    await injected.invoke({ providerId: 'provider-a', operation, input: { challenge: 'safe' }, connection: { host: 'fixture' }, transport: {}, logger: {} });
  }
  assert.strictEqual(calls, 7, 'the isolated fixture dispatcher exercises all seven contract operations without production registration');
  assert.strictEqual(resolveProvider('provider-b', { 'provider-b': { providerId: 'provider-b', label: 'Synthetic B', contractMajor: 99, adapter: fakeAdapter() } }).error.code, 'provider_incompatible');
  await assert.rejects(() => injected.invoke({ providerId: 'provider-a', operation: 'createTicket', input: { payload: {} }, connection: {}, transport: {}, logger: {}, db: {} }), /input|boundary|unsupported/i);

  console.log('Action1 Ticketing provider adapter contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
