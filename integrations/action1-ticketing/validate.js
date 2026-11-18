const { createProviderDispatcher } = require('./providerRegistry');
const { PROVIDER_UI_DEFINITIONS, buildProviderSettingKey, readSettings } = require('./providerSettings');

async function validate(context, request = {}, dependencies = {}) {
  const dispatcher = dependencies.dispatcher || createProviderDispatcher(dependencies.registry);
  const definitions = dependencies.definitions || PROVIDER_UI_DEFINITIONS;
  const providerId = String(request.providerId || '').trim();
  const definition = definitions[providerId];
  if (!definition || definition.available !== true) {
    return { ok: false, message: 'The requested ticketing system is not available in this version.' };
  }

  const draft = request.settings && typeof request.settings === 'object' ? request.settings : {};
  const keys = definition.fields.map((field) => buildProviderSettingKey(providerId, field.key));
  const saved = await readSettings(context, keys);
  const effective = {};
  for (const field of definition.fields) {
    const key = buildProviderSettingKey(providerId, field.key);
    const draftValue = draft[key];
    const isStoredMask = field.type === 'secret' && (draftValue === '***' || draft._secretModes?.[key] === 'stored');
    const isOmitted = field.type === 'secret' && !Object.prototype.hasOwnProperty.call(draft, key);
    effective[key] = isStoredMask || isOmitted ? saved[key] : draftValue;
  }

  try {
    const configuration = await dispatcher.invoke({
      providerId,
      operation: 'validateConfiguration',
      input: { settings: effective, mode: 'test-connection' }
    });
    if (!configuration.ok) {
      return { ok: false, message: 'Check the required ticketing connection settings.', errors: configuration.errors };
    }
    const result = await dispatcher.invoke({
      providerId,
      operation: 'testConnection',
      input: { settings: effective }
    });
    return { ok: result.ok, message: result.message || (result.ok ? 'Connection test succeeded.' : 'Connection test failed.') };
  } catch (error) {
    return { ok: false, message: error?.message || 'The ticketing connection could not be tested.' };
  }
}

module.exports = { validate };
