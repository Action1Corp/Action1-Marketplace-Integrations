const { createProviderDispatcher, PROVIDER_REGISTRY, resolveProvider } = require('./providerRegistry');
const { ACTIVE_PROVIDER_KEY, PROVIDER_UI_DEFINITIONS, readSettings } = require('./providerSettings');

async function activateProvider(context, request = {}, dependencies = {}) {
  const registry = dependencies.registry || PROVIDER_REGISTRY;
  const dispatcher = dependencies.dispatcher || createProviderDispatcher(registry);
  const definitions = dependencies.definitions || PROVIDER_UI_DEFINITIONS;
  const target = String(request.providerId || '').trim();
  const settings = context?.settings;
  if (!settings || typeof settings.set !== 'function') return failure('Unable to update the active ticketing system.');
  let current;
  try { current = String(await settings.get(ACTIVE_PROVIDER_KEY) || dependencies.initialProviderId || 'connectwise-psa').trim(); }
  catch { return failure('Unable to read the active ticketing system. Refresh settings and try again.'); }
  if (target === current) return { ok: true, changed: false, activeProviderId: current, message: 'This ticketing system is already active.' };
  if (request.expectedCurrentProvider !== current) {
    return failure('The active ticketing system changed. Refresh and try again.');
  }
  const resolved = resolveProvider(target, registry);
  if (!resolved.ok || !definitions[target]?.available) {
    return failure('The requested ticketing system is not available in this version.');
  }
  const keys = definitions[target].fields.map((field) => `TicketingProvider_${target.replace(/-/g, '_')}_${field.key}`);
  let validation;
  try {
    const saved = await readSettings(context, keys);
    validation = await dispatcher.invoke({
      providerId: target,
      operation: 'validateConfiguration',
      input: { settings: saved, mode: 'activation' }
    });
  } catch {
    return failure('Unable to validate the saved connection settings. Refresh settings and try again.');
  }
  if (!validation.ok) return failure('Complete the required connection settings before making this ticketing system active.');
  try {
    await settings.set(ACTIVE_PROVIDER_KEY, target);
  } catch {
    const reloaded = String(await settings.get(ACTIVE_PROVIDER_KEY) || current).trim();
    return failure(reloaded === target ? 'The active ticketing system was saved, but the action could not confirm it. Refresh settings.' : 'Unable to change the active ticketing system. The saved selection was reloaded.');
  }
  await request.run?.appendLog?.(`Active ticketing system changed from ${current} to ${target}.`);
  return { ok: true, changed: true, activeProviderId: target, message: 'Ticketing system activated. Synchronization has not started.' };
}

function failure(message) { return { ok: false, message }; }

module.exports = { activateProvider };
