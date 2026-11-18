const { listMappings } = require('./mappingStore');
const { INITIAL_PROVIDER_ID } = require('./providerRegistry');
const { ACTIVE_PROVIDER_KEY, COMMON_SETTING_KEYS, getOwnedSettingKeys } = require('./providerSettings');

const EXISTING_OPEN_TICKET_BEHAVIOR = Object.freeze({
  UPDATE_EXISTING_OPEN: 'update_existing_open',
  SKIP_EXISTING_OPEN: 'skip_existing_open'
});

const DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET = 25;
const DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION = 30;
const DEFAULT_AUTOMATION_FAILED_LOOKBACK_HOURS = 24;
const DEFAULT_ACTION1_CONNECTION = Object.freeze({
  baseUrl: '',
  clientId: '',
  clientSecretRef: ''
});

const RUNTIME_SETTING_KEYS = Object.freeze([...COMMON_SETTING_KEYS, ACTIVE_PROVIDER_KEY]);

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = trimValue(String(value || '')).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseCsvList(value, normalizer = (item) => item) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const out = [];
  const seen = new Set();

  for (const item of raw) {
    const normalized = normalizer(trimValue(String(item || '')));
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function normalizeSignalSeverity(value) {
  return trimValue(String(value || '')).toUpperCase();
}

function hasOwnSetting(settings, key) {
  return Boolean(settings && Object.prototype.hasOwnProperty.call(settings, key));
}

function normalizeExistingOpenTicketBehavior(value) {
  return trimValue(String(value || '')).toLowerCase() === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
    ? EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
    : EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN;
}

function normalizeTicketModel(value) {
  return trimValue(String(value || '')).toLowerCase() === 'endpoint' ? 'endpoint' : 'grouped';
}

function normalizeMappingRows(rows) {
  const source = Array.isArray(rows) ? rows : [];

  return source
    .filter((row) => row && row.enabled !== false)
    .map((row) => ({
      mappingId: trimValue(String(row.id ?? '')),
      action1OrgId: trimValue(String(row.action1OrgId || '')),
      action1OrgName: trimValue(String(row.action1OrgName || '')),
      haloClientId: trimValue(String(row.haloClientId || '')),
      haloClientName: trimValue(String(row.haloClientName || '')),
      allowHaloClientToCreateAction1Org: false
    }))
    .filter((row) => row.mappingId && row.action1OrgId && row.haloClientId);
}

function buildRuntimeConfig(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const vulnerabilitySeverities = parseCsvList(settings.TicketingVulnerabilitySeverities, normalizeSignalSeverity);
  const updateSeverities = parseCsvList(settings.TicketingUpdateSeverities, normalizeSignalSeverity);
  const vulnerabilityEnabled = hasOwnSetting(settings, 'TicketingVulnerabilityEnabled')
    ? parseBoolean(settings.TicketingVulnerabilityEnabled, true) && vulnerabilitySeverities.length > 0
    : vulnerabilitySeverities.length > 0;
  const updateEnabled = hasOwnSetting(settings, 'TicketingUpdateEnabled')
    ? parseBoolean(settings.TicketingUpdateEnabled, true) && updateSeverities.length > 0
    : updateSeverities.length > 0;

  return {
    schemaVersion: 1,
    providerId: String(input.providerId || INITIAL_PROVIDER_ID).trim(),
    providerSettings: input.providerSettings && typeof input.providerSettings === 'object' ? { ...input.providerSettings } : {},
    connections: {
      action1: { ...DEFAULT_ACTION1_CONNECTION },
      halo: {
        resourceServer: trimValue(settings.TicketingResourceServer),
        authorisationServer: trimValue(settings.TicketingAuthorisationServer),
        tenant: '',
        clientId: trimValue(settings.TicketingClientId),
        clientSecretRef: trimValue(settings.TicketingClientSecret)
      }
    },
    ticketDestination: {
      teamId: trimValue(settings.TicketingTeamId),
      ticketTypeId: trimValue(settings.TicketingTicketTypeId),
      category1Id: trimValue(settings.TicketingCategory1Id),
      newStatusId: trimValue(settings.TicketingNewStatusId),
      closedStatusIds: parseCsvList(settings.TicketingClosedStatusIds)
    },
    lifecycle: {
      existingOpenTicketBehavior: normalizeExistingOpenTicketBehavior(settings.TicketingExistingOpenTicketBehavior),
      closeWhenSignalClears: parseBoolean(settings.TicketingCloseWhenSignalClears, true),
      createNewWhenLinkedClosed: parseBoolean(settings.TicketingCreateNewWhenLinkedClosed, true),
      reopenClosedTickets: false
    },
    signalFilters: {
      offline: {
        enabled: parseBoolean(settings.TicketingOfflineEnabled, true),
        thresholdDays: parsePositiveInteger(settings.TicketingOfflineThresholdDays, 7)
      },
      rebootRequired: {
        enabled: parseBoolean(settings.TicketingRebootRequiredEnabled, true),
        ageThresholdEnabled: parseBoolean(settings.TicketingRebootRequiredAgeThresholdEnabled, false),
        ageThresholdDays: parsePositiveInteger(settings.TicketingRebootRequiredAgeThresholdDays, 30)
      },
      automationFailed: {
        enabled: parseBoolean(settings.TicketingAutomationFailedEnabled, true),
        lookbackHours: parsePositiveInteger(
          settings.TicketingAutomationFailedLookbackHours,
          DEFAULT_AUTOMATION_FAILED_LOOKBACK_HOURS
        )
      },
      vulnerability: {
        enabled: vulnerabilityEnabled,
        severities: vulnerabilitySeverities,
        remediationStatuses: parseCsvList(settings.TicketingVulnerabilityRemediationStatuses, normalizeSignalSeverity)
      },
      update: {
        enabled: updateEnabled,
        severities: updateSeverities,
        remediationStatuses: parseCsvList(settings.TicketingUpdateRemediationStatuses, normalizeSignalSeverity)
      }
    },
    vulnerabilities: {
      ticketModel: normalizeTicketModel(settings.TicketingVulnerabilityTicketModel)
    },
    updates: {
      ticketModel: normalizeTicketModel(settings.TicketingUpdateTicketModel)
    },
    automationFailed: {
      ticketModel: normalizeTicketModel(settings.TicketingAutomationFailedTicketModel)
    },
    maxImpactedEndpointsInGroupedTicket: parsePositiveInteger(
      settings.TicketingMaxImpactedEndpointsInGroupedTicket,
      DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET
    ),
    orgClientMappings: normalizeMappingRows(input.mappings),
    provisioning: {
      haloClientOrgProvisioningEnabled: false,
      requireExplicitUserAction: true,
      dryRunPreviewEnabled: false
    },
    operationalSafeguards: {
      enableDebugLogging: parseBoolean(settings.TicketingDiagnosticLoggingEnabled, false),
      maxOpenTicketsPerOrganization: parsePositiveInteger(
        settings.TicketingMaxOpenTicketsPerOrganization,
        DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION
      )
    }
  };
}

async function readRuntimeSettings(context, keys = RUNTIME_SETTING_KEYS) {
  if (context?.settings && typeof context.settings.all === 'function') {
    const values = await context.settings.all(keys);
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      return Object.fromEntries(keys
        .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
        .map((key) => [key, values[key]]));
    }
  }

  const out = {};
  for (const key of keys) {
    out[key] = context?.settings && typeof context.settings.get === 'function' ? await context.settings.get(key) : '';
  }
  return out;
}

async function loadRuntimeConfig(context) {
  const settings = await readRuntimeSettings(context);
  const providerId = String(settings[ACTIVE_PROVIDER_KEY] || INITIAL_PROVIDER_ID).trim();
  const providerKeys = getOwnedSettingKeys(providerId);
  const providerSettings = providerKeys.length ? await readRuntimeSettings(context, providerKeys) : {};
  const mappings = await listMappings(context, providerId);

  return buildRuntimeConfig({
    settings,
    mappings,
    providerId,
    providerSettings
  });
}

module.exports = {
  DEFAULT_ACTION1_CONNECTION,
  EXISTING_OPEN_TICKET_BEHAVIOR,
  RUNTIME_SETTING_KEYS,
  buildRuntimeConfig,
  loadRuntimeConfig,
  normalizeExistingOpenTicketBehavior,
  normalizeMappingRows,
  normalizeTicketModel,
  parseBoolean,
  parseCsvList,
  parsePositiveInteger,
  readRuntimeSettings
};
