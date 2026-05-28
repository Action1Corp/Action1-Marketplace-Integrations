import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { metricValue, tokenText, useIntegrationMeta } from './viewToolkit.jsx';

function Dashboard({ integration, runSync, canRunSync }) {
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

export default Dashboard;
