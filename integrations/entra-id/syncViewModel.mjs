import {
  CONNECTION_GROUP,
  SECRET_MASK,
  getSettingsGroup,
  isConnectionConfigured,
  resolveEffectiveSettings
} from './settingsResolver.mjs';
import { extractTrackedRunSummary } from './trackedRunSummary.mjs';
import settingsSchema from './ui/settingsSchema.json' with { type: 'json' };

export const DEFAULT_INTERVAL_HOURS = '24';
const TRACKED_SYNC_LABELS = new Set(['sync', 'run sync', 'run entra sync']);

const connectionSchema = getSettingsGroup(settingsSchema, CONNECTION_GROUP);

export function createEmptySummary() {
  return {
    mappedAction1OrganizationsProcessed: 0,
    failedOrganizations: 0,
    entraDevicesEvaluated: 0,
    action1EndpointsEvaluated: 0,
    endpointsSynchronized: 0,
    skipped: 0,
    failedEndpointUpdates: 0,
    finalStatus: '',
    trigger: '',
    finishedAt: ''
  };
}

export function scheduleKey(integration) {
  return `CronSchedule_${integration}`;
}

export function timezoneKey(integration) {
  return `CronTimezone_${integration}`;
}

export function parseSchedule(cron) {
  const normalized = String(cron || '').trim();
  if (!normalized) {
    return {
      enabled: false,
      intervalHours: DEFAULT_INTERVAL_HOURS,
      label: 'Disabled',
      cron: '',
      custom: false
    };
  }

  if (normalized === '0 */12 * * *') {
    return {
      enabled: true,
      intervalHours: '12',
      label: 'Every 12 hours',
      cron: normalized,
      custom: false
    };
  }

  if (normalized === '0 2 * * *') {
    return {
      enabled: true,
      intervalHours: '24',
      label: 'Every 24 hours',
      cron: normalized,
      custom: false
    };
  }

  return {
    enabled: true,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    label: 'Every 24 hours',
    cron: normalized,
    custom: true
  };
}

export function buildScheduleCron(enabled, intervalHours) {
  if (!enabled) {
    return '';
  }

  return intervalHours === '12' ? '0 */12 * * *' : '0 2 * * *';
}

export function parseSummary(details) {
  const extracted = extractTrackedRunSummary(details);
  return {
    ...createEmptySummary(),
    ...(extracted.summary && typeof extracted.summary === 'object' ? extracted.summary : {}),
    finishedAt: String(extracted.finishedAt || extracted.summary?.finishedAt || '').trim()
  };
}

function hasPersistedFinalStatus(summary) {
  return Boolean(String(summary?.finalStatus || '').trim());
}

export function selectLatestSyncRun(rows) {
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const actionId = String(row?.action_id || '').trim().toLowerCase();
    const actionLabel = String(row?.action_label || '').trim().toLowerCase();
    return actionId === 'sync' || TRACKED_SYNC_LABELS.has(actionLabel);
  }) || null;
}

export function formatDateTime(value) {
  if (!value) {
    return 'Not yet recorded';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not yet recorded';
  }

  return parsed.toLocaleString();
}

export function formatTrigger(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'scheduled') {
    return 'Scheduled';
  }
  if (normalized === 'manual') {
    return 'Manual';
  }
  return 'Not recorded';
}

export function normalizeRunStatus(rawStatus) {
  const value = String(rawStatus || '').trim().toLowerCase();

  if (!value) {
    return 'Never run';
  }
  if (value === 'running' || value === 'in progress') {
    return 'Running';
  }
  if (
    value === 'completedwithissues'
    || value === 'completed with issues'
    || value === 'partial'
    || value === 'mixed result'
  ) {
    return 'Completed with issues';
  }
  if (value === 'success' || value === 'completed' || value === 'succeeded') {
    return 'Success';
  }
  if (value === 'failure' || value === 'failed' || value === 'error') {
    return 'Failure';
  }

  return String(rawStatus || '').trim() || 'Never run';
}

export function getNextRunLabel(schedule) {
  if (!schedule?.enabled) {
    return 'Not scheduled';
  }

  if (schedule.intervalHours === '12') {
    return 'Marketplace will run this sync about every 12 hours.';
  }

  return 'Marketplace will run this sync about every 24 hours.';
}

export function buildSyncPageState({
  settingsPayload = {},
  mappingCount = 0,
  historyRows = [],
  canWrite = true
} = {}) {
  const storedSecrets = settingsPayload?.storedSecrets || {};
  const effectiveSettings = resolveEffectiveSettings(
    settingsSchema,
    settingsPayload?.settings || {},
    {
      storedSecrets,
      secretMask: SECRET_MASK
    }
  );
  const configured = isConnectionConfigured(connectionSchema, effectiveSettings, {
    storedSecrets,
    secretMask: SECRET_MASK
  });
  const latestRun = selectLatestSyncRun(historyRows);
  const parsedSummary = parseSummary(latestRun?.details);
  const latestSummary = {
    ...parsedSummary,
    finalStatus: hasPersistedFinalStatus(parsedSummary)
      ? String(parsedSummary.finalStatus).trim()
      : String(latestRun?.status || '').trim()
  };
  const latestRunTimestampValue = String(latestSummary.finishedAt || latestRun?.timestamp || '').trim();
  const latestRunTimestampLabel = latestSummary.finishedAt ? 'Finished' : 'Started';

  let state;
  if (!configured) {
    state = {
      label: 'Not configured',
      message: 'Complete the Microsoft Entra connection in Settings before you run Sync.'
    };
  } else if (mappingCount === 0) {
    state = {
      label: 'No mappings',
      message: 'Add at least one Action1 organization in Organization Mapping before you run Sync.'
    };
  } else {
    const status = String(latestRun?.status || '').trim().toLowerCase();
    if (status === 'running') {
      state = {
        label: 'Running',
        message: 'Another Sync run is already active. Wait for it to finish before starting a new run.'
      };
    } else if (!latestRun) {
      state = {
        label: 'Never run',
        message: 'Run Sync manually or enable scheduled sync when you are ready.'
      };
    } else {
      const displayStatus = normalizeRunStatus(latestSummary.finalStatus || latestRun?.status || 'Success');
      state = {
        label: displayStatus,
        message: 'Review the latest compact totals below and use History for detailed tracked-run logs.'
      };
    }
  }

  return {
    canMutate: canWrite,
    effectiveSettings,
    latestRun,
    latestRunTimestampLabel,
    latestRunTimestampValue,
    latestSummary,
    state,
    runDisabled: !canWrite || state.label === 'Running' || state.label === 'Not configured' || state.label === 'No mappings'
  };
}
