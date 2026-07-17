const path = require('path');
const { pathToFileURL } = require('url');
const { MAPPINGS_TABLE } = require('./mappingStore');

const settingsSchema = require('./ui/settingsSchema.json');

const DEFAULT_INTERVAL_HOURS = '24';
const RUNTIME_SETTING_KEYS = settingsSchema.map((field) => String(field.key || '').trim()).filter(Boolean);
const SENSITIVE_RUNTIME_SETTING_KEYS = new Set(
  settingsSchema
    .filter((field) => field.type === 'secret' || field.sensitive)
    .map((field) => String(field.key || '').trim())
    .filter(Boolean)
);
let settingsResolverModulePromise = null;

function scheduleKey(integration) {
  return `CronSchedule_${integration}`;
}

function timezoneKey(integration) {
  return `CronTimezone_${integration}`;
}

function parseSavedSchedule(cron) {
  const normalized = String(cron || '').trim();
  if (!normalized) {
    return {
      enabled: false,
      intervalHours: DEFAULT_INTERVAL_HOURS,
      cron: '',
      custom: false
    };
  }

  if (normalized === '0 */12 * * *') {
    return {
      enabled: true,
      intervalHours: '12',
      cron: normalized,
      custom: false
    };
  }

  if (normalized === '0 2 * * *') {
    return {
      enabled: true,
      intervalHours: '24',
      cron: normalized,
      custom: false
    };
  }

  return {
    enabled: true,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    cron: normalized,
    custom: true
  };
}

async function loadResolvedAttributeMappings(loadedSettings) {
  const moduleUrl = pathToFileURL(path.join(__dirname, 'settingsResolver.mjs')).href;
  const module = await import(moduleUrl);
  return typeof module.resolveAttributeMappings === 'function'
    ? module.resolveAttributeMappings(settingsSchema, loadedSettings)
    : [];
}

async function loadSettingsResolverModule() {
  if (!settingsResolverModulePromise) {
    const moduleUrl = pathToFileURL(path.join(__dirname, 'settingsResolver.mjs')).href;
    settingsResolverModulePromise = import(moduleUrl);
  }

  return settingsResolverModulePromise;
}

async function loadMappings(context) {
  const rows = await context.db.all(
    `SELECT id, action1_org_id, action1_org_name
       FROM ${MAPPINGS_TABLE}
      ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC`
  );

  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: row.id,
      action1OrgId: String(row.action1_org_id || '').trim(),
      action1OrgName: String(row.action1_org_name || '').trim()
    }))
    .filter((row) => row.action1OrgId);
}

function getSetting(settings, key) {
  return String(settings?.[key] || '').trim();
}

async function readRuntimeSettings(context, options = {}) {
  const out = {};
  const canGet = context?.settings && typeof context.settings.get === 'function';
  let loadedSettings = {};

  if (context?.settings && typeof context.settings.all === 'function') {
    const values = await context.settings.all(RUNTIME_SETTING_KEYS);
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      loadedSettings = values;
    }
  }

  for (const key of RUNTIME_SETTING_KEYS) {
    const fromAll = loadedSettings[key];
    if (fromAll !== undefined && fromAll !== null && String(fromAll).trim() !== '') {
      out[key] = fromAll;
      continue;
    }

    if (canGet && (SENSITIVE_RUNTIME_SETTING_KEYS.has(key) || fromAll === undefined)) {
      out[key] = await context.settings.get(key);
      continue;
    }

    out[key] = fromAll ?? '';
  }

  if (options.applyDefaults === false) {
    return out;
  }

  const settingsResolver = await loadSettingsResolverModule();
  return typeof settingsResolver.resolveEffectiveSettings === 'function'
    ? settingsResolver.resolveEffectiveSettings(settingsSchema, out, {
      storedSecrets: {},
      secretMask: settingsResolver.SECRET_MASK
    })
    : out;
}

async function loadSyncRuntimeConfig(context, options = {}) {
  const integrationId = options.integrationId || 'entra-id';
  const rawLoadedSettings = await readRuntimeSettings(context, { applyDefaults: false });
  const settingsResolver = await loadSettingsResolverModule();
  const loadedSettings = typeof settingsResolver.resolveEffectiveSettings === 'function'
    ? settingsResolver.resolveEffectiveSettings(settingsSchema, rawLoadedSettings, {
      storedSecrets: {},
      secretMask: settingsResolver.SECRET_MASK
    })
    : rawLoadedSettings;
  const action1Credentials = typeof context?.action1?.getCredentials === 'function'
    ? await context.action1.getCredentials()
    : {};
  const orgMappings = await loadMappings(context);
  const resolvedAttributeMappings = await loadResolvedAttributeMappings(rawLoadedSettings);

  const tenantId = getSetting(loadedSettings, 'EntraTenantId');
  const clientId = getSetting(loadedSettings, 'EntraClientId');
  const clientSecret = getSetting(loadedSettings, 'EntraClientSecret');
  const action1ApiKey = String(action1Credentials?.apiKey || '').trim();
  const action1ApiSecret = String(action1Credentials?.apiSecret || '').trim();
  const targetMappings = resolvedAttributeMappings.map((row) => ({
    entraProperty: row.entraProperty,
    action1CustomAttribute: row.action1CustomAttribute
  }));

  const runtimeConfig = {
    integrationId,
    settings: loadedSettings,
    attributeMappings: {
      groupMembership: resolvedAttributeMappings.find((row) => row.entraProperty === 'memberOf') || null,
      deviceOwnership: resolvedAttributeMappings.find((row) => row.entraProperty === 'deviceOwnership') || null
    },
    scheduler: {
      key: scheduleKey(integrationId),
      timezoneKey: timezoneKey(integrationId),
      timezone: String(loadedSettings?.[timezoneKey(integrationId)] || 'UTC').trim() || 'UTC',
      ...parseSavedSchedule(loadedSettings?.[scheduleKey(integrationId)])
    },
    mappings: orgMappings,
    tenants: [],
    action1: {
      apiBaseUrl: 'https://app.action1.com/api/3.0',
      clientId: action1ApiKey,
      clientSecret: action1ApiSecret
    }
  };

  if (tenantId && clientId && clientSecret) {
    runtimeConfig.tenants.push({
      name: 'Configured Entra tenant',
      tenantId,
      clientId,
      clientSecret,
      targets: orgMappings.length > 0
        ? [
            {
              organizationIds: orgMappings.map((row) => row.action1OrgId),
              mappings: targetMappings
            }
          ]
        : []
    });
  }

  return runtimeConfig;
}

function getSyncReadiness(runtimeConfig, options = {}) {
  const activeRun = Boolean(options.activeRun);
  const tenant = runtimeConfig?.tenants?.[0] || null;
  const tenantId = String(tenant?.tenantId || getSetting(runtimeConfig?.settings, 'EntraTenantId')).trim();
  const clientId = String(tenant?.clientId || getSetting(runtimeConfig?.settings, 'EntraClientId')).trim();
  const clientSecret = String(tenant?.clientSecret || getSetting(runtimeConfig?.settings, 'EntraClientSecret')).trim();
  const action1ClientId = String(runtimeConfig?.action1?.clientId || '').trim();
  const action1ClientSecret = String(runtimeConfig?.action1?.clientSecret || '').trim();
  const mappedOrganizations = Array.isArray(tenant?.targets?.[0]?.organizationIds)
    ? tenant.targets[0].organizationIds.filter(Boolean)
    : [];
  const mappingCount = mappedOrganizations.length || (Array.isArray(runtimeConfig?.mappings) ? runtimeConfig.mappings.length : 0);
  const presence = {
    tenantId: Boolean(tenantId),
    clientId: Boolean(clientId),
    clientSecret: Boolean(clientSecret),
    action1Credentials: Boolean(action1ClientId && action1ClientSecret),
    mappings: mappingCount
  };

  if (!presence.tenantId) {
    return {
      status: 'not_configured',
      code: 'missing_entra_tenant_id',
      message: 'Complete the Entra tenant ID in Settings before running Sync.',
      retryable: false,
      presence,
      mappingCount
    };
  }

  if (!presence.clientId) {
    return {
      status: 'not_configured',
      code: 'missing_entra_client_id',
      message: 'Complete the Entra client ID in Settings before running Sync.',
      retryable: false,
      presence,
      mappingCount
    };
  }

  if (!presence.clientSecret) {
    return {
      status: 'not_configured',
      code: 'missing_entra_client_secret',
      message: 'Complete the Entra client secret in Settings before running Sync.',
      retryable: false,
      presence,
      mappingCount
    };
  }

  if (!presence.action1Credentials) {
    return {
      status: 'not_configured',
      code: 'missing_action1_credentials',
      message: 'Complete the shared Action1 credentials before running Sync.',
      retryable: false,
      presence,
      mappingCount
    };
  }

  if (mappingCount === 0) {
    return {
      status: 'no_mappings',
      code: 'missing_organization_mappings',
      message: 'Add at least one Action1 organization mapping before running Sync.',
      retryable: false,
      presence,
      mappingCount
    };
  }

  if (activeRun) {
    return {
      status: 'running',
      code: 'sync_already_running',
      message: 'Another Sync run is already in progress.',
      retryable: false,
      presence,
      mappingCount
    };
  }

  return {
    status: 'ready',
    code: 'ready',
    message: 'Ready to run Sync.',
    retryable: false,
    presence,
    mappingCount
  };
}

module.exports = {
  DEFAULT_INTERVAL_HOURS,
  getSyncReadiness,
  loadSyncRuntimeConfig,
  parseSavedSchedule,
  readRuntimeSettings,
  RUNTIME_SETTING_KEYS,
  scheduleKey,
  timezoneKey
};
