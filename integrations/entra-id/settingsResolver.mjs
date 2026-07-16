export const SECRET_MASK = '***';
export const CONNECTION_GROUP = 'Entra Configuration';
export const ATTRIBUTE_GROUP = 'Action1 Custom Attributes';

export function groupSettings(settingsSchema = []) {
  return settingsSchema.reduce((groups, setting) => {
    const groupName = setting.group || 'Configuration';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(setting);
    return groups;
  }, {});
}

export function getSettingsGroup(settingsSchema = [], groupName) {
  return settingsSchema.filter((setting) => (setting.group || 'Configuration') === groupName);
}

export function getDefaultSettings(settingsSchema = []) {
  const defaults = {};

  for (const setting of settingsSchema) {
    if (setting.defaultValue !== undefined) {
      defaults[setting.key] = setting.defaultValue;
    }
  }

  return defaults;
}

export function resolveEffectiveSettings(settingsSchema = [], loadedSettings = {}, options = {}) {
  const storedSecrets = options.storedSecrets || {};
  const secretMask = options.secretMask || SECRET_MASK;
  const effectiveSettings = { ...loadedSettings };

  for (const setting of settingsSchema) {
    const currentValue = effectiveSettings[setting.key];

    if ((currentValue === undefined || currentValue === null) && setting.defaultValue !== undefined) {
      effectiveSettings[setting.key] = setting.defaultValue;
    }

    if ((setting.type === 'secret' || setting.sensitive) && storedSecrets[setting.key]) {
      effectiveSettings[setting.key] = secretMask;
    }
  }

  return effectiveSettings;
}

export function pickSettingsValues(settingsSchema = [], settings = {}) {
  const picked = {};

  for (const setting of settingsSchema) {
    if (Object.prototype.hasOwnProperty.call(settings, setting.key)) {
      picked[setting.key] = settings[setting.key];
    }
  }

  return picked;
}

export function missingRequiredSettings(settingsSchema = [], settings = {}, options = {}) {
  const storedSecrets = options.storedSecrets || {};
  const secretMask = options.secretMask || SECRET_MASK;

  return settingsSchema
    .filter((setting) => setting.required)
    .filter((setting) => {
      const value = settings[setting.key];
      if ((setting.type === 'secret' || setting.sensitive) && value === secretMask && storedSecrets[setting.key]) {
        return false;
      }

      return !String(value ?? '').trim();
    })
    .map((setting) => setting.key);
}

export function isConnectionConfigured(settingsSchema = [], settings = {}, options = {}) {
  return missingRequiredSettings(settingsSchema, settings, options).length === 0;
}

export function getDisplayedSettingValue(setting, settings = {}) {
  const currentValue = settings[setting.key];
  if ((currentValue === undefined || currentValue === null) && setting.defaultValue !== undefined) {
    return setting.defaultValue;
  }

  return currentValue ?? '';
}

export function buildValidationRequestSettings(settingsSchema = [], settings = {}, options = {}) {
  const sensitiveKeys = options.sensitiveKeys || new Set();
  const secretMask = options.secretMask || SECRET_MASK;
  const storedSecrets = options.storedSecrets || {};
  const payload = { _secretModes: {} };

  for (const setting of settingsSchema) {
    const value = settings[setting.key];

    if (sensitiveKeys.has(setting.key) && value === secretMask && storedSecrets[setting.key]) {
      payload._secretModes[setting.key] = 'stored';
      continue;
    }

    if (value === undefined || value === null) {
      payload[setting.key] = setting.defaultValue !== undefined ? String(setting.defaultValue) : '';
      continue;
    }

    payload[setting.key] = String(value);
  }

  if (Object.keys(payload._secretModes).length === 0) {
    delete payload._secretModes;
  }

  return payload;
}

export function buildSavePayload(settingsSchema = [], integration, settings = {}, options = {}) {
  const sensitiveKeys = options.sensitiveKeys || new Set();
  const secretMask = options.secretMask || SECRET_MASK;
  const payload = { _integration: integration };

  for (const setting of settingsSchema) {
    const value = settings[setting.key];

    if (sensitiveKeys.has(setting.key) && value === secretMask) {
      continue;
    }

    if (value === undefined || value === null) {
      payload[setting.key] = setting.defaultValue !== undefined ? String(setting.defaultValue) : '';
      continue;
    }

    payload[setting.key] = String(value);
  }

  return payload;
}

export function buildLoadedSettingsState(settingsSchema = [], loadedSettings = {}, options = {}) {
  const effectiveSettings = resolveEffectiveSettings(settingsSchema, loadedSettings, options);
  const connectionSchema = getSettingsGroup(settingsSchema, CONNECTION_GROUP);
  const attributeSchema = getSettingsGroup(settingsSchema, ATTRIBUTE_GROUP);
  const connectionSettings = pickSettingsValues(connectionSchema, effectiveSettings);
  const attributeSettings = pickSettingsValues(attributeSchema, effectiveSettings);
  const connectionConfigured = isConnectionConfigured(connectionSchema, connectionSettings, options);

  return {
    effectiveSettings,
    connectionSettings,
    attributeSettings,
    connectionConfigured,
    connectionEditing: !connectionConfigured
  };
}

export function getAttributeDefaultMappings(settingsSchema = []) {
  const defaults = getDefaultSettings(settingsSchema);

  return [
    {
      entraProperty: 'memberOf',
      action1CustomAttribute: defaults.EntraGroupsCustomAttributeName
    },
    {
      entraProperty: 'deviceOwnership',
      action1CustomAttribute: defaults.EntraDeviceOwnershipCustomAttributeName
    }
  ];
}

export function resolveAttributeMappings(settingsSchema = [], settings = {}) {
  const defaults = getDefaultSettings(settingsSchema);
  const savedGroupAttribute = String(settings.EntraGroupsCustomAttributeName ?? '').trim();
  const savedOwnershipAttribute = String(settings.EntraDeviceOwnershipCustomAttributeName ?? '').trim();

  return [
    {
      entraProperty: 'memberOf',
      action1CustomAttribute: savedGroupAttribute || defaults.EntraGroupsCustomAttributeName,
      source: savedGroupAttribute ? 'saved' : 'default'
    },
    {
      entraProperty: 'deviceOwnership',
      action1CustomAttribute: savedOwnershipAttribute || defaults.EntraDeviceOwnershipCustomAttributeName,
      source: savedOwnershipAttribute ? 'saved' : 'default'
    }
  ];
}

export function getConnectionSummary(settings = {}) {
  return [
    'Connection settings are configured.',
    `Tenant ID: ${settings.EntraTenantId || ''}`
  ];
}

export async function resolveRequestSettings(settingsSchema = [], context, requestSettings = {}) {
  const resolved = {};

  for (const setting of settingsSchema) {
    const key = setting.key;
    const secretMode = requestSettings?._secretModes?.[key];

    if (secretMode === 'stored' && context?.settings?.get) {
      resolved[key] = await context.settings.get(key);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(requestSettings, key)) {
      resolved[key] = requestSettings[key];
      continue;
    }

    if (setting.defaultValue !== undefined) {
      resolved[key] = setting.defaultValue;
    }
  }

  return resolved;
}
