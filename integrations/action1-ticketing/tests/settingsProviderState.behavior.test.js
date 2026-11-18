const assert = require('assert');

async function run() {
  const { hasUnsavedProviderSettings, isCurrentProviderRequest, restoreViewedProviderSettings } = await import('../ui/providerSettingsState.mjs');
  const request = { providerId: 'alpha', generation: 3, settingsFingerprint: '{"draft":"one"}' };
  assert(isCurrentProviderRequest(request, { ...request }), 'unchanged provider and draft may accept the async response');
  assert(!isCurrentProviderRequest(request, { ...request, providerId: 'beta' }), 'responses from a previously viewed provider are stale');
  assert(!isCurrentProviderRequest(request, { ...request, settingsFingerprint: '{"draft":"two"}' }), 'responses for edited drafts are stale');
  assert(!isCurrentProviderRequest(request, { ...request, generation: 4 }), 'superseded requests are stale');
  assert(hasUnsavedProviderSettings({ common: 'x', a: 'draft' }, { common: 'x', a: 'saved' }));
  assert(!hasUnsavedProviderSettings({ common: 'x' }, { common: 'x' }));

  const saved = {
    TicketingOfflineEnabled: 'false',
    TicketingProvider_alpha_ClientSecret: '***',
    TicketingProvider_beta_ClientSecret: '***'
  };
  const beta = restoreViewedProviderSettings(saved, 'beta', ['TicketingProvider_beta_ClientSecret']);
  const returnedAlpha = restoreViewedProviderSettings(beta, 'alpha', ['TicketingProvider_alpha_ClientSecret']);
  assert.strictEqual(returnedAlpha.TicketingProvider_alpha_ClientSecret, '***', 'A→B→A restores the saved provider A field');
  assert.strictEqual(returnedAlpha.TicketingProvider_beta_ClientSecret, '***', 'viewing A retains provider B fields');
  assert.strictEqual(returnedAlpha.TicketingOfflineEnabled, 'false', 'shared rules remain shared across provider views');
}

run().catch((error) => { console.error(error); process.exit(1); });
