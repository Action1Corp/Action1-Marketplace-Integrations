const path = require('path');
const { pathToFileURL } = require('url');

const settingsSchema = require('./ui/settingsSchema.json');

let settingsResolverPromise = null;
let entraClientPromise = null;

const FIELD_LABELS = Object.freeze({
  EntraTenantId: 'EntraDirectoryId',
  EntraClientId: 'EntraApplicationClientId',
  EntraClientSecret: 'EntraClientSecret'
});

function getSettingsResolver() {
  if (!settingsResolverPromise) {
    settingsResolverPromise = import('./settingsResolver.mjs');
  }

  return settingsResolverPromise;
}

function getEntraClient() {
  if (!entraClientPromise) {
    entraClientPromise = import(pathToFileURL(path.join(__dirname, 'core', 'entra', 'entraClient.mjs')).href);
  }

  return entraClientPromise;
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

function mapMissingSetting(settingKey) {
  return FIELD_LABELS[settingKey] || String(settingKey || '').trim();
}

function classifyValidationFailure(error) {
  const target = String(error?.url || '').toLowerCase();
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  const responseError = String(error?.response?.error || error?.response?.error?.code || '').toLowerCase();
  const responseDescription = String(error?.response?.error_description || error?.response?.error?.message || '').toLowerCase();
  const combined = `${message} ${responseError} ${responseDescription}`;

  if (
    target.includes('login.microsoftonline.com') &&
    (status === 400 || status === 401) &&
    (
      combined.includes('invalid_client') ||
      combined.includes('invalid client') ||
      combined.includes('aadsts7000215') ||
      combined.includes('aadsts700016')
    )
  ) {
    return 'Microsoft Entra connection failed: Invalid credentials.';
  }

  if (
    target.includes('graph.microsoft.com') &&
    (status === 403 || combined.includes('authorization_requestdenied') || combined.includes('insufficient privileges'))
  ) {
    return 'Microsoft Entra connection failed: Insufficient Microsoft Graph permissions.';
  }

  if (
    target.includes('graph.microsoft.com') &&
    (status === 429 || status >= 500 || !status)
  ) {
    return 'Microsoft Entra connection failed: Microsoft Graph unavailable.';
  }

  return 'Microsoft Entra connection failed: Unable to validate Microsoft Graph access.';
}

async function validate(context, request = {}) {
  const settings = await loadSettings(context, request);
  const missing = await missingRequiredSettings(settings);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required Microsoft Entra settings: ${missing.map(mapMissingSetting).join(', ')}`
    };
  }

  try {
    const entraClient = await getEntraClient();
    await entraClient.validateGraphConnection({
      tenantId: settings.EntraTenantId,
      clientId: settings.EntraClientId,
      clientSecret: settings.EntraClientSecret
    }, context?.logger || null);

    return {
      ok: true,
      message: 'Microsoft Entra connection succeeded.'
    };
  } catch (error) {
    return {
      ok: false,
      message: classifyValidationFailure(error)
    };
  }
}

module.exports = {
  loadSettings,
  missingRequiredSettings,
  validate
};
