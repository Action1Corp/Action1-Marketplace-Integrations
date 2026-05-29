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
  const scheduleLabel = formatSchedule(data?.schedule, data?.scheduleTimezone);

  const statusConfig = {
    up_to_date: { label: 'Up to Date', color: '#10b981', bg: '#DCFCE7', icon: CheckCircle2, desc: 'The Action1 Agent in Intune is running the latest version.' },
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
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Intune Agent Manager</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-light)', fontSize: '0.9rem' }}>
            Monitors the Action1 Agent deployment in Microsoft Intune to ensure it stays current.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-light)',
            background: '#fff', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)'
          }}>
            <Calendar size={14} />
            Last Check: {lastRun}
          </div>
          {canRunSync && (
            <button
              className="btn-primary"
              onClick={runSync}
              disabled={syncing}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
              {syncing ? 'Checking...' : 'Check Now'}
            </button>
          )}
        </div>
      </div>

      {neverRun ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <Package size={48} style={{ color: '#9CA3AF', marginBottom: '1rem' }} />
          <h2 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>No Check Performed Yet</h2>
          <p style={{ color: 'var(--text-light)', margin: 0 }}>
            {canRunSync ? 'Click "Check Now" to verify the Action1 Agent version in Intune.' : 'No check has been performed yet.'}
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
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Deployment Details</h3>
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
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Schedule</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem' }}>{scheduleLabel}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default IntuneDashboard;
