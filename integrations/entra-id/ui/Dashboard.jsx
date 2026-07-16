import { useEffect, useMemo, useState } from 'react';
import {
  buildScheduleCron,
  buildSyncPageState,
  formatDateTime,
  formatTrigger,
  getNextRunLabel,
  normalizeRunStatus,
  parseSchedule,
  scheduleKey,
  timezoneKey
} from '../syncViewModel.mjs';

const MAPPING_ACTION_ID = 'list-entra-org-mappings';
const INITIAL_SETTINGS_PAYLOAD = { settings: {}, storedSecrets: {} };
const TOTALS_HELP_TEXT = [
  'Synced — Action1 endpoints successfully updated with Microsoft Entra group and ownership data.',
  'Skipped — devices not updated because no unique name match was found, including unmatched, ambiguous, or endpoint-reuse conflicts.',
  'Failed — matched Action1 endpoints whose update returned an endpoint-specific error; review run diagnostics for details.'
].join('\n');

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
  statusValue: {
    fontWeight: 500
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
    gridTemplateColumns: 'minmax(0, 1fr) minmax(440px, 480px)',
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
  totalsHeadingRow: {
    display: 'inline-flex',
    alignItems: 'center'
  },
  totalsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(92px, 1fr))',
    gap: '0.75rem'
  },
  totalCell: {
    display: 'grid',
    justifyItems: 'center',
    gap: '0.45rem',
    padding: '0 0.55rem',
    borderLeft: '1px solid #E2E8F0'
  },
  totalLabel: {
    color: '#334155',
    fontSize: '0.9rem',
    textAlign: 'center',
    lineHeight: 1.35,
    whiteSpace: 'nowrap'
  },
  totalValue: {
    color: '#0B63F6',
    fontSize: '1.7rem',
    fontWeight: 700,
    lineHeight: 1
  },
  infoTip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    marginLeft: '0.4rem',
    borderRadius: '999px',
    border: '1px solid #CBD5E1',
    color: '#475569',
    fontSize: '0.7rem',
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'help',
    background: '#F8FAFC',
    verticalAlign: 'middle'
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
  }
};

function statusTone(status) {
  if (status === 'Success') return { background: '#DCFCE7', color: '#166534' };
  if (status === 'Running') return { background: '#DBEAFE', color: '#1D4ED8' };
  if (status === 'Completed with issues') return { background: '#FEF3C7', color: '#92400E' };
  if (status === 'Failure') return { background: '#FEE2E2', color: '#B91C1C' };
  return { background: '#F1F5F9', color: '#334155', borderColor: '#E2E8F0' };
}

function statusTextTone(status) {
  if (status === 'Success') return { color: '#166534' };
  if (status === 'Running') return { color: '#1D4ED8' };
  if (status === 'Completed with issues') return { color: '#92400E' };
  if (status === 'Failure') return { color: '#B91C1C' };
  return { color: '#334155' };
}

function FeedbackMessage({ feedback }) {
  if (!feedback?.text) {
    return null;
  }

  const danger = feedback.tone === 'error';
  return (
    <div
      style={{
        ...styles.message,
        background: danger ? '#FEF2F2' : '#F8FAFC',
        border: `1px solid ${danger ? '#FECACA' : '#E2E8F0'}`,
        color: danger ? '#B91C1C' : '#334155'
      }}
    >
      {feedback.text}
    </div>
  );
}

function InfoTip({ text }) {
  return (
    <span
      className="entra-sync-info-tip"
      tabIndex={0}
      title={text}
      aria-label="Totals help"
      style={styles.infoTip}
    >
      i
    </span>
  );
}

function Dashboard({ integration, screen = {} }) {
  const [settingsPayload, setSettingsPayload] = useState(INITIAL_SETTINGS_PAYLOAD);
  const [mappingCount, setMappingCount] = useState(0);
  const [historyRows, setHistoryRows] = useState([]);
  const [savedSchedule, setSavedSchedule] = useState(parseSchedule(''));
  const [schedulerDraft, setSchedulerDraft] = useState({
    enabled: false,
    intervalHours: '24'
  });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [runFeedback, setRunFeedback] = useState(null);
  const [schedulerFeedback, setSchedulerFeedback] = useState(null);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [refreshingScheduler, setRefreshingScheduler] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [savingScheduler, setSavingScheduler] = useState(false);

  const syncPageState = useMemo(() => buildSyncPageState({
    settingsPayload,
    mappingCount,
    historyRows,
    canWrite: screen?.canWrite !== false
  }), [historyRows, mappingCount, screen?.canWrite, settingsPayload]);

  useEffect(() => {
    if (!runFeedback?.text || runFeedback.tone === 'error') {
      return undefined;
    }

    const timer = setTimeout(() => setRunFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [runFeedback]);

  useEffect(() => {
    if (!schedulerFeedback?.text || schedulerFeedback.tone === 'error') {
      return undefined;
    }

    const timer = setTimeout(() => setSchedulerFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [schedulerFeedback]);

  const loadPage = async (mode = 'initial') => {
    if (mode === 'initial') {
      setLoading(true);
    }
    if (mode === 'status') {
      setRefreshingStatus(true);
    }
    if (mode === 'scheduler') {
      setRefreshingScheduler(true);
    }

    try {
      setPageError('');

      const [settingsResponse, historyResponse, mappingsResponse] = await Promise.all([
        fetch('/api/settings'),
        fetch(`/api/history?integration=${integration}&page=1&pageSize=20`),
        fetch(`/api/integrations/${integration}/actions/${MAPPING_ACTION_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        })
      ]);

      const settingsJson = await settingsResponse.json().catch(() => ({}));
      const historyJson = await historyResponse.json().catch(() => ({}));
      const mappingsJson = await mappingsResponse.json().catch(() => ({}));

      if (!settingsResponse.ok) {
        throw new Error(settingsJson?.error || 'Unable to load Microsoft Entra settings.');
      }
      if (!historyResponse.ok) {
        throw new Error(historyJson?.error || 'Unable to load Marketplace sync history.');
      }
      if (!mappingsResponse.ok || mappingsJson?.ok === false) {
        throw new Error(mappingsJson?.message || 'Unable to load Action1 organization mappings.');
      }

      const nextPayload = {
        settings: settingsJson?.settings || {},
        storedSecrets: settingsJson?.storedSecrets || {}
      };
      const nextRows = Array.isArray(historyJson?.rows) ? historyJson.rows : [];
      const nextMappingCount = Array.isArray(mappingsJson?.mappings) ? mappingsJson.mappings.length : 0;
      const nextSavedSchedule = parseSchedule(nextPayload.settings[scheduleKey(integration)]);

      setSettingsPayload(nextPayload);
      setHistoryRows(nextRows);
      setMappingCount(nextMappingCount);
      setSavedSchedule(nextSavedSchedule);
      setSchedulerDraft({
        enabled: nextSavedSchedule.enabled,
        intervalHours: nextSavedSchedule.intervalHours
      });
    } catch (error) {
      setPageError(error?.message || 'Unable to load the Microsoft Entra Sync page.');
      setSettingsPayload(INITIAL_SETTINGS_PAYLOAD);
      setHistoryRows([]);
      setMappingCount(0);
      setSavedSchedule(parseSchedule(''));
      setSchedulerDraft({
        enabled: false,
        intervalHours: '24'
      });
    } finally {
      setLoading(false);
      setRefreshingStatus(false);
      setRefreshingScheduler(false);
    }
  };

  useEffect(() => {
    loadPage('initial');
  }, [integration]);

  const refreshStatus = async () => {
    setRunFeedback(null);
    await loadPage('status');
  };

  const refreshSchedulerStatus = async () => {
    setSchedulerFeedback(null);
    await loadPage('scheduler');
  };

  const runSync = async () => {
    setRunningSync(true);
    setRunFeedback(null);

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' })
      });
      const data = await response.json().catch(() => ({}));

      setRunFeedback({
        text: data?.message || (response.ok ? 'Sync started.' : 'Unable to start Sync.'),
        tone: response.ok ? 'success' : 'error'
      });
      await loadPage('status');
    } catch (error) {
      setRunFeedback({
        text: error?.message || 'Unable to start Sync.',
        tone: 'error'
      });
    } finally {
      setRunningSync(false);
    }
  };

  const saveSchedulerSettings = async () => {
    setSavingScheduler(true);
    setSchedulerFeedback(null);

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _integration: integration,
          [scheduleKey(integration)]: buildScheduleCron(schedulerDraft.enabled, schedulerDraft.intervalHours),
          [timezoneKey(integration)]: 'UTC'
        })
      });

      if (!response.ok) {
        throw new Error('Unable to save scheduler settings.');
      }

      setSchedulerFeedback({
        text: 'Scheduler updated.',
        tone: 'success'
      });
      await loadPage('scheduler');
    } catch (error) {
      setSchedulerFeedback({
        text: error?.message || 'Unable to save scheduler settings.',
        tone: 'error'
      });
    } finally {
      setSavingScheduler(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading sync...</div>;
  }

  const { latestSummary, latestRunTimestampLabel, latestRunTimestampValue, runDisabled, state } = syncPageState;
  const stateTone = statusTextTone(state.label);
  const resultLabel = normalizeRunStatus(latestSummary.finalStatus || state.label || 'Never run');
  const resultTone = statusTextTone(resultLabel);
  const schedulePill = statusTone(savedSchedule.enabled ? 'Success' : 'Never run');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Microsoft Entra Device Groups Sync</h1>
        <p style={styles.description}>
          Run and monitor synchronization of Microsoft Entra device groups and ownership into Action1 endpoint custom attributes.
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
            <p style={{ ...styles.sectionSubtitle, marginTop: '0.7rem' }}>
              Run synchronization and monitor the latest synchronization status.
            </p>
          </div>

          <div style={styles.statusRows}>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Current state:</span>
              <span style={{ ...styles.statusValue, ...stateTone }}>{state.label}</span>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Scheduled sync:</span>
              <span style={{ ...styles.pill, ...schedulePill }}>{savedSchedule.label}</span>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Mapped organizations:</span>
              <span>{Number(mappingCount || 0).toLocaleString()}</span>
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
                <span style={styles.keyLabel}>{latestRunTimestampLabel}:</span>
                <span>{formatDateTime(latestRunTimestampValue)}</span>
              </div>
              <div style={styles.keyValueRow}>
                <span style={styles.keyLabel}>Result:</span>
                <span style={{ ...styles.statusValue, ...resultTone }}>{resultLabel}</span>
              </div>
              <div style={styles.keyValueRow}>
                <span style={styles.keyLabel}>Trigger:</span>
                <span>{formatTrigger(latestSummary.trigger)}</span>
              </div>
            </div>
            <div style={styles.buttonRow}>
              <button className="btn-primary" type="button" onClick={runSync} disabled={runningSync || runDisabled}>
                {runningSync ? 'Syncing...' : 'Run Sync'}
              </button>
              <button className="btn-secondary" type="button" onClick={refreshStatus} disabled={refreshingStatus}>
                {refreshingStatus ? 'Refreshing...' : 'Refresh status'}
              </button>
            </div>
            <div style={{ marginTop: '0.9rem' }}>
              <FeedbackMessage feedback={runFeedback} />
            </div>
          </div>

          <div style={styles.totalsPanel}>
            <div style={styles.totalsHeadingRow}>
              <h2 style={styles.totalsHeading}>Totals</h2>
              <InfoTip text={TOTALS_HELP_TEXT} />
            </div>
            <div style={styles.totalsGrid}>
              {[
                { label: 'Synced', value: latestSummary.endpointsSynchronized },
                { label: 'Skipped', value: latestSummary.skipped },
                { label: 'Failed', value: latestSummary.failedEndpointUpdates }
              ].map((metric, index) => (
                <div
                  key={metric.label}
                  style={{
                    ...styles.totalCell,
                    borderLeft: index === 0 ? '0' : styles.totalCell.borderLeft
                  }}
                >
                  <span style={styles.totalLabel}>{metric.label}</span>
                  <span style={styles.totalValue}>{Number(metric.value || 0).toLocaleString()}</span>
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
              Manage the Marketplace schedule used for Microsoft Entra synchronization.
            </p>
          </div>

          <label style={styles.inlineLabel}>
            <input
              type="checkbox"
              checked={schedulerDraft.enabled}
              disabled={!syncPageState.canMutate}
              onChange={(event) => setSchedulerDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>Enable scheduled sync</span>
          </label>

          <div style={styles.field}>
            <label style={styles.fieldLabel} htmlFor="entra-id-sync-interval">Run interval</label>
            <select
              id="entra-id-sync-interval"
              style={styles.select}
              value={schedulerDraft.intervalHours}
              disabled={!syncPageState.canMutate || !schedulerDraft.enabled}
              onChange={(event) => setSchedulerDraft((current) => ({ ...current, intervalHours: event.target.value }))}
            >
              <option value="24">Every 24 hours</option>
              <option value="12">Every 12 hours</option>
            </select>
          </div>

          <div style={styles.buttonRow}>
            <button className="btn-primary" type="button" onClick={saveSchedulerSettings} disabled={!syncPageState.canMutate || savingScheduler}>
              {savingScheduler ? 'Saving...' : 'Save scheduler settings'}
            </button>
            <button className="btn-secondary" type="button" onClick={refreshSchedulerStatus} disabled={refreshingScheduler}>
              {refreshingScheduler ? 'Refreshing...' : 'Refresh scheduler status'}
            </button>
          </div>

          <div style={styles.statusText}>
            <div>Status: {savedSchedule.enabled ? 'Enabled' : 'Disabled'}</div>
            {savedSchedule.enabled && (
              <div>Next run: {getNextRunLabel(savedSchedule)}</div>
            )}
          </div>

          <FeedbackMessage feedback={schedulerFeedback} />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
