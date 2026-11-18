const assert = require('assert');
const { buildProviderSettingKey, getOwnedSettingKeys, filterSettingsForOwner } = require('../providerSettings');

function run() {
  const providers = {
    alpha: { fields: [{ key: 'ClientId' }, { key: 'ClientSecret', type: 'secret' }], accountSelectors: ['Tenant'] },
    beta: { fields: [{ key: 'ClientId' }, { key: 'Route' }] }
  };
  assert.strictEqual(buildProviderSettingKey('alpha', 'ClientId'), 'TicketingProvider_alpha_ClientId');
  assert.notStrictEqual(buildProviderSettingKey('alpha', 'ClientId'), buildProviderSettingKey('beta', 'ClientId'));
  const alphaKeys = getOwnedSettingKeys('alpha', providers);
  const input = {
    TicketingOfflineEnabled: 'false', TicketingActiveProvider: 'beta',
    TicketingProvider_alpha_ClientId: 'a', TicketingProvider_beta_ClientId: 'b',
    unrelated: 'x'
  };
  assert.deepStrictEqual(filterSettingsForOwner(input, 'alpha', providers), {
    TicketingOfflineEnabled: 'false', TicketingProvider_alpha_ClientId: 'a'
  });
  assert(alphaKeys.includes('TicketingProvider_alpha_ClientSecret'));
}

run();
