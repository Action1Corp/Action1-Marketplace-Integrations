import { useEffect, useState } from 'react';
import OperationStatus from './policies/OperationStatus.jsx';
import { formControlStyle, pageSurfaceStyle, policyUiTokens, primaryButtonStyle, secondaryButtonStyle } from './policies/policyUiStyles.js';

const SCHEDULE_KEY = 'CronSchedule_action1-configuration-manager';
const TIMEZONE_KEY = 'CronTimezone_action1-configuration-manager';
const INTERVALS = [3, 6, 12, 24];
const REPORTING_NOT_CONFIGURED = 'Not configured';
const REPORTING_CHECKING = 'Checking...';
const REPORTING_FAILED = 'Failed';

function browserTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
function cronForHours(hours) { return `0 */${hours} * * *`; }
function hoursFromCron(cron) {
  const match = String(cron || '').trim().match(/^0 \*\/(3|6|12|24) \* \* \*$/);
  return match ? Number(match[1]) : 6;
}

const styles = {
  shell: { ...pageSurfaceStyle, width: '100%', maxWidth: 960, margin: '0 auto', padding: '2rem 2.25rem', boxSizing: 'border-box', color: policyUiTokens.textPrimary },
  title: { margin: 0 },
  description: { margin: '0.5rem 0 0', color: policyUiTokens.textSecondary, fontSize: policyUiTokens.fontSizes.body, lineHeight: 1.5 },
  section: { borderTop: `1px solid ${policyUiTokens.borderColor}`, marginTop: '1.5rem', paddingTop: '1.5rem' },
  sectionTitle: { margin: 0, fontSize: policyUiTokens.fontSizes.section, fontWeight: 600 },
  sectionDescription: { margin: '0.5rem 0 1.1rem', color: policyUiTokens.textSecondary, fontSize: policyUiTokens.fontSizes.label, lineHeight: 1.45, maxWidth: 560 },
  label: { display: 'block', marginBottom: '0.4rem', fontSize: policyUiTokens.fontSizes.label, fontWeight: 600 },
  select: { ...formControlStyle, maxWidth: 'none' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem' },
  infoPanel: { borderLeft: `2px solid ${policyUiTokens.borderColor}`, paddingLeft: '1rem', minWidth: 0 },
  infoTitle: { margin: 0, color: policyUiTokens.textPrimary, fontSize: policyUiTokens.fontSizes.label, fontWeight: 600 },
  infoText: { margin: '0.55rem 0 0', color: policyUiTokens.textSecondary, fontSize: policyUiTokens.fontSizes.hint, lineHeight: 1.5 },
  reportingPanel: { ...pageSurfaceStyle, overflow: 'hidden' },
  reportingCallout: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', background: policyUiTokens.mutedBackground, padding: '0.85rem 1rem', borderBottom: `1px solid ${policyUiTokens.borderColor}` },
  calloutTitle: { margin: 0, fontSize: policyUiTokens.fontSizes.label, fontWeight: 600 },
  calloutText: { margin: '0.3rem 0 0', color: policyUiTokens.textSecondary, fontSize: policyUiTokens.fontSizes.hint, lineHeight: 1.45, maxWidth: 560 },
  reportingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.85rem 1rem' },
  reportingRowDivider: { borderTop: `1px solid ${policyUiTokens.borderColor}` },
  resourceName: { fontSize: policyUiTokens.fontSizes.label, fontWeight: 600 },
  resourceHelp: { margin: '0.2rem 0 0', color: policyUiTokens.textSecondary, fontSize: policyUiTokens.fontSizes.hint, lineHeight: 1.4 },
  status: { flex: '0 0 auto', color: policyUiTokens.textMuted, fontSize: policyUiTokens.fontSizes.hint, whiteSpace: 'nowrap' }
};

const SETTINGS_CSS = `
  .a1cm-settings-reconciliation { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 2.5rem; align-items: start; }
  @media (max-width: 720px) {
    .a1cm-settings-reconciliation { grid-template-columns: 1fr; gap: 1.5rem; }
    .a1cm-settings-reconciliation aside { border-left: 0; border-top: 1px solid ${policyUiTokens.borderColor}; padding: 1rem 0 0; }
    .a1cm-settings-reporting-callout { align-items: flex-start; flex-direction: column; }
  }
`;

export default function Settings({ integration }) {
  const [interval, setInterval] = useState(6);
  const [timezone, setTimezone] = useState(browserTimezone());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [message, setMessage] = useState(null);
  const [reporting, setReporting] = useState({ dataSource: REPORTING_CHECKING, reports: REPORTING_CHECKING });
  const [settingUpReporting, setSettingUpReporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/settings').then(response => response.json()),
      fetch(`/api/integrations/${integration}/actions/get-reporting-state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(response => response.json())
    ]).then(([data, stateResult]) => {
      if (cancelled) return;
      const settings = data.settings || {};
      setInterval(hoursFromCron(settings[SCHEDULE_KEY]));
      setTimezone(settings[TIMEZONE_KEY] || browserTimezone());
      const state = stateResult.reporting || {};
      const hasPersistedIds = Boolean(state.hasDataSourceId) || Boolean(state.reportIdsPresent?.length);
      setReporting(hasPersistedIds ? { dataSource: REPORTING_CHECKING, reports: REPORTING_CHECKING } : { dataSource: REPORTING_NOT_CONFIGURED, reports: REPORTING_NOT_CONFIGURED });
      setLoading(false);
      if (hasPersistedIds) {
        fetch(`/api/integrations/${integration}/actions/get-reporting-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
          .then(response => response.json()).then(result => { if (!cancelled) setReporting(result.reporting || { dataSource: REPORTING_FAILED, reports: REPORTING_FAILED }); })
          .catch(() => { if (!cancelled) setReporting({ dataSource: REPORTING_FAILED, reports: REPORTING_FAILED }); });
      }
    }).catch(() => {
      if (!cancelled) { setMessage({ ok: false, text: 'Unable to load reconciliation settings.' }); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [integration]);

  async function saveSchedule(event) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _integration: integration, [SCHEDULE_KEY]: cronForHours(interval), [TIMEZONE_KEY]: timezone || browserTimezone() }) });
      setMessage(response.ok ? { ok: true, text: 'Settings saved successfully.' } : { ok: false, text: 'Unable to save reconciliation settings.' });
    } catch (error) { setMessage({ ok: false, text: error.message || 'Unable to save reconciliation settings.' }); }
    finally { setSaving(false); }
  }

  async function setupReporting() {
    setSettingUpReporting(true); setMessage(null);
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/setup-reporting`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.message || 'Reporting setup failed.');
      setReporting(result.reporting || { dataSource: 'Configured', reports: 'Configured' });
      setMessage({ ok: true, text: 'Reporting setup completed.' });
    } catch (error) { setMessage({ ok: false, text: error.message || 'Reporting setup failed.' }); }
    finally { setSettingUpReporting(false); }
  }

  async function reconcileNow() {
    setReconciling(true); setMessage(null);
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/reconcile-policies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok && result.ok !== false ? { ok: true, text: 'Reconciliation completed.' } : { ok: false, text: result.message || 'Reconciliation failed.' });
    } catch (error) { setMessage({ ok: false, text: error.message || 'Reconciliation failed.' }); }
    finally { setReconciling(false); }
  }

  const reportingConfigured = reporting.dataSource === 'Configured' && reporting.reports === 'Configured';
  const reportingChecking = reporting.dataSource === REPORTING_CHECKING || reporting.reports === REPORTING_CHECKING;
  if (loading) return <div style={{ maxWidth: 960, margin: '0 auto' }}>Loading settings...</div>;

  return (
    <div style={styles.shell} data-integration={integration}>
      <style>{SETTINGS_CSS}</style>
      <h1 className="page-title" style={styles.title}>Settings</h1>
      <p style={styles.description}>Manage reconciliation scheduling and reporting for Action1 Configuration Manager.</p>

      <section style={styles.section}>
        <div className="a1cm-settings-reconciliation">
          <div>
            <h2 style={styles.sectionTitle}>Policy reconciliation</h2>
            <p style={styles.sectionDescription}>Automatically checks enabled policies and restores Action1 automations that were deleted outside Marketplace.</p>
            <form onSubmit={saveSchedule}>
              <label htmlFor="reconciliation-interval" style={styles.label}>Reconciliation interval</label>
              <select id="reconciliation-interval" value={interval} onChange={event => setInterval(Number(event.target.value))} style={styles.select}>
                {INTERVALS.map(hours => <option key={hours} value={hours}>Every {hours} hours</option>)}
              </select>
              <div style={styles.actions}>
                <button style={primaryButtonStyle} type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
                <button style={secondaryButtonStyle} type="button" onClick={reconcileNow} disabled={reconciling}>Reconcile now</button>
              </div>
            </form>
          </div>
          <aside style={styles.infoPanel} aria-label="How reconciliation works">
            <h3 style={styles.infoTitle}>How reconciliation works</h3>
            <p style={styles.infoText}>Marketplace checks all Enabled policies on the selected schedule.</p>
            <p style={styles.infoText}>If an Action1 automation created by a policy is missing, Marketplace recreates it automatically.</p>
            <p style={styles.infoText}>Only Enabled policies are checked.</p>
          </aside>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Reporting</h2>
        <p style={styles.sectionDescription}>Set up Action1 Data Source and Reports to view Configuration Manager results in the Action1 Console.</p>
        <div style={styles.reportingPanel}>
          {!reportingConfigured && !reportingChecking ? <div className="a1cm-settings-reporting-callout" style={styles.reportingCallout}>
            <div>
              <h3 style={styles.calloutTitle}>Enable reporting in Action1</h3>
              <p style={styles.calloutText}>We will create the Data Source and Reports required to view Configuration Manager results in the Action1 Console. After setup, open the Action1 Console to view your reports.</p>
            </div>
            <button style={primaryButtonStyle} type="button" onClick={setupReporting} disabled={settingUpReporting}>{settingUpReporting ? 'Setting up reporting...' : 'Set up reporting'}</button>
          </div> : null}
          <div style={styles.reportingRow}><div><div style={styles.resourceName}>Data source</div><p style={styles.resourceHelp}>Required to collect and store Configuration Manager data in Action1.</p></div><span style={styles.status}>{reporting.dataSource}</span></div>
          <div style={{ ...styles.reportingRow, ...styles.reportingRowDivider }}><div><div style={styles.resourceName}>Reports</div><p style={styles.resourceHelp}>Custom Action1 reports for viewing Configuration Manager data.</p></div><span style={styles.status}>{reporting.reports}</span></div>
        </div>
      </section>

      {message && <div role="status" style={{ marginTop: '1rem', color: message.ok ? '#15803D' : '#DC2626' }}>{message.text}</div>}
      <OperationStatus label={reconciling ? 'Reconciliation in progress…' : ''} />
    </div>
  );
}
