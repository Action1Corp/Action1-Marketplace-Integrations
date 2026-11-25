const assert = require('assert');
const { actions } = require('../actions');
const { validate } = require('../validate');
const { PROVIDER_ADAPTER_OPERATIONS, PROVIDER_ADAPTER_CONTRACT_MAJOR } = require('../providerAdapterContract');

function makeAdapter() {
  return Object.fromEntries(PROVIDER_ADAPTER_OPERATIONS.map((operation) => [operation, async () => {
    if (operation === 'validateConfiguration') return { ok: true, errors: [] };
    if (operation === 'testConnection') return { ok: true, message: 'Synthetic connection succeeded.' };
    if (operation === 'discover') return { options: [] };
    if (operation === 'prepareTicket') return { payload: {}, comparisonValue: 'v', comparisonVersion: '1' };
    if (operation === 'getTicket') return { state: 'missing', confirmed: true };
    if (operation === 'createTicket') return { externalTicketRef: { id: 'synthetic' } };
    return { ok: true };
  }]));
}

async function run() {
  const saved = { TicketingProvider_alpha_ClientSecret: 'stored-secret' };
  const writes = [];
  const context = { settings: { async get(key) { return saved[key] || ''; }, async set(...args) { writes.push(args); } } };
  const calls = [];
  const adapter = makeAdapter();
  const registry = { alpha: { providerId: 'alpha', label: 'Alpha', contractMajor: PROVIDER_ADAPTER_CONTRACT_MAJOR, adapter } };
  const dispatcher = { async invoke(request) { calls.push(request); return adapter[request.operation](request); } };
  const definitions = { alpha: { label: 'Alpha', available: true, fields: [{ key: 'ClientSecret', type: 'secret', required: true }] } };

  const result = await validate(context, { providerId: 'alpha', settings: {
    TicketingProvider_alpha_ClientSecret: '***',
    _secretModes: { TicketingProvider_alpha_ClientSecret: 'stored' }
  } }, { dispatcher, registry, definitions });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(calls.map((call) => call.operation), ['validateConfiguration', 'testConnection']);
  assert.strictEqual(calls[1].input.settings.TicketingProvider_alpha_ClientSecret, 'stored-secret');
  assert.strictEqual(writes.length, 0, 'Test Connection is read-only');

  let httpCalls = 0;
  const productionContext = { ...context, http: async () => { httpCalls += 1; throw new Error('incomplete settings must fail before transport'); } };
  const incomplete = await actions['validate-configuration'](productionContext, { providerId: 'connectwise-psa', settings: {} });
  assert.strictEqual(incomplete.ok, false);
  assert(incomplete.message.includes('required'));
  assert.strictEqual(httpCalls, 0, 'incomplete connection settings fail before read-only probes');

  const connectWiseHttpCalls = [];
  const connectWiseContext = {
    settings: { async get() { return ''; }, async set() { throw new Error('Test Connection must not save settings'); } },
    http: async (request) => {
      connectWiseHttpCalls.push(request);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/system/info')) return { status: 200, data: { version: 'synthetic' } };
      if (path.endsWith('/service/boards') || path.endsWith('/company/companies')) return { status: 200, data: [] };
      throw new Error(`Unexpected synthetic request ${request.method} ${path}`);
    }
  };
  const uiActionBody = {
    settings: {
      TicketingProvider_connectwise_psa_ApiRegion: 'NA',
      TicketingProvider_connectwise_psa_CompanyId: 'synthetic-company',
      TicketingProvider_connectwise_psa_PublicApiKey: 'synthetic-public-key',
      TicketingProvider_connectwise_psa_PrivateApiKey: 'synthetic-private-key'
    },
    payload: { providerId: 'connectwise-psa' }
  };
  // Mirrors backend/server.js: the host forwards only body.settings and body.payload.
  const connectWiseResult = await actions['validate-configuration'](connectWiseContext, {
    settings: uiActionBody.settings,
    payload: uiActionBody.payload || {}
  });
  assert.strictEqual(connectWiseResult.ok, true, 'Marketplace handler request reaches ConnectWise Test Connection using its actual settings/payload envelope');
  assert.deepStrictEqual(connectWiseHttpCalls.map((request) => new URL(request.url).pathname.slice(new URL(request.url).pathname.indexOf('/apis/3.0') + 9)), ['/system/info', '/service/boards', '/company/companies']);
}

run().catch((error) => { console.error(error); process.exit(1); });
