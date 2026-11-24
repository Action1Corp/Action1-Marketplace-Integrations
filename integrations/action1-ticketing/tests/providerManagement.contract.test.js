const assert = require('assert');
const { PROVIDER_ADAPTER_CONTRACT_MAJOR, PROVIDER_ADAPTER_OPERATIONS } = require('../providerAdapterContract');
const { PROVIDER_REGISTRY } = require('../providerRegistry');
const { validate } = require('../validate');
const { activateProvider } = require('../activateProvider');
const { saveProviderSettings } = require('../providerSettings');
const { actions } = require('../actions');

function makeAdapter(onCall = () => {}) {
  return Object.fromEntries(PROVIDER_ADAPTER_OPERATIONS.map((operation) => [operation, async (request) => {
    onCall(operation, request);
    if (operation === 'validateConfiguration') return { ok: true, errors: [] };
    if (operation === 'testConnection') return { ok: true, message: 'Synthetic connection succeeded.' };
    if (operation === 'discover') return { options: [] };
    if (operation === 'prepareTicket') return { payload: {}, comparisonValue: 'v', comparisonVersion: '1' };
    if (operation === 'getTicket') return { state: 'missing', confirmed: true };
    if (operation === 'createTicket') return { externalTicketRef: { id: 'ticket-a' } };
    return { ok: true };
  }]));
}

function context(seed = {}) {
  const values = { ...seed };
  const writes = [];
  return {
    values, writes,
    settings: {
      async get(key) { return values[key] || ''; },
      async all(keys) { return Object.fromEntries(keys.map((key) => [key, values[key] || ''])); },
      async set(key, value) { writes.push([key, value]); values[key] = value; }
    }
  };
}

async function run() {
  const definitions = {
    alpha: { label: 'Alpha', available: true, accountSelectors: ['Tenant'], fields: [
      { key: 'Tenant', required: true }, { key: 'ClientSecret', required: true, type: 'secret' }, { key: 'Route' }
    ] },
    beta: { label: 'Beta', available: true, accountSelectors: [], fields: [{ key: 'Tenant', required: true }] }
  };
  assert.strictEqual(typeof PROVIDER_REGISTRY['connectwise-psa'].adapter.validateConfiguration, 'function', 'production ConnectWise descriptor is registered');
  assert(!Object.prototype.hasOwnProperty.call(PROVIDER_REGISTRY, 'alpha'), 'synthetic providers are not registered in production');
  const registry = Object.fromEntries(Object.entries(definitions).map(([providerId, definition]) => [providerId, {
    providerId, label: definition.label, contractMajor: PROVIDER_ADAPTER_CONTRACT_MAJOR, adapter: makeAdapter()
  }]));

  let contextA = context({ TicketingProvider_alpha_ClientSecret: 'saved-secret' });
  const testCalls = [];
  const dispatcher = { async invoke(request) {
    testCalls.push(request);
    if (request.operation === 'validateConfiguration') return { ok: true, errors: [] };
    if (request.operation === 'testConnection') return { ok: true, message: 'Connected.' };
    throw new Error(`Unexpected operation ${request.operation}`);
  } };
  const tested = await validate(contextA, { providerId: 'alpha', settings: {
    TicketingProvider_alpha_Tenant: 'tenant-a',
    TicketingProvider_alpha_ClientSecret: '***',
    _secretModes: { TicketingProvider_alpha_ClientSecret: 'stored' }
  } }, { dispatcher, definitions });
  assert.strictEqual(tested.ok, true);
  assert.deepStrictEqual(testCalls.map((call) => call.operation), ['validateConfiguration', 'testConnection']);
  assert.strictEqual(testCalls[1].input.settings.TicketingProvider_alpha_ClientSecret, 'saved-secret');
  assert.strictEqual(contextA.writes.length, 0, 'Test Connection must not save settings');

  const fakeContext = context({ TicketingActiveProvider: 'alpha', TicketingProvider_beta_Tenant: 'tenant-b' });
  const activated = await activateProvider(fakeContext, { providerId: 'beta', expectedCurrentProvider: 'alpha' }, { registry, definitions, dispatcher: { async invoke() { return { ok: true, errors: [] }; } } });
  assert.strictEqual(activated.ok, true);
  assert.deepStrictEqual(fakeContext.writes, [['TicketingActiveProvider', 'beta']]);
  fakeContext.values.TicketingOfflineEnabled = 'false';
  const returned = await activateProvider(fakeContext, { providerId: 'alpha', expectedCurrentProvider: 'beta' }, { registry, definitions, dispatcher: { async invoke() { return { ok: true, errors: [] }; } } });
  assert.strictEqual(returned.ok, true, 'A to B to A activation should restore the prior provider selection');
  assert.strictEqual(fakeContext.values.TicketingOfflineEnabled, 'false', 'shared rules remain unchanged across provider switches');
  assert.deepStrictEqual(fakeContext.writes.map(([key]) => key), ['TicketingActiveProvider', 'TicketingActiveProvider']);
  const stale = await activateProvider(fakeContext, { providerId: 'beta', expectedCurrentProvider: 'beta' }, { registry, definitions, dispatcher });
  assert.strictEqual(stale.ok, false, 'stale activation must fail');
  assert.deepStrictEqual(fakeContext.writes, [['TicketingActiveProvider', 'beta'], ['TicketingActiveProvider', 'alpha']]);

  const brokenSettings = { settings: { async get() { throw new Error('raw-secret-from-host-settings'); }, async set() { throw new Error('must not write'); } } };
  const failedRead = await activateProvider(brokenSettings, { providerId: 'beta', expectedCurrentProvider: 'alpha' }, { registry, definitions, dispatcher });
  assert.strictEqual(failedRead.ok, false, 'activation must safely handle host settings read failures');
  assert(!failedRead.message.includes('raw-secret'), 'activation errors must not echo host exception details');

  const noWrites = context({ TicketingProvider_alpha_Tenant: 'tenant-a' });
  const denied = await saveProviderSettings(noWrites, { providerId: 'alpha', settings: {
    TicketingProvider_alpha_Tenant: 'tenant-b', TicketingOfflineEnabled: 'false'
  } }, { definitions });
  assert.strictEqual(denied.ok, false, 'explicit account selector change must be rejected');
  assert.strictEqual(noWrites.writes.length, 0, 'selector rejection occurs before all writes');

  const retainedSecret = context({ TicketingProvider_alpha_ClientSecret: 'prior-secret', TicketingProvider_alpha_Tenant: 'tenant-a' });
  const retained = await saveProviderSettings(retainedSecret, { providerId: 'alpha', settings: {
    TicketingProvider_alpha_Tenant: 'tenant-a', TicketingProvider_alpha_ClientSecret: '***',
    _secretModes: { TicketingProvider_alpha_ClientSecret: 'stored' }
  } }, { definitions });
  assert.strictEqual(retained.ok, true);
  assert.strictEqual(retainedSecret.values.TicketingProvider_alpha_ClientSecret, 'prior-secret');
  assert(!retainedSecret.writes.some(([key]) => key.endsWith('ClientSecret')), 'masked secret omission preserves saved secret');

  const saved = await saveProviderSettings(noWrites, { providerId: 'alpha', settings: {
    TicketingProvider_alpha_Tenant: 'tenant-a', TicketingProvider_alpha_ClientSecret: 'new-secret', TicketingOfflineEnabled: 'false'
  } }, { definitions });
  assert.strictEqual(saved.ok, true, 'credential replacement with same selector is allowed');
  assert.deepStrictEqual(noWrites.writes.map(([key]) => key).sort(), [
    'TicketingOfflineEnabled', 'TicketingProvider_alpha_ClientSecret', 'TicketingProvider_alpha_Tenant'
  ]);
  assert(!JSON.stringify(saved).includes('new-secret'));

  const unavailable = await validate(contextA, { providerId: 'connectwise-psa', settings: {} });
  assert.strictEqual(unavailable.ok, false, 'missing provider settings fail local validation safely');
  const unavailableContext = context({ TicketingActiveProvider: 'alpha' });
  const defaultUnavailableActivation = await activateProvider(unavailableContext, { providerId: 'connectwise-psa', expectedCurrentProvider: 'alpha' });
  assert.strictEqual(defaultUnavailableActivation.ok, false, 'activation requires saved connection settings and a successful test');
  const productionActivation = await actions['activate-provider'](unavailableContext, { providerId: 'connectwise-psa', expectedCurrentProvider: 'alpha' });
  assert.strictEqual(productionActivation.ok, false);
  assert.deepStrictEqual(unavailableContext.writes, [], 'exported production action does not activate an unconfigured provider');
  const productionSaveContext = context({});
  const commonSave = await actions['save-provider-settings'](productionSaveContext, {
    providerId: 'connectwise-psa', settings: { TicketingOfflineEnabled: 'false' }
  });
  assert.strictEqual(commonSave.ok, true, 'exported settings handler accepts owned common settings');
  assert.deepStrictEqual(productionSaveContext.writes, [['TicketingOfflineEnabled', 'false']]);
}

run().catch((error) => { console.error(error); process.exit(1); });
