const settingsSchema = require('./ui/settingsSchema.json');
const { listMappings } = require('./mappingStore');
const { EXISTING_OPEN_ISSUE_BEHAVIOR } = require('./lifecycle');

const DEFAULT_ACTION1_CONNECTION = Object.freeze({
  baseUrl: '',
  clientId: '',
  clientSecretRef: ''
});

const DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET = 25;
const DEFAULT_MAX_OPEN_TICKETS_PER_ORGANIZATION = 30;
const DEFAULT_AUTOMATION_FAILED_LOOKBACK_HOURS = 24;
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

function normalizeExistingOpenIssueBehavior(value) {
  return trimValue(String(value || '')).toLowerCase() === EXISTING_OPEN_ISSUE_BEHAVIOR.SKIP_EXISTING_OPEN
    ? EXISTING_OPEN_ISSUE_BEHAVIOR.SKIP_EXISTING_OPEN
    : EXISTING_OPEN_ISSUE_BEHAVIOR.UPDATE_EXISTING_OPEN;
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
      jiraProjectId: trimValue(String(row.jiraProjectId || '')),
      jiraProjectKey: trimValue(String(row.jiraProjectKey || '')),
      jiraProjectName: trimValue(String(row.jiraProjectName || '')),
      jiraIssueTypeId: trimValue(String(row.jiraIssueTypeId || '')),
      jiraIssueTypeName: trimValue(String(row.jiraIssueTypeName || ''))
    }))
    .filter((row) => row.mappingId && row.action1OrgId && row.jiraProjectId && row.jiraIssueTypeId);
}

function buildRuntimeConfig(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const vulnerabilitySeverities = parseCsvList(settings.JiraCloudVulnerabilitySeverities, normalizeSignalSeverity);
  const updateSeverities = parseCsvList(settings.JiraCloudUpdateSeverities, normalizeSignalSeverity);
  const vulnerabilityEnabled = hasOwnSetting(settings, 'JiraCloudVulnerabilityEnabled')
    ? parseBoolean(settings.JiraCloudVulnerabilityEnabled, true) && vulnerabilitySeverities.length > 0
    : vulnerabilitySeverities.length > 0;
  const updateEnabled = hasOwnSetting(settings, 'JiraCloudUpdateEnabled')
    ? parseBoolean(settings.JiraCloudUpdateEnabled, true) && updateSeverities.length > 0
    : updateSeverities.length > 0;

  return {
    schemaVersion: 1,
    connections: {
      action1: { ...DEFAULT_ACTION1_CONNECTION },
      jira: {
        siteUrl: trimValue(settings.JiraCloudSiteUrl).replace(/\/+$/, ''),
        email: trimValue(settings.JiraCloudUserEmail),
        apiTokenRef: trimValue(settings.JiraCloudApiToken)
      }
    },
    lifecycle: {
      existingOpenIssueBehavior: normalizeExistingOpenIssueBehavior(settings.JiraCloudExistingOpenIssueBehavior),
      closeWhenSignalClears: parseBoolean(settings.JiraCloudCloseWhenSignalClears, false),
      createNewWhenLinkedClosed: parseBoolean(settings.JiraCloudCreateNewWhenLinkedCompleted, true),
      reopenClosedTickets: false
    },
    signalFilters: {
      offline: {
        enabled: hasOwnSetting(settings, 'JiraCloudOfflineEnabled')
          ? parseBoolean(settings.JiraCloudOfflineEnabled, true)
          : true,
        thresholdDays: parsePositiveInteger(settings.JiraCloudOfflineThresholdDays, 7)
      },
      rebootRequired: {
        enabled: hasOwnSetting(settings, 'JiraCloudRebootRequiredEnabled')
          ? parseBoolean(settings.JiraCloudRebootRequiredEnabled, true)
          : true
      },
      automationFailed: {
        enabled: hasOwnSetting(settings, 'JiraCloudAutomationFailedEnabled')
          ? parseBoolean(settings.JiraCloudAutomationFailedEnabled, true)
          : true,
        lookbackHours: parsePositiveInteger(settings.JiraCloudAutomationFailedLookbackHours, DEFAULT_AUTOMATION_FAILED_LOOKBACK_HOURS)
      },
      vulnerability: {
        enabled: hasOwnSetting(settings, 'JiraCloudVulnerabilityEnabled')
          ? parseBoolean(settings.JiraCloudVulnerabilityEnabled, true) && vulnerabilitySeverities.length > 0
          : vulnerabilityEnabled,
        severities: vulnerabilitySeverities,
        remediationStatuses: parseCsvList(settings.JiraCloudVulnerabilityRemediationStatuses, normalizeSignalSeverity)
      },
      update: {
        enabled: hasOwnSetting(settings, 'JiraCloudUpdateEnabled')
          ? parseBoolean(settings.JiraCloudUpdateEnabled, true) && updateSeverities.length > 0
          : updateEnabled,
        severities: updateSeverities,
        remediationStatuses: parseCsvList(settings.JiraCloudUpdateRemediationStatuses, normalizeSignalSeverity)
      }
    },
    vulnerabilities: {
      ticketModel: normalizeTicketModel(settings.JiraCloudVulnerabilityTicketModel)
    },
    updates: {
      ticketModel: normalizeTicketModel(settings.JiraCloudUpdateTicketModel)
    },
    automationFailed: {
      ticketModel: normalizeTicketModel(settings.JiraCloudAutomationFailedTicketModel)
    },
    maxImpactedEndpointsInGroupedTicket: parsePositiveInteger(
      settings.JiraCloudMaxImpactedEndpointsInGroupedTicket,
      DEFAULT_MAX_IMPACTED_ENDPOINTS_IN_GROUPED_TICKET
    ),
    orgProjectMappings: normalizeMappingRows(input.mappings),
    operationalSafeguards: {
      enableDebugLogging: parseBoolean(settings.JiraCloudDiagnosticLoggingEnabled, false),
      maxOpenTicketsPerOrganization: parsePositiveInteger(
        settings.JiraCloudMaxOpenTicketsPerOrganization,
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
  RUNTIME_SETTING_KEYS,
  buildRuntimeConfig,
  loadRuntimeConfig,
  normalizeExistingOpenIssueBehavior,
  normalizeMappingRows,
  normalizeTicketModel,
  parseBoolean,
  parseCsvList,
  parsePositiveInteger,
  readRuntimeSettings
};
