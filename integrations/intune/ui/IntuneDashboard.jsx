import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Package,
  RefreshCw,
  Search
} from 'lucide-react';

const endpointColumns = [
  { key: 'deviceName', label: 'Endpoint', width: '13%' },
  { key: 'source', label: 'Enrollment Status', width: '12%' },
  { key: 'provisioningStatus', label: 'Provisioning Status', width: '13%' },
  { key: 'action1EndpointGroups', label: 'Endpoint Groups', width: '15%' },
  { key: 'deviceGroups', label: 'Device Groups', width: '17%' },
  { key: 'os', label: 'OS', width: '8%' },
  { key: 'userPrincipalName', label: 'User', width: '22%' }
];

const DASHBOARD_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const baseTableCellStyle = {
  padding: '0.6rem',
  borderBottom: '1px solid var(--border-color)'
};

function columnCellStyle(column, extra = {}) {
  return {
    ...baseTableCellStyle,
    width: column.width,
    whiteSpace: column.nowrap ? 'nowrap' : undefined,
    ...extra
  };
}

function parseSelectedGroupIds(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function parseSelectedGroupMap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {}
  return {};
}

function getText(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function FilterCard({ label, value, icon: Icon, active, onClick, tone = '#0B4EA2' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={active}
      style={{
        width: '100%',
        minHeight: 88,
        padding: '0.85rem',
        background: active ? '#EAF3FF' : '#F9FAFB',
        border: active ? '2px solid #0B4EA2' : '1px solid var(--border-color)',
        borderRadius: 8,
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 700 }}>{label}</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '0.3rem', color: tone }}>{value ?? 0}</div>
        </div>
        <Icon size={18} color={tone} />
      </div>
    </button>
  );
}

function SourcePill({ source }) {
  const config = {
    Synced: { color: '#166534', bg: '#DCFCE7' },
    Action1: { color: '#0B4EA2', bg: '#EAF3FF' },
    Intune: { color: '#92400E', bg: '#FEF3C7' }
  }[source] || { color: '#374151', bg: '#F3F4F6' };

  return (
    <span style={{
      display: 'inline-flex',
      padding: '0.18rem 0.5rem',
      borderRadius: 999,
      color: config.color,
      background: config.bg,
      fontSize: '0.76rem',
      fontWeight: 700
    }}>
      {source || 'Unknown'}
    </span>
  );
}

function ProvisioningStatusPill({ status }) {
  const config = {
    'In progress': { color: '#92400E', bg: '#FEF3C7' },
    Completed: { color: '#166534', bg: '#DCFCE7' },
    Failed: { color: '#991B1B', bg: '#FEE2E2' },
    'Awaiting Enrollment': { color: '#0B4EA2', bg: '#EAF3FF' },
    'No automation result': { color: '#374151', bg: '#F3F4F6' },
    'N/A': { color: '#374151', bg: '#F3F4F6' }
  }[status] || { color: '#374151', bg: '#F3F4F6' };

  return (
    <span style={{
      display: 'inline-flex',
      padding: '0.18rem 0.5rem',
      borderRadius: 999,
      color: config.color,
      background: config.bg,
      fontSize: '0.76rem',
      fontWeight: 700,
      whiteSpace: 'nowrap'
    }}>
      {status || 'N/A'}
    </span>
  );
}

function IntuneDashboard({ syncing, runSync, canRunSync }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [endpointFilter, setEndpointFilter] = useState('all');
  const [columnFilters, setColumnFilters] = useState({});
  const [expandedEndpointId, setExpandedEndpointId] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async ({ retry = true, showLoading = false } = {}) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/intune/status');
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(json.error || 'Unable to load Intune dashboard.');
        }
        if (!cancelled) setData(json);
      } catch (loadError) {
        if (retry && !cancelled) {
          window.setTimeout(() => loadDashboard(false), 600);
          return;
        }
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadDashboard({ retry: false });
    };

    loadDashboard({ showLoading: true });
    const refreshTimer = window.setInterval(() => loadDashboard({ retry: false }), DASHBOARD_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [syncing]);

  const endpointRegistration = data?.endpointRegistration || {};
  const missingDevices = Array.isArray(endpointRegistration.missingDevices) ? endpointRegistration.missingDevices : [];
  const endpointRows = useMemo(() => {
    const endpoints = Array.isArray(endpointRegistration.endpoints) ? endpointRegistration.endpoints : [];
    if (endpoints.length) return endpoints;
    return missingDevices.map(device => ({ ...device, source: 'Intune' }));
  }, [endpointRegistration.endpoints, missingDevices]);
  const selectedGroupIds = parseSelectedGroupIds(data?.selectedGroupIds);
  const selectedGroupMap = parseSelectedGroupMap(data?.selectedGroupMap);
  const selectedGroupLabels = selectedGroupIds.map(groupId => selectedGroupMap[groupId] || 'Group name unavailable');
  const usesSelectedGroups = data?.assignmentMode === 'selectedGroups';
  const selectedGroupLabelSet = useMemo(
    () => new Set(selectedGroupLabels.map(label => String(label || '').trim().toLowerCase()).filter(Boolean)),
    [selectedGroupLabels]
  );
  const isEndpointInAssignmentTarget = (endpoint) => {
    if (endpoint.inAssignmentTarget) return true;
    if (!usesSelectedGroups) return endpoint.source === 'Intune' || endpoint.source === 'Synced';
    const deviceGroups = Array.isArray(endpoint.deviceGroups) ? endpoint.deviceGroups : [];
    return deviceGroups.some(groupName => selectedGroupLabelSet.has(String(groupName || '').trim().toLowerCase()));
  };
  const targetEndpointRows = useMemo(
    () => endpointRows.filter(endpoint => isEndpointInAssignmentTarget(endpoint)),
    [endpointRows, selectedGroupLabelSet, usesSelectedGroups]
  );
  const totalProvisioned = targetEndpointRows.filter(endpoint => endpoint.provisioningStatus === 'Completed').length;
  const totalNotProvisioned = targetEndpointRows.filter(endpoint => endpoint.provisioningStatus !== 'Completed').length;
  const filteredEndpointRows = useMemo(() => {
    const sourceFiltered = endpointRows.filter(endpoint => {
      if (endpointFilter === 'assignmentTarget') return isEndpointInAssignmentTarget(endpoint);
      if (endpointFilter === 'provisioned') return isEndpointInAssignmentTarget(endpoint) && endpoint.provisioningStatus === 'Completed';
      if (endpointFilter === 'notProvisioned') return isEndpointInAssignmentTarget(endpoint) && endpoint.provisioningStatus !== 'Completed';
      if (endpointFilter === 'intune') return endpoint.source === 'Intune' || endpoint.source === 'Synced';
      if (endpointFilter === 'action1') return endpoint.source === 'Action1' || endpoint.source === 'Synced';
      if (endpointFilter === 'synced') return endpoint.source === 'Synced' && isEndpointInAssignmentTarget(endpoint);
      if (endpointFilter === 'intuneOnly') return endpoint.source === 'Intune';
      if (endpointFilter === 'action1Only') return endpoint.source === 'Action1';
      return true;
    });
    return sourceFiltered.filter(endpoint => endpointColumns.every(column => {
      const filterValue = String(columnFilters[column.key] || '').trim().toLowerCase();
      if (!filterValue) return true;
      const value = column.key === 'lastSyncDateTime' ? formatDateTime(endpoint[column.key]) : getText(endpoint[column.key]);
      return value.toLowerCase().includes(filterValue);
    }));
  }, [columnFilters, endpointFilter, endpointRows, selectedGroupLabelSet, usesSelectedGroups]);

  if (loading) return <div style={{ padding: '2rem' }}>Loading Intune Agent Status...</div>;
  if (error) {
    return (
      <div className="glass-panel" style={{ borderLeft: '4px solid #ef4444', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <AlertTriangle color="#ef4444" size={20} />
          <strong style={{ color: '#991B1B' }}>Unable to load Intune dashboard</strong>
        </div>
        <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: '#B91C1C' }}>{error}</p>
      </div>
    );
  }

  const neverRun = data?.status === 'never_run';
  const latestVersion = data?.latestVersion || 'Unknown';
  const intuneVersion = data?.intuneVersion || 'Not Found';
  const versionStatus = data?.versionStatus || 'unknown';
  const intuneAppName = data?.intuneAppName || 'Action1 Agent';
  const lastRun = data?.lastRun ? new Date(data.lastRun).toLocaleString() : 'Never';
  const assignmentModeLabel = usesSelectedGroups ? 'Selected device groups' : 'All Devices';
  const assignmentStatus = data?.assignmentStatus || 'not_checked';
  const assignmentMessage = data?.assignmentMessage || 'Assignments have not been checked.';
  const assignmentColor = assignmentStatus === 'configured' ? '#10b981' : assignmentStatus === 'failed' ? '#ef4444' : '#6B7280';
  const assignmentTargetDeviceCount = Number.isFinite(endpointRegistration.assignmentTargetDeviceCount)
    ? endpointRegistration.assignmentTargetDeviceCount
    : usesSelectedGroups ? 0 : endpointRegistration.intuneTotal;
  const registrationStatus = endpointRegistration.status || 'not_checked';
  const registrationColor = registrationStatus === 'checked'
    ? (endpointRegistration.missingFromAction1 > 0 ? '#f59e0b' : '#10b981')
    : registrationStatus === 'failed' ? '#ef4444' : '#6B7280';
  const groupMembershipLimited = endpointRegistration.groupMembershipStatus === 'limited_permissions';
  const endpointFailureMessage = endpointRegistration.staleEndpointDataReason || endpointRegistration.provisioningMessage || endpointRegistration.message || '';
  const endpointDataStale = registrationStatus === 'failed' && endpointRegistration.usingStaleEndpointData;

  const statusConfig = {
    up_to_date: { label: 'Up to Date', color: '#10b981' },
    update_available: { label: 'Update Available', color: '#f59e0b' },
    not_deployed: { label: 'Not Deployed', color: '#ef4444' },
    unknown: { label: 'Unknown', color: '#6B7280' }
  };

  const status = statusConfig[versionStatus] || statusConfig.unknown;
  const intuneVersionColor = versionStatus === 'up_to_date' ? '#10b981' : '#ef4444';
  const hasActiveFilters = endpointFilter !== 'all' || Object.values(columnFilters).some(Boolean);
  const updateColumnFilter = (key, value) => setColumnFilters(current => ({ ...current, [key]: value }));
  const toggleEndpointFilter = filter => setEndpointFilter(current => current === filter ? 'all' : filter);
  const rowKey = (device, index) => device.id || device.intuneDeviceId || device.action1EndpointId || `${device.deviceName}-${index}`;
  const toggleEndpointDetails = key => setExpandedEndpointId(current => current === key ? '' : key);

  return (
    <div style={{ width: '100%', maxWidth: '100%', margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Windows Device Enrollment and Provisioning</h1>
          <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: '#6B7280' }}>Status refreshes automatically every 15 minutes.</div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8rem',
            color: 'var(--text-light)',
            background: '#fff',
            padding: '0.4rem 0.75rem',
            borderRadius: 6,
            border: '1px solid var(--border-color)'
          }}>
            <Calendar size={14} />
            Last Synced: {lastRun}
          </div>
          {canRunSync && (
            <button
              className="btn-primary"
              onClick={runSync}
              disabled={syncing}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
        </div>
      </div>

      {neverRun ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <Package size={48} style={{ color: '#9CA3AF', marginBottom: '1rem' }} />
          <h2 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>No Check Performed Yet</h2>
          <p style={{ color: 'var(--text-light)', margin: 0 }}>
            {canRunSync ? 'Click "Sync Now" to verify the Action1 Agent version in Intune.' : 'No check has been performed yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem', order: 2 }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Application Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Latest Action1 Agent Version</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: '0.25rem', fontFamily: 'monospace' }}>{latestVersion}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Action1 Agent Version in Intune</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: '0.25rem', fontFamily: 'monospace', color: intuneVersionColor }}>{intuneVersion}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Intune App Name</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem' }}>{intuneAppName}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Version Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem', color: status.color }}>{status.label}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Assignment Target</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: '0.25rem' }}>{assignmentModeLabel}</div>
                {usesSelectedGroups && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.55rem' }}>
                    {(selectedGroupLabels.length ? selectedGroupLabels : ['No device groups selected']).map(groupName => (
                      <span key={groupName} style={{ display: 'inline-flex', maxWidth: '100%', padding: '0.22rem 0.5rem', borderRadius: 999, background: '#EAF3FF', color: '#0B4EA2', border: '1px solid #BFDBFE', fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.25 }}>{groupName}</span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Assignment Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem', color: assignmentColor }}>{assignmentMessage}</div>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem', marginTop: 0, order: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <FilterCard label="Total Target Devices" value={assignmentTargetDeviceCount} icon={Package} active={endpointFilter === 'assignmentTarget'} onClick={() => toggleEndpointFilter('assignmentTarget')} tone="#0B4EA2" />
              <FilterCard label="Total Provisioned" value={totalProvisioned} icon={CheckCircle2} active={endpointFilter === 'provisioned'} onClick={() => toggleEndpointFilter('provisioned')} tone="#10b981" />
              <FilterCard label="Total Not Provisioned" value={totalNotProvisioned} icon={AlertTriangle} active={endpointFilter === 'notProvisioned'} onClick={() => toggleEndpointFilter('notProvisioned')} tone={registrationColor} />
            </div>
            {groupMembershipLimited && (
              <div style={{ fontSize: '0.85rem', color: '#B45309', marginBottom: '1rem' }}>{endpointRegistration.groupMembershipMessage}</div>
            )}
            {registrationStatus === 'failed' && endpointFailureMessage && (
              <div style={{ padding: '0.85rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#991B1B', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {endpointDataStale
                  ? `Latest endpoint status refresh failed: ${endpointFailureMessage}. Showing the last successfully loaded endpoint details.`
                  : `Endpoint details could not be loaded: ${endpointFailureMessage}`}
              </div>
            )}

            {endpointRows.length > 0 ? (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'visible' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', padding: '0.7rem 0.8rem', background: '#fff', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#374151', fontSize: '0.85rem', fontWeight: 700 }}>
                    <Search size={15} />
                    Showing {filteredEndpointRows.length} of {endpointRows.length} endpoints
                  </div>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setEndpointFilter('all');
                        setColumnFilters({});
                      }}
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB', color: '#6B7280', textAlign: 'left' }}>
                      {endpointColumns.map(column => (
                        <th key={column.key} style={columnCellStyle(column)}>{column.label}</th>
                      ))}
                    </tr>
                    <tr style={{ background: '#fff' }}>
                      {endpointColumns.map(column => (
                        <th key={column.key} style={columnCellStyle(column, { padding: '0.45rem 0.6rem' })}>
                          <input
                            value={columnFilters[column.key] || ''}
                            onChange={event => updateColumnFilter(column.key, event.target.value)}
                            placeholder={`Filter ${column.label}`}
                            style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '0.35rem 0.45rem', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.78rem' }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEndpointRows.slice(0, 100).map((device, index) => {
                      const key = rowKey(device, index);
                      const expanded = expandedEndpointId === key;
                      const automationResults = Array.isArray(device.automationResults) ? device.automationResults : [];
                      return (
                        <Fragment key={key}>
                          <tr
                            onClick={() => toggleEndpointDetails(key)}
                            aria-expanded={expanded}
                            style={{ cursor: 'pointer', background: expanded ? '#F8FBFF' : '#fff' }}
                          >
                            <td style={columnCellStyle(endpointColumns[0], { fontWeight: 600 })}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                {device.deviceName}
                              </span>
                            </td>
                            <td style={columnCellStyle(endpointColumns[1])}><SourcePill source={device.source} /></td>
                            <td style={columnCellStyle(endpointColumns[2])} title={device.provisioningDetail || ''}><ProvisioningStatusPill status={device.provisioningStatus || 'N/A'} /></td>
                            <td style={columnCellStyle(endpointColumns[3])}>{Array.isArray(device.action1EndpointGroups) && device.action1EndpointGroups.length ? device.action1EndpointGroups.join(', ') : 'N/A'}</td>
                            <td style={columnCellStyle(endpointColumns[4])}>{Array.isArray(device.deviceGroups) && device.deviceGroups.length ? device.deviceGroups.join(', ') : groupMembershipLimited && device.source !== 'Action1' ? 'Permission required' : 'N/A'}</td>
                            <td style={columnCellStyle(endpointColumns[5])}>{device.os || 'N/A'}</td>
                            <td style={columnCellStyle(endpointColumns[6])}>{device.userPrincipalName || 'N/A'}</td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={endpointColumns.length} style={{ padding: 0, borderBottom: '1px solid var(--border-color)', background: '#F8FBFF' }}>
                                <div style={{ padding: '0.85rem 1rem 1rem 2.1rem' }}>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#374151', marginBottom: '0.55rem' }}>Action1 Automations</div>
                                  {automationResults.length ? (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', background: '#fff', border: '1px solid #E5E7EB' }}>
                                      <thead>
                                        <tr style={{ background: '#F9FAFB', color: '#6B7280', textAlign: 'left' }}>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB' }}>Automation</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 140 }}>Status</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 160 }}>Action</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 90 }}>Complete</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 190, whiteSpace: 'nowrap' }}>Started</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 190, whiteSpace: 'nowrap' }}>Last Update</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB' }}>Details</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {automationResults.map((result, resultIndex) => (
                                          <tr key={`${key}-automation-${resultIndex}`}>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>{result.automationName || 'Unnamed automation'}</td>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6' }}><ProvisioningStatusPill status={result.status || 'N/A'} /></td>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6' }}>{result.actionName || 'N/A'}</td>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6' }}>{result.percentCompleted ? `${result.percentCompleted}%` : 'N/A'}</td>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>{formatDateTime(result.startedAt)}</td>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>{formatDateTime(result.completedAt)}</td>
                                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', color: '#4B5563' }}>{result.statusDetail || 'N/A'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div style={{ padding: '0.75rem', background: '#fff', border: '1px solid #E5E7EB', color: '#6B7280', borderRadius: 6 }}>
                                      No Action1 automation results were found for this endpoint in the latest sync.
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {filteredEndpointRows.length === 0 && (
                      <tr>
                        <td colSpan={endpointColumns.length} style={{ padding: '1rem', color: '#6B7280', textAlign: 'center' }}>No endpoints match the current filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {filteredEndpointRows.length > 100 && (
                  <div style={{ padding: '0.65rem', color: '#6B7280', fontSize: '0.8rem', background: '#F9FAFB' }}>
                    Showing 100 of {filteredEndpointRows.length} filtered endpoints from the latest check.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '1rem', background: '#F9FAFB', borderRadius: 8, color: '#6B7280', fontSize: '0.85rem' }}>
                {registrationStatus === 'failed' && endpointFailureMessage
                  ? `Endpoint details could not be loaded: ${endpointFailureMessage}`
                  : 'Endpoint details will appear after a successful check with Action1 API credentials configured.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default IntuneDashboard;
