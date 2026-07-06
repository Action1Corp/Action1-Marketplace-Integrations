export function buildSettingsSchemaIndex(settingsSchema = []) {
  return new Map(
    (Array.isArray(settingsSchema) ? settingsSchema : [])
      .filter((setting) => setting && typeof setting === 'object')
      .map((setting) => [String(setting.key || '').trim(), setting])
      .filter(([key]) => key)
  );
}

export function resolveSettingDefinition(setting, options = {}) {
  const candidate = setting && typeof setting === 'object' ? setting : {};
  const settingKey = String(candidate.key || '').trim();
  if (!settingKey) {
    return candidate;
  }

  const settingsByKey = options.settingsByKey || buildSettingsSchemaIndex(options.settingsSchema);
  const schemaSetting = settingsByKey.get(settingKey) || null;
  if (!schemaSetting) {
    return candidate;
  }

  return {
    ...schemaSetting,
    ...candidate
  };
}

export function isUnsetHostValueForDefaultedSetting(value, setting, options = {}) {
  const resolvedSetting = resolveSettingDefinition(setting, options);
  return resolvedSetting.defaultValue !== undefined && value === '';
}

export function getEffectiveSettingValue(setting, currentSettings, options = {}) {
  const resolvedSetting = resolveSettingDefinition(setting, options);
  const settingKey = String(resolvedSetting.key || '').trim();
  const hasCurrentValue = options.hasCurrentValue !== undefined
    ? Boolean(options.hasCurrentValue)
    : Boolean(
      currentSettings &&
      settingKey &&
      Object.prototype.hasOwnProperty.call(currentSettings, settingKey)
    );
  const currentValue = settingKey ? currentSettings?.[settingKey] : undefined;
  const secretMask = options.secretMask || '***';

  if (currentValue === secretMask) {
    return currentValue;
  }
  if (
    hasCurrentValue &&
    currentValue !== undefined &&
    currentValue !== null &&
    !isUnsetHostValueForDefaultedSetting(currentValue, resolvedSetting, options)
  ) {
    return currentValue;
  }
  if (resolvedSetting.defaultValue !== undefined) {
    return resolvedSetting.defaultValue;
  }
  return '';
}

function isChecked(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function serializeSettingValue(setting, currentSettings, options = {}) {
  const resolvedSetting = resolveSettingDefinition(setting, options);
  const value = getEffectiveSettingValue(resolvedSetting, currentSettings, options);

  if (resolvedSetting.type === 'checkbox') {
    return isChecked(value) ? 'true' : 'false';
  }
  if (resolvedSetting.type === 'number') {
    return value === '' ? '' : String(value);
  }
  return value ?? '';
}
