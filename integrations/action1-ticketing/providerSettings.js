const schema = require('./ui/settingsSchema.json');
const { INITIAL_PROVIDER_ID } = require('./providerRegistry');
const { validateConnectWiseConnection } = require('./providers/connectwiseApi');

const ACTIVE_PROVIDER_KEY = 'TicketingActiveProvider';
const SECRET_MASK = '***';
const SECRET_MODE_KEY = '_secretModes';
const LEGACY_DESTINATION_KEYS = new Set([
  'TicketingResourceServer', 'TicketingAuthorisationServer', 'TicketingClientId', 'TicketingClientSecret',
  'TicketingTeamId', 'TicketingTicketTypeId', 'TicketingCategory1Id', 'TicketingNewStatusId', 'TicketingClosedStatusIds'
]);

const COMMON_SETTING_KEYS = Object.freeze(schema.map((field) => field.key)
  .filter((key) => key !== ACTIVE_PROVIDER_KEY && !LEGACY_DESTINATION_KEYS.has(key) && !key.startsWith('TicketingProvider_')));
const CONNECTWISE_FIELDS = Object.freeze([
  { key: 'ApiRegion', label: 'API Region / Server', type: 'select', required: true, options: [
    { value: 'NA', label: 'North America' }, { value: 'EU', label: 'Europe' }, { value: 'AU', label: 'Australia' }, { value: 'CUSTOM', label: 'Custom Server' }
  ] },
  { key: 'CustomServer', label: 'Custom Server URL', type: 'url', required: false },
  { key: 'CompanyId', label: 'PSA Company ID', type: 'text', required: true },
  { key: 'PublicApiKey', label: 'Public API Key', type: 'text', required: true },
  { key: 'PrivateApiKey', label: 'Private API Key', type: 'secret', required: true },
  { key: 'ServiceBoardId', label: 'Service Board', type: 'text', required: false },
  { key: 'InitialStatusId', label: 'Initial Ticket Status', type: 'text', required: false },
  { key: 'TicketTypeId', label: 'Ticket Type', type: 'text', required: false },
  { key: 'TicketSubtypeId', label: 'Ticket Subtype', type: 'text', required: false },
  { key: 'TicketItemId', label: 'Ticket Item', type: 'text', required: false },
  { key: 'PriorityId', label: 'Priority', type: 'text', required: false },
  { key: 'SourceId', label: 'Source', type: 'text', required: false },
  { key: 'AdditionalClosedStatusIds', label: 'Additional Closed/Resolved Statuses', type: 'text', required: false }
]);
const PROVIDER_UI_DEFINITIONS = Object.freeze({
  [INITIAL_PROVIDER_ID]: Object.freeze({
    providerId: INITIAL_PROVIDER_ID,
    label: 'ConnectWise PSA',
    available: true,
    fields: CONNECTWISE_FIELDS,
    accountSelectors: Object.freeze([]),
    requiresSuccessfulTestConnectionBeforeActivation: true
  })
});

function buildProviderSettingKey(providerId, fieldName) {
  const provider = String(providerId || '').trim();
  const field = String(fieldName || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider) || !/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
    throw new Error('ticketing_provider_setting_key_invalid');
  }
  return `TicketingProvider_${provider.replace(/-/g, '_')}_${field}`;
}

function getOwnedSettingKeys(providerId, definitions = PROVIDER_UI_DEFINITIONS) {
  const definition = definitions[providerId];
  return definition ? definition.fields.map((field) => buildProviderSettingKey(providerId, field.key)) : [];
}

function filterSettingsForOwner(settings, providerId, definitions = PROVIDER_UI_DEFINITIONS) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const allowed = new Set([...COMMON_SETTING_KEYS, ...getOwnedSettingKeys(providerId, definitions)]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
}

function isValidSettingValue(field, value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') return false;
  const text = String(value);
  if (text.length > 4096) return false;
  if (field.type === 'checkbox') return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(text.toLowerCase());
  if (field.type === 'number') {
    const number = Number(text);
    return Number.isFinite(number) && (field.min === undefined || number >= field.min) && (field.max === undefined || number <= field.max);
  }
  if (field.type === 'select' && Array.isArray(field.options)) return field.options.some((option) => option.value === text);
  if (field.type === 'url' && text.trim()) {
    try { const url = new URL(text); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }
  return true;
}

function normalizeProviderSettings(providerId, input, definitions = PROVIDER_UI_DEFINITIONS) {
  const definition = definitions[providerId];
  if (!definition) throw new Error('ticketing_provider_unavailable');
  const source = input && typeof input === 'object' ? input : {};
  const values = {};
  for (const field of definition.fields) {
    const key = buildProviderSettingKey(providerId, field.key);
    const value = source[key];
    if (value === undefined) continue;
    if (!isValidSettingValue(field, value)) {
      throw new Error('ticketing_provider_setting_invalid');
    }
    if (field.type === 'secret' && (value === SECRET_MASK || source[SECRET_MODE_KEY]?.[key] === 'stored')) continue;
    if (field.required && !String(value ?? '').trim()) throw new Error('ticketing_provider_setting_required');
    values[key] = value === null ? '' : String(value);
  }
  return values;
}

async function readSetting(context, key) {
  return context?.settings && typeof context.settings.get === 'function' ? context.settings.get(key) : '';
}

async function readSettings(context, keys) {
  if (context?.settings && typeof context.settings.all === 'function') {
    const result = await context.settings.all(keys);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  }
  const result = {};
  for (const key of keys) result[key] = await readSetting(context, key);
  return result;
}

async function saveProviderSettings(context, request = {}, options = {}) {
  const definitions = options.definitions || PROVIDER_UI_DEFINITIONS;
  const providerId = request.providerId;
  const definition = definitions[providerId];
  if (!definition) return { ok: false, message: 'The requested ticketing system is not available in this version.' };
  const input = request.settings && typeof request.settings === 'object' ? request.settings : {};
  if (Object.prototype.hasOwnProperty.call(input, ACTIVE_PROVIDER_KEY) || Object.prototype.hasOwnProperty.call(input, '_integration')) {
    return { ok: false, message: 'Settings contain fields that cannot be changed here.' };
  }
  const allowed = new Set([...COMMON_SETTING_KEYS, ...getOwnedSettingKeys(providerId, definitions)]);
  const secretModes = input[SECRET_MODE_KEY];
  if (secretModes !== undefined && (!secretModes || typeof secretModes !== 'object' || Array.isArray(secretModes) || Object.entries(secretModes).some(([key, mode]) => !allowed.has(key) || mode !== 'stored'))) {
    return { ok: false, message: 'Settings contain invalid secret-preservation metadata.' };
  }
  const submitted = Object.keys(input).filter((key) => key !== SECRET_MODE_KEY);
  if (submitted.some((key) => !allowed.has(key))) return { ok: false, message: 'Settings contain fields that cannot be changed here.' };
  const common = {};
  for (const key of submitted.filter((key) => COMMON_SETTING_KEYS.includes(key))) {
    const schemaField = schema.find((field) => field.key === key);
    const value = input[key];
    if (!schemaField || !isValidSettingValue(schemaField, value)) {
      return { ok: false, message: 'One or more settings are invalid.' };
    }
    common[key] = value === null ? '' : String(value);
  }
  let providerValues;
  try { providerValues = normalizeProviderSettings(providerId, input, definitions); }
  catch (error) { return { ok: false, message: error.message === 'ticketing_provider_setting_required' ? 'A required ticketing connection setting is missing.' : 'One or more provider settings are invalid.' }; }

  const fieldsByKey = new Map(definition.fields.map((field) => [buildProviderSettingKey(providerId, field.key), field]));
  const providerKeys = Array.from(fieldsByKey.keys());
  const oldProviderSettings = await readSettings(context, providerKeys);
  const hasProviderSubmission = Object.keys(providerValues).length > 0;
  if (hasProviderSubmission) for (const [key, field] of fieldsByKey) {
    const effective = Object.prototype.hasOwnProperty.call(providerValues, key) ? providerValues[key] : oldProviderSettings[key];
    if (field.required && !String(effective ?? '').trim()) return { ok: false, message: 'A required ticketing connection setting is missing.' };
  }
  if (providerId === INITIAL_PROVIDER_ID && hasProviderSubmission) {
    const effectiveValues = Object.fromEntries(Array.from(fieldsByKey.keys(), (key) => [
      key.slice(key.lastIndexOf('_') + 1), Object.prototype.hasOwnProperty.call(providerValues, key) ? providerValues[key] : oldProviderSettings[key]
    ]));
    const connectionValidation = validateConnectWiseConnection(effectiveValues);
    if (!connectionValidation.ok) return { ok: false, message: connectionValidation.errors.some((error) => error.field === 'CustomServer') ? connectionValidation.errors.find((error) => error.field === 'CustomServer').message : 'A required ticketing connection setting is missing.' };
  }
  const selectorKeys = definition.accountSelectors.map((field) => buildProviderSettingKey(providerId, field));
  const hasExplicitSelector = selectorKeys.some((key) => Object.prototype.hasOwnProperty.call(providerValues, key));
  if (hasExplicitSelector) {
    for (const key of selectorKeys) {
      if (!Object.prototype.hasOwnProperty.call(providerValues, key)) continue;
      const oldValue = String(oldProviderSettings[key] || '').trim();
      const newValue = String(providerValues[key] || '').trim();
      if (oldValue && oldValue !== newValue) {
        return { ok: false, message: `Changing the configured account for ${definition.label} is not supported. Your saved settings and ticket tracking were kept.` };
      }
    }
  }

  const writes = { ...common };
  for (const [key, value] of Object.entries(providerValues)) {
    const field = fieldsByKey.get(key);
    if (field?.type === 'secret' && (value === SECRET_MASK || input[SECRET_MODE_KEY]?.[key] === 'stored')) continue;
    writes[key] = value;
  }
  let savedCount = 0;
  try {
    for (const [key, value] of Object.entries(writes)) {
      await context.settings.set(key, value);
      savedCount += 1;
    }
  } catch {
    return { ok: false, partial: savedCount > 0, message: savedCount > 0 ? 'Unable to save all settings. Some earlier values may have been saved; reload settings before continuing.' : 'Unable to save settings.' };
  }
  return { ok: true, message: 'Settings saved successfully.' };
}

module.exports = {
  ACTIVE_PROVIDER_KEY, COMMON_SETTING_KEYS, LEGACY_DESTINATION_KEYS, PROVIDER_UI_DEFINITIONS,
  buildProviderSettingKey, filterSettingsForOwner, getOwnedSettingKeys,
  isValidSettingValue, normalizeProviderSettings, readSettings, saveProviderSettings
};
