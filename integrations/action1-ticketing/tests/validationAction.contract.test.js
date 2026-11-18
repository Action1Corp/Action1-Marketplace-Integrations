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

  let fetchCalls = 0;
  const oldFetch = global.fetch;
  global.fetch = async () => { fetchCalls += 1; throw new Error('production unavailable provider must not make requests'); };
  try {
    const unavailable = await actions['validate-configuration'](context, { providerId: 'connectwise-psa', settings: {} });
    assert.strictEqual(unavailable.ok, false);
    assert(unavailable.message.includes('not available'));
    assert.strictEqual(fetchCalls, 0);
  } finally { global.fetch = oldFetch; }
}

run().catch((error) => { console.error(error); process.exit(1); });
