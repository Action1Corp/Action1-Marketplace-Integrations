import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

export const PAGE_SIZE = 50;
export const SECRET_MASK = '***';
export const WEEKDAYS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' }
];

export function tokenText(value, integrationName) {
  return String(value || '').replaceAll('{integrationName}', integrationName);
}

export function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function scheduleKey(integration) {
  return `CronSchedule_${integration}`;
}

export function timezoneKey(integration) {
  return `CronTimezone_${integration}`;
}

export function cronToSchedule(cron) {
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

export function scheduleToCron(schedule) {
  if (!schedule.enabled) return '';
  if (schedule.mode === 'custom') return schedule.custom.trim();
  const selectedDays = [...schedule.days].sort((a, b) => Number(a) - Number(b));
  if (selectedDays.length === 0) return '';
  const [hour, minute] = schedule.time.split(':');
  const dayExpression = selectedDays.length === 7 ? '*' : selectedDays.join(',');
  return `${Number(minute)} ${Number(hour)} * * ${dayExpression}`;
}

export function metricValue(metric, stats) {
  const integrationAssets = Math.max(0, Number(stats.totalIntegrationAssets || 0));
  const missingFromAction1 = Math.max(0, Number(stats.missingFromAction1 || 0));
  const matchedAssets = Math.max(0, integrationAssets - missingFromAction1);
  const remediationTotal = (stats.totalPatchable || 0) + (stats.totalNotPatchable || 0) + (stats.totalUnrecognized || 0);
  const severityTotal = (stats.totalCritical || 0) + (stats.totalHigh || 0) + (stats.totalMedium || 0) + (stats.totalLow || 0);
  const totalCves = remediationTotal || severityTotal;
  const computed = {
    totalCves,
    patchRate: remediationTotal > 0 ? Math.round(((stats.totalPatchable || 0) / remediationTotal) * 100) : 0,
    syncRate: integrationAssets > 0 ? Math.min(100, Math.round((matchedAssets / integrationAssets) * 100)) : 0
  };
  return Object.prototype.hasOwnProperty.call(computed, metric) ? computed[metric] : (stats[metric] ?? 0);
}

export function useIntegrationMeta(integration) {
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

export function renderCell(row, column, integration) {
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

export function DataTable({ title, columns, rows, emptyText, integration }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <div className="glass-panel">
        {rows.length === 0 ? (
          <div style={{ color: '#8A8A8A' }}>{emptyText || 'No records found.'}</div>
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

export function groupSettings(settingsSchema) {
  return settingsSchema.reduce((groups, setting) => {
    const group = setting.group || 'Configuration';
    if (!groups[group]) groups[group] = [];
    groups[group].push(setting);
    return groups;
  }, {});
}
