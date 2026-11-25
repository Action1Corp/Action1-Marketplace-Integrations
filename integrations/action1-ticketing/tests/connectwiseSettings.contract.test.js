const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');
const {
  COMMON_SETTING_KEYS,
  PROVIDER_UI_DEFINITIONS,
  buildProviderSettingKey,
  getOwnedSettingKeys,
  filterSettingsForOwner,
  saveProviderSettings
} = require('../providerSettings');
const { validate } = require('../validate');
const { activateProvider } = require('../activateProvider');
const { PROVIDER_REGISTRY } = require('../providerRegistry');

const providerId = 'connectwise-psa';
const key = (field) => buildProviderSettingKey(providerId, field);

function makeContext(values = {}, transport = async () => ({ status: 200, data: {} })) {
  const settings = { ...values };
  const writes = [];
  return {
    values: settings,
    writes,
    http: transport,
    settings: {
      async get(name) { return settings[name] || ''; },
      async all(names) { return Object.fromEntries(names.map((name) => [name, settings[name] || ''])); },
      async set(name, value) { writes.push([name, value]); settings[name] = value; }
    }
  };
}

function validSettings() {
  return {
    [key('ApiRegion')]: 'NA',
    [key('CompanyId')]: 'tenant-a',
    [key('PublicApiKey')]: 'synthetic-public-key',
    [key('PrivateApiKey')]: 'synthetic-private-key'
  };
}

function probeTransport(responses = []) {
  const calls = [];
  const transport = async (options) => {
    calls.push(options);
    const response = responses.length ? responses.shift() : null;
    if (response instanceof Error) throw response;
    if (response) return response;
    if (options.url.endsWith('/system/info')) return { status: 200, data: { version: 'synthetic' } };
    return { status: 200, data: [] };
  };
  return { transport, calls };
}

async function run() {
  const definition = PROVIDER_UI_DEFINITIONS[providerId];
  assert.strictEqual(definition.available, true);
  assert.deepStrictEqual(getOwnedSettingKeys(providerId).sort(), [
    key('ApiRegion'), key('CustomServer'), key('CompanyId'), key('PublicApiKey'), key('PrivateApiKey'),
    key('ServiceBoardId'), key('InitialStatusId'), key('TicketTypeId'), key('TicketSubtypeId'), key('TicketItemId'),
    key('PriorityId'), key('SourceId'), key('AdditionalClosedStatusIds')
  ].sort());
  assert.strictEqual(definition.fields.find((field) => field.key === 'PrivateApiKey').type, 'secret');
  assert(!definition.fields.some((field) => /client.?id/i.test(field.key)));
  assert(!definition.accountSelectors.includes('ApiRegion'));
  assert(COMMON_SETTING_KEYS.every((settingKey) => !settingKey.startsWith('TicketingProvider_')));
  const secretSchema = settingsSchema.find((field) => field.key === key('PrivateApiKey'));
  assert.strictEqual(secretSchema?.type, 'secret', 'Marketplace settings schema owns encryption and masking metadata');
  assert.strictEqual(secretSchema?.visible, false, 'provider fields are rendered only through ConnectionFields');
  assert(!filterSettingsForOwner({ ...validSettings(), [key('PrivateApiKey')]: 'secret' }, 'some-other-provider')[key('PrivateApiKey')]);

  const valid = validSettings();
  const retained = makeContext({ [key('PrivateApiKey')]: 'saved-private-key' });
  const save = await saveProviderSettings(retained, { providerId, settings: {
    ...valid,
    [key('PrivateApiKey')]: '***',
    _secretModes: { [key('PrivateApiKey')]: 'stored' }
  } });
  assert.strictEqual(save.ok, true);
  assert(!retained.writes.some(([name]) => name === key('PrivateApiKey')));
  assert(!JSON.stringify(save).includes('saved-private-key'));

  const rejected = makeContext();
  const invalidSave = await saveProviderSettings(rejected, { providerId, settings: {
    ...valid, [key('ApiRegion')]: 'CUSTOM', [key('CustomServer')]: 'http://unsafe.example.test'
  } });
  assert.strictEqual(invalidSave.ok, false);
  assert.strictEqual(rejected.writes.length, 0, 'invalid custom URL is rejected before any settings write');

  const localMissing = await validate(makeContext(), { providerId, settings: {} });
  assert.strictEqual(localMissing.ok, false);
  const probe = probeTransport();
  const testContext = makeContext({ ...valid, [key('PrivateApiKey')]: 'saved-private-key' }, probe.transport);
  const testResult = await validate(testContext, { providerId, settings: {
    ...valid, [key('PrivateApiKey')]: '***', _secretModes: { [key('PrivateApiKey')]: 'stored' }
  } });
  assert.strictEqual(testResult.ok, true);
  assert.strictEqual(probe.calls.length, 3);
  assert.deepStrictEqual(testContext.writes, [], 'Test Connection does not save or activate settings');
  assert(!JSON.stringify(testResult).includes('saved-private-key'));

  const failing = probeTransport([{ status: 400, data: 'Invalid Token' }]);
  const notActivated = makeContext({
    TicketingActiveProvider: 'other-provider', ...valid, [key('PrivateApiKey')]: 'saved-private-key'
  }, failing.transport);
  const denied = await activateProvider(notActivated, {
    providerId, expectedCurrentProvider: 'other-provider'
  }, { registry: PROVIDER_REGISTRY, definitions: PROVIDER_UI_DEFINITIONS });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(notActivated.writes.length, 0, 'failed saved-settings Test Connection prevents activation');
  assert(!denied.message.includes('saved-private-key'));

  const successful = probeTransport();
  const activatedContext = makeContext({
    TicketingActiveProvider: 'other-provider', ...valid, [key('PrivateApiKey')]: 'saved-private-key'
  }, successful.transport);
  const activated = await activateProvider(activatedContext, {
    providerId, expectedCurrentProvider: 'other-provider'
  }, { registry: PROVIDER_REGISTRY, definitions: PROVIDER_UI_DEFINITIONS });
  assert.strictEqual(activated.ok, true);
  assert.deepStrictEqual(activatedContext.writes, [['TicketingActiveProvider', providerId]]);
  assert.strictEqual(successful.calls.length, 3);

  console.log('ConnectWise settings contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
