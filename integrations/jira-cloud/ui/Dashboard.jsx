import { useEffect, useState } from 'react';
import { extractTotals, formatDateTime, normalizeRunStatus } from '../historyViewModel.mjs';

const SYNC_ACTION_ID = 'sync';
const DEFAULT_INTERVAL_HOURS = '24';
const SUPPORTED_INTERVAL_OPTIONS = [
  { value: '3', label: 'Every 3 hours' },
  { value: '6', label: 'Every 6 hours' },
  { value: '12', label: 'Every 12 hours' },
  { value: '24', label: 'Every 24 hours' }
];
const TOTAL_METRICS = [
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Updated' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'failed', label: 'Failed' }
];

const styles = {
  page: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
    display: 'grid',
    gap: '0.5rem'
  },
  header: {
    display: 'grid',
    gap: '0.35rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    lineHeight: 1.2
  },
  description: {
    margin: 0,
    color: '#526173',
    fontSize: '0.92rem',
    lineHeight: 1.6,
    maxWidth: 760
  },
  card: {
    padding: '1.25rem',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.82)'
  },
  sectionTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.25
  },
  sectionSubtitle: {
    margin: '0.35rem 0 0',
    color: '#526173',
    fontSize: '0.92rem',
    lineHeight: 1.6
  },
  statusLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, auto)',
    gap: '1rem',
    alignItems: 'start'
  },
  statusCopy: {
    display: 'grid',
    gap: '0.45rem',
    color: '#334155',
    fontSize: '0.92rem',
    lineHeight: 1.6
  },
  statusRows: {
    display: 'grid',
    gap: '0.8rem',
    minWidth: 0
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem'
  },
  statusLabel: {
    color: '#334155',
    fontSize: '0.88rem'
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.28rem 0.7rem',
    borderRadius: 999,
    fontSize: '0.84rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    border: '1px solid transparent'
  },
  lastRunLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 360px)',
    gap: '1rem',
    alignItems: 'stretch'
  },
  keyValueList: {
    display: 'grid',
    gap: '0.75rem',
    marginTop: '1rem'
  },
  keyValueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.55rem',
    flexWrap: 'wrap',
    color: '#0F172A',
    fontSize: '0.92rem'
  },
  keyLabel: {
    color: '#334155'
  },
  buttonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginTop: '1rem'
  },
  totalsPanel: {
    borderLeft: '1px solid #E2E8F0',
    paddingLeft: '1rem',
    display: 'grid',
    alignContent: 'start',
    gap: '0.8rem'
  },
  totalsHeading: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.25
  },
  totalsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '0.4rem'
  },
  totalCell: {
    display: 'grid',
    justifyItems: 'center',
    gap: '0.35rem',
    padding: '0 0.4rem',
    borderLeft: '1px solid #E2E8F0'
  },
  totalLabel: {
    color: '#334155',
    fontSize: '0.9rem'
  },
  totalValue: {
    color: '#0B63F6',
    fontSize: '1.7rem',
    fontWeight: 700,
    lineHeight: 1
  },
  schedulerStack: {
    display: 'grid',
    gap: '1rem'
  },
  inlineLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.55rem',
    fontWeight: 600,
    color: '#0F172A'
  },
  field: {
    display: 'grid',
    gap: '0.45rem'
  },
  fieldLabel: {
    fontWeight: 700,
    color: '#0F172A',
    fontSize: '0.92rem'
  },
  select: {
    width: '100%',
    maxWidth: 240,
    padding: '0.7rem',
    border: '1px solid var(--border-color)',
    borderRadius: 6,
    background: '#fff'
  },
  statusText: {
    display: 'grid',
    gap: '0.35rem',
    color: '#526173',
    fontSize: '0.9rem'
  },
  message: {
    padding: '0.85rem 0.95rem',
    borderRadius: 8,
    fontSize: '0.9rem',
    lineHeight: 1.5
  },
  helperText: {
    color: '#526173',
    fontSize: '0.82rem',
    lineHeight: 1.5
  }
};

function scheduleKey(integration) {
  return `CronSchedule_${integration}`;
}

function timezoneKey(integration) {
  return `CronTimezone_${integration}`;
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function statusTone(status) {
  if (status === 'Completed') return { background: '#DCFCE7', color: '#166534' };
  if (status === 'Running') return { background: '#DBEAFE', color: '#1D4ED8' };
  if (status === 'Interrupted') return { background: '#FEF3C7', color: '#92400E' };
  if (status === 'Failed') return { background: '#FEE2E2', color: '#B91C1C' };
  return { background: '#F1F5F9', color: '#334155', borderColor: '#E2E8F0' };
}

function parseSchedule(cron) {
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

  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    return {
      enabled: true,
      intervalHours: 'custom',
      label: 'Enabled, custom Marketplace schedule',
      cron: normalized,
      custom: true
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const numericHour = /^\d+$/.test(hour);

  if (minute === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (/^\*\/(3|6|12)$/.test(hour)) {
      const intervalHours = hour.slice(2);
      return {
        enabled: true,
        intervalHours,
        label: `Enabled, every ${intervalHours} hours`,
        cron: normalized,
        custom: false
      };
    }

    if (numericHour) {
      return {
        enabled: true,
        intervalHours: DEFAULT_INTERVAL_HOURS,
        label: 'Enabled, every 24 hours',
        cron: normalized,
        custom: false
      };
    }
  }

  return {
    enabled: true,
    intervalHours: 'custom',
    label: 'Enabled, custom Marketplace schedule',
    cron: normalized,
    custom: true
  };
}

function buildScheduleCron(enabled, intervalHours, existingCron) {
  if (!enabled) {
    return '';
  }
  if (intervalHours === '3') {
    return '0 */3 * * *';
  }
  if (intervalHours === '6') {
    return '0 */6 * * *';
  }
  if (intervalHours === '12') {
    return '0 */12 * * *';
  }
  if (intervalHours === 'custom') {
    return String(existingCron || '').trim();
  }
  return '0 2 * * *';
}

function computeNextRun(schedule) {
  if (!schedule?.enabled) {
    return 'Not scheduled';
  }
  if (schedule.custom) {
    return 'Managed by the Marketplace cron schedule';
  }

  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setSeconds(0, 0);

  if (schedule.intervalHours === '24') {
    nextRun.setHours(2, 0, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    return nextRun.toLocaleString();
  }

  const interval = Number(schedule.intervalHours);
  if (!Number.isFinite(interval) || interval <= 0) {
    return 'Managed by the Marketplace cron schedule';
  }

  nextRun.setMinutes(0, 0, 0);
  const currentHour = nextRun.getHours();
  const currentBucket = Math.floor(currentHour / interval) * interval;
  nextRun.setHours(currentBucket, 0, 0, 0);

  if (nextRun <= now) {
    nextRun.setHours(nextRun.getHours() + interval);
  }

  return nextRun.toLocaleString();
}

function SchedulerStatus({ statusText }) {
  return (
    <div style={styles.statusText}>
      <div>Status: {statusText}</div>
    </div>
  );
}

function Dashboard({ integration }) {
  const [meta, setMeta] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [savedSchedule, setSavedSchedule] = useState(parseSchedule(''));
  const [schedulerDraft, setSchedulerDraft] = useState({
    enabled: false,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    timezone: browserTimezone(),
    existingCron: '',
    custom: false
  });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [runMessage, setRunMessage] = useState('');
  const [schedulerMessage, setSchedulerMessage] = useState('');
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [refreshingScheduler, setRefreshingScheduler] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [savingScheduler, setSavingScheduler] = useState(false);

  const syncRows = historyRows.filter((row) => {
    const actionId = String(row?.action_id || '').trim().toLowerCase();
    const actionLabel = String(row?.action_label || '').trim().toLowerCase();
    return actionId === SYNC_ACTION_ID || actionLabel === 'sync';
  });
  const latestRun = syncRows[0] || null;
  const lastFinishedRun = syncRows.find((row) => normalizeRunStatus(row?.status) !== 'Running') || null;
  const currentStatus = normalizeRunStatus(latestRun?.status);
  const runTotals = extractTotals(lastFinishedRun?.details);
  const scheduleStatusText = savedSchedule.label;
  const supportsSync = meta?.operations?.sync !== false;

  const loadPage = async (mode = 'initial') => {
    const isStatusRefresh = mode === 'status';
    const isSchedulerRefresh = mode === 'scheduler';

    if (mode === 'initial') {
      setLoading(true);
    }
    if (isStatusRefresh) {
      setRefreshingStatus(true);
    }
    if (isSchedulerRefresh) {
      setRefreshingScheduler(true);
    }

    try {
      setPageError('');

      const [metaResponse, settingsResponse, historyResponse] = await Promise.all([
        fetch(`/api/marketplace/${integration}`),
        fetch('/api/settings'),
        fetch(`/api/history?integration=${integration}&page=1&pageSize=20`)
      ]);

      const metaJson = await metaResponse.json().catch(() => ({}));
      const settingsJson = await settingsResponse.json().catch(() => ({}));
      const historyJson = await historyResponse.json().catch(() => ({}));

      if (!metaResponse.ok) {
        throw new Error(metaJson?.error || 'Unable to load Sync metadata.');
      }
      if (!settingsResponse.ok) {
        throw new Error(settingsJson?.error || 'Unable to load Marketplace scheduler settings.');
      }
      if (!historyResponse.ok) {
        throw new Error(historyJson?.error || 'Unable to load Marketplace sync history.');
      }

      const nextRows = Array.isArray(historyJson?.rows) ? historyJson.rows : [];
      const settings = settingsJson?.settings || {};
      const parsedSchedule = parseSchedule(settings[scheduleKey(integration)]);
      const resolvedTimezone = settings[timezoneKey(integration)] || browserTimezone();

      setMeta(metaJson);
      setHistoryRows(nextRows);
      setSavedSchedule(parsedSchedule);
      setSchedulerDraft({
        enabled: parsedSchedule.enabled,
        intervalHours: parsedSchedule.intervalHours,
        timezone: resolvedTimezone,
        existingCron: parsedSchedule.cron,
        custom: parsedSchedule.custom
      });
    } catch (error) {
      setPageError(error?.message || 'Unable to load the Jira Cloud Sync page.');
    } finally {
      setLoading(false);
      setRefreshingStatus(false);
      setRefreshingScheduler(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      await loadPage('initial');
    };

    load();
  }, [integration]);

  const refreshStatus = async () => {
    setRunMessage('');
    await loadPage('status');
  };

  const refreshSchedulerStatus = async () => {
    setSchedulerMessage('');
    await loadPage('scheduler');
  };

  const runNow = async () => {
    setRunningSync(true);
    setRunMessage('');

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => ({}));

      setRunMessage(data?.message || (response.ok ? 'Sync started.' : 'Unable to start Jira Cloud sync.'));
      await loadPage('status');
    } catch (error) {
      setRunMessage(error?.message || 'Unable to start Jira Cloud sync.');
    } finally {
      setRunningSync(false);
    }
  };

  const saveSchedulerSettings = async () => {
    setSavingScheduler(true);
    setSchedulerMessage('');

    const nextCron = buildScheduleCron(
      schedulerDraft.enabled,
      schedulerDraft.intervalHours,
      schedulerDraft.existingCron
    );

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _integration: integration,
          [scheduleKey(integration)]: nextCron,
          [timezoneKey(integration)]: schedulerDraft.timezone || browserTimezone()
        })
      });

      if (!response.ok) {
        throw new Error('Unable to save Jira Cloud scheduler settings.');
      }

      setSchedulerMessage('Scheduler settings saved.');
      await loadPage('scheduler');
    } catch (error) {
      setSchedulerMessage(error?.message || 'Unable to save Jira Cloud scheduler settings.');
    } finally {
      setSavingScheduler(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading sync...</div>;
  }

  const currentStatusTone = statusTone(currentStatus);
  const resultStatus = normalizeRunStatus(lastFinishedRun?.status);
  const resultTone = statusTone(resultStatus);
  const scheduleTone = statusTone(savedSchedule.enabled ? 'Completed' : 'Not started');
  const scheduleOptions = schedulerDraft.custom
    ? SUPPORTED_INTERVAL_OPTIONS.concat([{ value: 'custom', label: 'Custom Marketplace schedule' }])
    : SUPPORTED_INTERVAL_OPTIONS;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Sync</h1>
        <p style={styles.description}>
          Run synchronization, review the latest sync outcome, and manage the Marketplace schedule for this integration.
        </p>
      </div>

      {pageError && (
        <div style={{ ...styles.message, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          {pageError}
        </div>
      )}

      <div className="glass-panel" style={styles.card}>
        <div style={styles.statusLayout}>
          <div>
            <h2 style={styles.sectionTitle}>Sync Status</h2>
            <div style={{ ...styles.sectionSubtitle, marginTop: '0.7rem' }}>
              <div style={styles.statusCopy}>
                <div>Run now starts or continues the single active job.</div>
                <div>Scheduled sync uses the Marketplace schedule configured below.</div>
              </div>
            </div>
          </div>

          <div style={styles.statusRows}>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Current status:</span>
              <span style={{ ...styles.pill, ...currentStatusTone }}>{currentStatus}</span>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Scheduled sync:</span>
              <span style={{ ...styles.pill, ...scheduleTone }}>{scheduleStatusText}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={styles.card}>
        <div style={styles.lastRunLayout}>
          <div>
            <h2 style={styles.sectionTitle}>Last completed run</h2>
            <div style={styles.keyValueList}>
              <div style={styles.keyValueRow}>
                <span style={styles.keyLabel}>Finished:</span>
                <span>{formatDateTime(lastFinishedRun?.timestamp)}</span>
              </div>
              <div style={styles.keyValueRow}>
                <span style={styles.keyLabel}>Result:</span>
                <span style={{ ...styles.pill, ...resultTone }}>{resultStatus}</span>
              </div>
              <div style={styles.keyValueRow}>
                <span style={styles.keyLabel}>Assets processed:</span>
                <span>{Number(lastFinishedRun?.assets_processed || runTotals.assetsProcessed || 0).toLocaleString()}</span>
              </div>
            </div>
            <div style={styles.buttonRow}>
              <button className="btn-primary" type="button" onClick={runNow} disabled={runningSync || !supportsSync}>
                {runningSync ? 'Running...' : 'Run now'}
              </button>
              <button className="btn-secondary" type="button" onClick={refreshStatus} disabled={refreshingStatus}>
                {refreshingStatus ? 'Refreshing...' : 'Refresh status'}
              </button>
            </div>
            {runMessage && (
              <div
                style={{
                  ...styles.message,
                  marginTop: '0.9rem',
                  background: runMessage.toLowerCase().includes('unable') ? '#FEF2F2' : '#F8FAFC',
                  border: `1px solid ${runMessage.toLowerCase().includes('unable') ? '#FECACA' : '#E2E8F0'}`,
                  color: runMessage.toLowerCase().includes('unable') ? '#B91C1C' : '#334155'
                }}
              >
                {runMessage}
              </div>
            )}
          </div>

          <div style={styles.totalsPanel}>
            <h2 style={styles.totalsHeading}>Totals</h2>
            <div style={styles.totalsGrid}>
              {TOTAL_METRICS.map((metric, index) => (
                <div
                  key={metric.key}
                  style={{
                    ...styles.totalCell,
                    borderLeft: index === 0 ? '0' : styles.totalCell.borderLeft
                  }}
                >
                  <span style={styles.totalLabel}>{metric.label}</span>
                  <span style={styles.totalValue}>{Number(runTotals[metric.key] || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={styles.card}>
        <div style={styles.schedulerStack}>
          <div>
            <h2 style={styles.sectionTitle}>Scheduler</h2>
            <p style={styles.sectionSubtitle}>
              Manage the Marketplace schedule used for Jira Cloud synchronization.
            </p>
          </div>

          <label style={styles.inlineLabel}>
            <input
              type="checkbox"
              checked={schedulerDraft.enabled}
              onChange={(event) => setSchedulerDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>Enable scheduled sync</span>
          </label>

          <div style={styles.field}>
            <label style={styles.fieldLabel} htmlFor="jira-cloud-sync-interval">Run interval</label>
            <select
              id="jira-cloud-sync-interval"
              style={styles.select}
              value={schedulerDraft.intervalHours}
              onChange={(event) => setSchedulerDraft((current) => ({ ...current, intervalHours: event.target.value }))}
            >
              {scheduleOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {schedulerDraft.custom && (
              <div style={styles.helperText}>
                A custom Marketplace cron schedule is already saved. Choosing one of the supported intervals will replace it.
              </div>
            )}
          </div>

          <div style={styles.buttonRow}>
            <button className="btn-primary" type="button" onClick={saveSchedulerSettings} disabled={savingScheduler}>
              {savingScheduler ? 'Saving...' : 'Save scheduler settings'}
            </button>
            <button className="btn-secondary" type="button" onClick={refreshSchedulerStatus} disabled={refreshingScheduler}>
              {refreshingScheduler ? 'Refreshing...' : 'Refresh scheduler status'}
            </button>
          </div>

          <SchedulerStatus statusText={scheduleStatusText} />
          <div style={styles.statusText}>
            <div>Next run: {computeNextRun(savedSchedule)}</div>
          </div>

          {schedulerMessage && (
            <div
              style={{
                ...styles.message,
                background: schedulerMessage.toLowerCase().includes('unable') ? '#FEF2F2' : '#F0FDF4',
                border: `1px solid ${schedulerMessage.toLowerCase().includes('unable') ? '#FECACA' : '#BBF7D0'}`,
                color: schedulerMessage.toLowerCase().includes('unable') ? '#B91C1C' : '#166534'
              }}
            >
              {schedulerMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
