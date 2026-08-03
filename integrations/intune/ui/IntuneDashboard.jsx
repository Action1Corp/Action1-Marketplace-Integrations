import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Package,
  ArrowRight,
  Calendar
} from 'lucide-react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatSchedule(cron, timezone) {
  const normalized = (cron || '').trim();
  if (!normalized) return 'Not scheduled';

  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return normalized;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const numericTime = /^\d+$/.test(hour) && /^\d+$/.test(minute);
  if (dayOfMonth !== '*' || month !== '*' || !numericTime) return normalized;

  const time = `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
  const tzLabel = timezone ? ` ${timezone}` : '';
  if (dayOfWeek === '*') return `Every day at ${time}${tzLabel}`;
  if (dayOfWeek === '1-5') return `Mon-Fri at ${time}${tzLabel}`;
  if (/^[0-6](,[0-6])*$/.test(dayOfWeek)) {
    const days = dayOfWeek.split(',').map(day => WEEKDAYS[Number(day)]).join(', ');
    return `${days} at ${time}${tzLabel}`;
  }
  return normalized;
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

function IntuneDashboard({ syncing, runSync, canRunSync }) {
  const { integration } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async (retry = true) => {
    setLoading(true);
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

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [syncing]);

  if (loading) return <div style={{padding: '2rem'}}>Loading Intune Agent Status...</div>;
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
  const selectedGroupIds = parseSelectedGroupIds(data?.selectedGroupIds);
  const selectedGroupMap = parseSelectedGroupMap(data?.selectedGroupMap);
  const selectedGroupLabels = selectedGroupIds.map(groupId => selectedGroupMap[groupId] || 'Group name unavailable');
  const usesSelectedGroups = data?.assignmentMode === 'selectedGroups';
  const assignmentModeLabel = usesSelectedGroups ? 'Selected device groups' : 'All Devices';
  const assignmentStatus = data?.assignmentStatus || 'not_checked';
  const assignmentMessage = data?.assignmentMessage || 'Assignments have not been checked.';
  const assignmentColor = assignmentStatus === 'configured' ? '#10b981' : assignmentStatus === 'failed' ? '#ef4444' : '#6B7280';
  const endpointRegistration = data?.endpointRegistration || {};
  const registrationStatus = endpointRegistration.status || 'not_checked';
  const registrationColor = registrationStatus === 'checked'
    ? (endpointRegistration.missingFromAction1 > 0 ? '#f59e0b' : '#10b981')
    : registrationStatus === 'failed' ? '#ef4444' : '#6B7280';
  const missingDevices = Array.isArray(endpointRegistration.missingDevices) ? endpointRegistration.missingDevices : [];
  const groupMembershipLimited = endpointRegistration.groupMembershipStatus === 'limited_permissions';

  const statusConfig = {
    up_to_date: { label: 'Up to Date', color: '#10b981', bg: '#DCFCE7', icon: CheckCircle2, desc: 'The Action1 Agent Application in Intune is configured with the latest version.' },
    update_available: { label: 'Update Available', color: '#f59e0b', bg: '#FEF3C7', icon: AlertTriangle, desc: 'A newer version of the Action1 Agent is available.' },
    not_deployed: { label: 'Not Deployed', color: '#ef4444', bg: '#FEE2E2', icon: XCircle, desc: 'No Action1 Agent app was found in Intune.' },
    unknown: { label: 'Unknown', color: '#6B7280', bg: '#F3F4F6', icon: Package, desc: 'Run a sync to check the agent version status.' }
  };

  const status = statusConfig[versionStatus] || statusConfig.unknown;
  const StatusIcon = status.icon;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Windows Device Enrollment and Provisioning</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-light)',
            background: '#fff', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)'
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
        <>
          {/* Status Banner */}
          <div className="glass-panel" style={{ 
            padding: '1.5rem', marginBottom: '1.5rem',
            borderLeft: `4px solid ${status.color}`,
            background: status.bg
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <StatusIcon size={28} style={{ color: status.color }} />
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: status.color }}>{status.label}</h2>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem', color: '#374151' }}>{status.desc}</p>
              </div>
            </div>
          </div>

          {/* Version Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
            {/* Latest Version */}
            <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Latest Available
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#111827', fontFamily: 'monospace' }}>
                {latestVersion}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '0.25rem' }}>
                from Action1 Download
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowRight size={24} style={{ color: versionStatus === 'up_to_date' ? '#10b981' : '#f59e0b' }} />
            </div>

            {/* Intune Version */}
            <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Deployed in Intune
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#111827', fontFamily: 'monospace' }}>
                {intuneVersion}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '0.25rem' }}>
                {intuneAppName}
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Application Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Intune App Name</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem' }}>{intuneAppName}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Version Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem', color: status.color }}>
                  {status.label}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Assignment Target</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: '0.25rem' }}>{assignmentModeLabel}</div>
                {usesSelectedGroups && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.55rem' }}>
                    {(selectedGroupLabels.length ? selectedGroupLabels : ['No device groups selected']).map(groupName => (
                      <span
                        key={groupName}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          maxWidth: '100%',
                          padding: '0.22rem 0.5rem',
                          borderRadius: '999px',
                          background: '#EAF3FF',
                          color: '#0B4EA2',
                          border: '1px solid #BFDBFE',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          lineHeight: 1.25
                        }}
                      >
                        {groupName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Assignment Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem', color: assignmentColor }}>{assignmentMessage}</div>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Endpoint Registration</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Intune Endpoints</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem' }}>{endpointRegistration.intuneTotal ?? 0}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Action1 Endpoints</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem' }}>{endpointRegistration.action1Total ?? 0}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Registered</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: '#10b981' }}>{endpointRegistration.registeredInAction1 ?? 0}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Missing</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: registrationColor }}>{endpointRegistration.missingFromAction1 ?? 0}</div>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: registrationColor, marginBottom: missingDevices.length ? '1rem' : 0 }}>
              {endpointRegistration.message || 'Endpoint registration has not been checked.'}
              {registrationStatus === 'checked' && Number.isFinite(endpointRegistration.matchRate) ? ` Match rate: ${endpointRegistration.matchRate}%.` : ''}
            </div>
            {groupMembershipLimited && (
              <div style={{ fontSize: '0.85rem', color: '#B45309', marginBottom: '1rem' }}>
                {endpointRegistration.groupMembershipMessage}
              </div>
            )}
            {missingDevices.length > 0 && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB', color: '#6B7280', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Intune Endpoint</th>
                      <th style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Device Groups</th>
                      <th style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>OS</th>
                      <th style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>User</th>
                      <th style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Last Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingDevices.slice(0, 10).map(device => (
                      <tr key={device.intuneDeviceId || device.deviceName}>
                        <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>{device.deviceName}</td>
                        <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>
                          {Array.isArray(device.deviceGroups) && device.deviceGroups.length ? device.deviceGroups.join(', ') : groupMembershipLimited ? 'Permission required' : 'N/A'}
                        </td>
                        <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>{device.os || 'N/A'}</td>
                        <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>{device.userPrincipalName || 'N/A'}</td>
                        <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>
                          {device.lastSyncDateTime ? new Date(device.lastSyncDateTime).toLocaleString() : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {missingDevices.length > 10 && (
                  <div style={{ padding: '0.65rem', color: '#6B7280', fontSize: '0.8rem', background: '#F9FAFB' }}>
                    Showing 10 of {missingDevices.length} missing Intune endpoints from the latest check.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default IntuneDashboard;
