const settingsSchema = require('./ui/settingsSchema.json');

let settingsResolverPromise = null;

function getSettingsResolver() {
  if (!settingsResolverPromise) {
    settingsResolverPromise = import('./settingsResolver.mjs');
  }

  return settingsResolverPromise;
}

async function loadSettings(context, request = {}) {
  const resolver = await getSettingsResolver();
  const connectionSchema = resolver.getSettingsGroup(settingsSchema, resolver.CONNECTION_GROUP);
  return resolver.resolveRequestSettings(connectionSchema, context, request.settings || {});
}

async function missingRequiredSettings(settings) {
  const resolver = await getSettingsResolver();
  const connectionSchema = resolver.getSettingsGroup(settingsSchema, resolver.CONNECTION_GROUP);
  return resolver.missingRequiredSettings(connectionSchema, settings, {
    secretMask: resolver.SECRET_MASK
  });
}

async function validate(context, request = {}) {
  const settings = await loadSettings(context, request);
  const missing = await missingRequiredSettings(settings);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required Microsoft Entra settings: ${missing.join(', ')}`
    };
  }

  return {
    ok: true,
    message: 'Configuration values are present.'
  };
}

module.exports = {
  loadSettings,
  missingRequiredSettings,
  validate
};
