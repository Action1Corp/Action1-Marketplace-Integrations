const settingsSchema = require('./ui/settingsSchema.json');
const { ACTION1_BASE_URL } = require('./action1Api');
const { listMappings } = require('./mappingStore');

const EXISTING_OPEN_TICKET_BEHAVIOR = Object.freeze({
  UPDATE_EXISTING_OPEN: 'update_existing_open',
  SKIP_EXISTING_OPEN: 'skip_existing_open'
});

const DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET = 25;
const DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION = 30;
const DEFAULT_AUTOMATION_FAILED_LOOKBACK_HOURS = 24;
const DEFAULT_ACTION1_CONNECTION = Object.freeze({
  baseUrl: ACTION1_BASE_URL,
  clientId: '',
  clientSecretRef: ''
});

const RUNTIME_SETTING_KEYS = settingsSchema.map((field) => String(field.key || '').trim()).filter(Boolean);

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
  const vulnerabilitySeverities = parseCsvList(settings.HaloPsaVulnerabilitySeverities, normalizeSignalSeverity);
  const updateSeverities = parseCsvList(settings.HaloPsaUpdateSeverities, normalizeSignalSeverity);
  const vulnerabilityEnabled = hasOwnSetting(settings, 'HaloPsaVulnerabilityEnabled')
    ? parseBoolean(settings.HaloPsaVulnerabilityEnabled, true) && vulnerabilitySeverities.length > 0
    : vulnerabilitySeverities.length > 0;
  const updateEnabled = hasOwnSetting(settings, 'HaloPsaUpdateEnabled')
    ? parseBoolean(settings.HaloPsaUpdateEnabled, true) && updateSeverities.length > 0
    : updateSeverities.length > 0;

  return {
    schemaVersion: 1,
    connections: {
      action1: { ...DEFAULT_ACTION1_CONNECTION },
      halo: {
        resourceServer: trimValue(settings.HaloPsaResourceServer),
        authorisationServer: trimValue(settings.HaloPsaAuthorisationServer),
        tenant: '',
        clientId: trimValue(settings.HaloPsaClientId),
        clientSecretRef: trimValue(settings.HaloPsaClientSecret)
      }
    },
    ticketDestination: {
      teamId: trimValue(settings.HaloPsaTeamId),
      ticketTypeId: trimValue(settings.HaloPsaTicketTypeId),
      category1Id: trimValue(settings.HaloPsaCategory1Id),
      newStatusId: trimValue(settings.HaloPsaNewStatusId),
      closedStatusIds: parseCsvList(settings.HaloPsaClosedStatusIds)
    },
    lifecycle: {
      existingOpenTicketBehavior: normalizeExistingOpenTicketBehavior(settings.HaloPsaExistingOpenTicketBehavior),
      closeWhenSignalClears: parseBoolean(settings.HaloPsaCloseWhenSignalClears, true),
      createNewWhenLinkedClosed: parseBoolean(settings.HaloPsaCreateNewWhenLinkedClosed, true),
      reopenClosedTickets: false
    },
    signalFilters: {
      offline: {
        enabled: parseBoolean(settings.HaloPsaOfflineEnabled, true),
        thresholdDays: parsePositiveInteger(settings.HaloPsaOfflineThresholdDays, 7)
      },
      rebootRequired: {
        enabled: parseBoolean(settings.HaloPsaRebootRequiredEnabled, true)
      },
      automationFailed: {
        enabled: parseBoolean(settings.HaloPsaAutomationFailedEnabled, true),
        lookbackHours: parsePositiveInteger(
          settings.HaloPsaAutomationFailedLookbackHours,
          DEFAULT_AUTOMATION_FAILED_LOOKBACK_HOURS
        )
      },
      vulnerability: {
        enabled: vulnerabilityEnabled,
        severities: vulnerabilitySeverities,
        remediationStatuses: parseCsvList(settings.HaloPsaVulnerabilityRemediationStatuses, normalizeSignalSeverity)
      },
      update: {
        enabled: updateEnabled,
        severities: updateSeverities,
        remediationStatuses: parseCsvList(settings.HaloPsaUpdateRemediationStatuses, normalizeSignalSeverity)
      }
    },
    vulnerabilities: {
      ticketModel: normalizeTicketModel(settings.HaloPsaVulnerabilityTicketModel)
    },
    updates: {
      ticketModel: normalizeTicketModel(settings.HaloPsaUpdateTicketModel)
    },
    automationFailed: {
      ticketModel: normalizeTicketModel(settings.HaloPsaAutomationFailedTicketModel)
    },
    maxImpactedEndpointsInGroupedTicket: parsePositiveInteger(
      settings.HaloPsaMaxImpactedEndpointsInGroupedTicket,
      DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET
    ),
    orgClientMappings: normalizeMappingRows(input.mappings),
    provisioning: {
      haloClientOrgProvisioningEnabled: false,
      requireExplicitUserAction: true,
      dryRunPreviewEnabled: false
    },
    operationalSafeguards: {
      enableDebugLogging: parseBoolean(settings.HaloPsaDiagnosticLoggingEnabled, false),
      maxOpenTicketsPerOrganization: parsePositiveInteger(
        settings.HaloPsaMaxOpenTicketsPerOrganization,
        DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION
      )
    }
  };
}

async function readRuntimeSettings(context) {
  if (context?.settings && typeof context.settings.all === 'function') {
    const values = await context.settings.all(RUNTIME_SETTING_KEYS);
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      return values;
    }
  }

  const out = {};
  for (const key of RUNTIME_SETTING_KEYS) {
    out[key] = context?.settings && typeof context.settings.get === 'function' ? await context.settings.get(key) : '';
  }
  return out;
}

async function loadRuntimeConfig(context) {
  const [settings, mappings] = await Promise.all([
    readRuntimeSettings(context),
    listMappings(context)
  ]);

  return buildRuntimeConfig({
    settings,
    mappings
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
