import {
  ATTRIBUTE_GROUP,
  CONNECTION_GROUP,
  SECRET_MASK,
  buildLoadedSettingsState,
  buildSavePayload,
  buildValidationRequestSettings,
  getConnectionSummary,
  getDisplayedSettingValue,
  getSettingsGroup,
  groupSettings,
  isConnectionConfigured,
  missingRequiredSettings,
  pickSettingsValues,
  resolveEffectiveSettings
} from '../settingsResolver.mjs';

export {
  ATTRIBUTE_GROUP,
  CONNECTION_GROUP,
  SECRET_MASK,
  buildLoadedSettingsState,
  buildSavePayload,
  buildValidationRequestSettings,
  getConnectionSummary,
  getDisplayedSettingValue,
  getSettingsGroup,
  groupSettings,
  isConnectionConfigured,
  missingRequiredSettings,
  pickSettingsValues,
  resolveEffectiveSettings
};

export function applySchemaDefaults(settingsSchema, loadedSettings = {}, options = {}) {
  return resolveEffectiveSettings(settingsSchema, loadedSettings, options);
}

export function getInitialConnectionEditing(settingsSchema, settings = {}, options = {}) {
  return !isConnectionConfigured(settingsSchema, settings, options);
}
