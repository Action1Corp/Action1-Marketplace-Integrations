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
  const neverCalled = async () => { throw new Error('must not issue destination requests'); };
  for (const operation of ['discover', 'prepareTicket', 'getTicket', 'createTicket', 'updateTicket']) {
    await assert.rejects(() => adapter[operation]({ input: {}, transport: neverCalled }), (error) => error.code === 'CONNECTWISE_OPERATION_NOT_IMPLEMENTED');
    await assert.rejects(() => productionDispatcher.invoke({ providerId: 'connectwise-psa', operation, input: {}, transport: neverCalled }), (error) => error.code === 'CONNECTWISE_OPERATION_NOT_IMPLEMENTED');
  }

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
