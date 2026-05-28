import { Link, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 50;
const SECRET_MASK = '***';
const WEEKDAYS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' }
];

function tokenText(value, integrationName) {
  return String(value || '').replaceAll('{integrationName}', integrationName);
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function scheduleKey(integration) {
  return `CronSchedule_${integration}`;
}

function timezoneKey(integration) {
  return `CronTimezone_${integration}`;
}

function cronToSchedule(cron) {
  const normalized = (cron || '').trim();
  const base = { enabled: !!normalized, mode: 'days', time: '02:00', days: ['1', '2', '3', '4', '5'], custom: normalized };
  if (!normalized) return base;
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return { ...base, mode: 'custom' };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const numericTime = /^\d+$/.test(hour) && /^\d+$/.test(minute);
  const time = numericTime ? `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}` : base.time;
  if (dayOfMonth !== '*' || month !== '*' || !numericTime) return { ...base, mode: 'custom' };
  if (dayOfWeek === '*') return { ...base, mode: 'days', time, days: ['0', '1', '2', '3', '4', '5', '6'] };
  if (dayOfWeek === '1-5') return { ...base, mode: 'days', time, days: ['1', '2', '3', '4', '5'] };
  if (/^[0-6](,[0-6])*$/.test(dayOfWeek)) return { ...base, mode: 'days', time, days: dayOfWeek.split(',') };
  return { ...base, mode: 'custom' };
}

function scheduleToCron(schedule) {
  if (!schedule.enabled) return '';
  if (schedule.mode === 'custom') return schedule.custom.trim();
  const selectedDays = [...schedule.days].sort((a, b) => Number(a) - Number(b));
  if (selectedDays.length === 0) return '';
  const [hour, minute] = schedule.time.split(':');
  const dayExpression = selectedDays.length === 7 ? '*' : selectedDays.join(',');
  return `${Number(minute)} ${Number(hour)} * * ${dayExpression}`;
}

function metricValue(metric, stats) {
  const remediationTotal = (stats.totalPatchable || 0) + (stats.totalNotPatchable || 0) + (stats.totalUnrecognized || 0);
  const severityTotal = (stats.totalCritical || 0) + (stats.totalHigh || 0) + (stats.totalMedium || 0) + (stats.totalLow || 0);
  const totalCves = remediationTotal || severityTotal;
  const computed = {
    totalCves,
    patchRate: remediationTotal > 0 ? Math.round(((stats.totalPatchable || 0) / remediationTotal) * 100) : 0,
    syncRate: stats.totalIntegrationAssets > 0 ? Math.round(((stats.totalAction1Assets || 0) / stats.totalIntegrationAssets) * 100) : 0
  };
  return Object.prototype.hasOwnProperty.call(computed, metric) ? computed[metric] : (stats[metric] ?? 0);
}

function useIntegrationMeta(integration) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketplace/${integration}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setMeta(data); })
      .catch(() => { if (!cancelled) setMeta(null); });
    return () => { cancelled = true; };
  }, [integration]);
  return meta;
}

function renderCell(row, column, integration) {
  const value = row[column.key];
  if (column.type === 'nistLink' && value) {
    return <a href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(value)}`} target="_blank" rel="noreferrer">{value}</a>;
  }
  if (column.type === 'runId') return `#${value}`;
  if (column.type === 'datetime' && value) return new Date(value).toLocaleString();
  if (column.type === 'boolean') return value ? 'Yes' : 'No';
  if (column.type === 'number') return Number(value || 0).toLocaleString();
  if (column.type === 'historyActions') return <Link to={`/api/history/${row.id}/logs?integration=${integration}`}>Details</Link>;
  return value ?? '';
}

function DataTable({ title, columns, rows, emptyText, integration }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <div className="glass-panel">
        {rows.length === 0 ? (
          <div style={{ color: '#6B7280' }}>{emptyText || 'No records found.'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id || `${row.endpoint_name || row.cve || 'row'}-${index}`}>
                    {columns.map(column => <td key={column.key}>{renderCell(row, column, integration)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ integration, runSync, canRunSync }) {
  const meta = useIntegrationMeta(integration);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const integrationName = meta?.name || integration;
  const dashboard = meta?.display?.dashboard || {};
  const kpis = Array.isArray(dashboard.kpis) ? dashboard.kpis : [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard?integration=${integration}`)
      .then(r => r.json())
      .then(json => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setData({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [integration]);

  if (loading) return <div style={{ padding: '2rem' }}>Loading dashboard...</div>;
  const stats = data || {};

  return (
    <div className="dashboard-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>{tokenText(dashboard.title || '{integrationName} Dashboard', integrationName)}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>{tokenText(dashboard.description || 'Integration-owned dashboard.', integrationName)}</p>
        </div>
        {canRunSync && (
          <button className="btn-primary" type="button" onClick={runSync}>Run Sync Now</button>
        )}
      </div>
      <div className="dashboard-grid" style={{ gridTemplateColumns: `repeat(${Math.max(kpis.length, 1)}, 1fr)` }}>
        {(kpis.length ? kpis : [{ label: 'TOTAL ENDPOINTS', metric: 'totalEndpoints', color: '#1D8EE6' }]).map(card => (
          <Link key={card.label} to={card.to ? `/apps/${integration}/${card.to}` : `/apps/${integration}/dashboard`} className="stat-card" style={{ textDecoration: 'none', borderTop: `4px solid ${card.color || '#1D8EE6'}` }}>
            <div className="stat-label">{tokenText(card.label, integrationName)}</div>
            <div className="stat-value">{metricValue(card.metric, stats).toLocaleString()}{String(card.metric || '').includes('Rate') ? '%' : ''}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Endpoints({ integration }) {
  const meta = useIntegrationMeta(integration);
  const [rows, setRows] = useState([]);
  const display = meta?.display?.endpoints || {};
  const columns = display.columns || [];
  useEffect(() => {
    fetch(`/api/endpoints?integration=${integration}&page=1&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);
  return <DataTable title={display.title || 'Endpoints'} columns={columns} rows={rows} emptyText={display.emptyText} integration={integration} />;
}

export function Vulnerabilities({ integration }) {
  const meta = useIntegrationMeta(integration);
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const display = meta?.display?.vulnerabilities || {};
  const columns = display.columns || [];
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    query.set('integration', integration);
    query.set('page', '1');
    query.set('pageSize', String(PAGE_SIZE));
    fetch(`/api/vulnerabilities?${query}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration, location.search]);
  return <DataTable title={display.title || 'Vulnerabilities'} columns={columns} rows={rows} emptyText={display.emptyText} integration={integration} />;
}

export function History({ integration }) {
  const meta = useIntegrationMeta(integration);
  const [rows, setRows] = useState([]);
  const display = meta?.display?.history || {};
  const columns = display.columns || [];
  useEffect(() => {
    fetch(`/api/history?integration=${integration}&page=1&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);
  return <DataTable title={display.title || 'Run History'} columns={columns} rows={rows} emptyText={display.emptyText} integration={integration} />;
}

function groupSettings(settingsSchema) {
  return settingsSchema.reduce((groups, setting) => {
    const group = setting.group || 'Configuration';
    if (!groups[group]) groups[group] = [];
    groups[group].push(setting);
    return groups;
  }, {});
}

export function Settings({ integration }) {
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({});
  const [storedSecrets, setStoredSecrets] = useState({});
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [scheduleUi, setScheduleUi] = useState(cronToSchedule(''));
  const settingsSchema = meta?.settingsSchema || [];
  const sensitiveSettings = useMemo(() => new Set(settingsSchema.filter(setting => setting.type === 'secret' || setting.sensitive).map(setting => setting.key)), [settingsSchema]);
  const supportsSchedule = (meta?.marketplaceActions || []).includes('schedule') || (meta?.marketplaceActions || []).includes('sync');
  const supportsValidation = (meta?.marketplaceActions || []).includes('validate');

  useEffect(() => {
    Promise.all([fetch(`/api/marketplace/${integration}`).then(r => r.json()), fetch('/api/settings').then(r => r.json())])
      .then(([nextMeta, data]) => {
        const nextSettings = { ...(data.settings || {}) };
        for (const setting of nextMeta.settingsSchema || []) {
          if ((setting.type === 'secret' || setting.sensitive) && data.storedSecrets?.[setting.key]) nextSettings[setting.key] = SECRET_MASK;
        }
        if (!nextSettings[timezoneKey(integration)]) nextSettings[timezoneKey(integration)] = browserTimezone();
        setMeta(nextMeta);
        setSettings(nextSettings);
        setStoredSecrets(data.storedSecrets || {});
        setScheduleUi(cronToSchedule(nextSettings[scheduleKey(integration)]));
      });
  }, [integration]);

  const save = async (event) => {
    event.preventDefault();
    const payload = { _integration: integration };
    for (const setting of settingsSchema) {
      if (sensitiveSettings.has(setting.key) && settings[setting.key] === SECRET_MASK) continue;
      payload[setting.key] = settings[setting.key] || '';
    }
    if (supportsSchedule) {
      payload[scheduleKey(integration)] = settings[scheduleKey(integration)] || '';
      payload[timezoneKey(integration)] = settings[timezoneKey(integration)] || browserTimezone();
    }
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setMessage(response.ok ? 'Settings saved successfully.' : 'Unable to save settings.');
  };

  const validationPayload = () => {
    const payload = { integration, _secretModes: {} };
    for (const setting of settingsSchema) {
      const value = settings[setting.key];
      if (sensitiveSettings.has(setting.key) && value === SECRET_MASK) {
        payload._secretModes[setting.key] = 'stored';
        continue;
      }
      payload[setting.key] = value ?? '';
    }
    return payload;
  };

  const validate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validationPayload())
      });
      const data = await response.json();
      setValidationResult(data[integration] || data);
    } catch (error) {
      setValidationResult({ ok: false, message: error.message });
    } finally {
      setValidating(false);
    }
  };

  const updateSchedule = (changes) => {
    setScheduleUi(prev => {
      const next = { ...prev, ...changes };
      setSettings(current => ({ ...current, [scheduleKey(integration)]: scheduleToCron(next), [timezoneKey(integration)]: current[timezoneKey(integration)] || browserTimezone() }));
      return next;
    });
  };

  if (!meta) return <div style={{ padding: '2rem' }}>Loading settings...</div>;
  const grouped = groupSettings(settingsSchema);

  return (
    <div style={{ maxWidth: 760 }}>
      <form onSubmit={save}>
        {Object.entries(grouped).map(([groupName, fields]) => (
          <div key={groupName} className="glass-panel">
            <h3>{groupName}</h3>
            {fields.map(setting => (
              <div key={setting.key} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>{setting.label}{setting.required && <span style={{ color: '#DC2626' }}> *</span>}</label>
                {setting.type === 'select' ? (
                  <select
                    value={settings[setting.key] || setting.defaultValue || ''}
                    onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4, background: '#fff' }}
                  >
                    <option value="">Select...</option>
                    {(setting.options || []).map(option => {
                      const value = typeof option === 'string' ? option : option.value;
                      const label = typeof option === 'string' ? option : option.label;
                      return <option key={value} value={value}>{label}</option>;
                    })}
                  </select>
                ) : setting.type === 'checkbox' ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={settings[setting.key] === true || settings[setting.key] === 'true' || settings[setting.key] === '1'}
                      onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.checked }))}
                    />
                    Enabled
                  </label>
                ) : (
                  <input
                    type={setting.type === 'url' ? 'url' : setting.type === 'number' ? 'number' : 'text'}
                    value={settings[setting.key] || ''}
                    onFocus={() => { if (settings[setting.key] === SECRET_MASK) setSettings(current => ({ ...current, [setting.key]: '' })); }}
                    onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
                  />
                )}
                {storedSecrets[setting.key] && <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>A secret value is stored. Keep *** to leave it unchanged.</div>}
              </div>
            ))}
            {supportsValidation && groupName.toLowerCase().includes('configuration') && (
              <button className="btn-primary" type="button" onClick={validate} disabled={validating}>
                {validating ? 'Validating...' : (meta.display?.settings?.validateButtonLabel || 'Validate Credentials')}
              </button>
            )}
            {validationResult && groupName.toLowerCase().includes('configuration') && (
              <div style={{ marginTop: '0.75rem', color: validationResult.ok === false ? '#DC2626' : '#15803D' }}>
                {validationResult.message || JSON.stringify(validationResult)}
              </div>
            )}
          </div>
        ))}
        {supportsSchedule && (
          <div className="glass-panel">
            <h3>Schedule</h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" checked={scheduleUi.enabled} onChange={e => updateSchedule({ enabled: e.target.checked })} />
              Schedule enabled
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(54px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
              {WEEKDAYS.map(day => (
                <button key={day.value} type="button" className={scheduleUi.days.includes(day.value) ? 'btn-primary' : 'btn-secondary'} onClick={() => updateSchedule({ enabled: true, days: scheduleUi.days.includes(day.value) ? scheduleUi.days.filter(value => value !== day.value) : [...scheduleUi.days, day.value] })}>
                  {day.label}
                </button>
              ))}
            </div>
            <input type="time" value={scheduleUi.time} onChange={e => updateSchedule({ enabled: true, time: e.target.value })} />
          </div>
        )}
        <button className="btn-primary" type="submit">Save Settings</button>
        {message && <span style={{ marginLeft: '1rem', color: message.includes('Unable') ? '#DC2626' : '#15803D' }}>{message}</span>}
      </form>
    </div>
  );
}



