import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ShieldAlert,
  Server,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Cpu,
  Globe,
  BarChart3,
  Calendar,
  RefreshCw
} from 'lucide-react';

const iconMap = {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Globe,
  Server,
  ShieldAlert
};

const defaultDashboard = {
  "component": "metric-dashboard",
  "title": "{integrationName} Vulnerability Summary",
  "description": "Comprehensive analysis of endpoint security posture across {integrationName} and Action1.",
  "kpis": [
    {
      "label": "ASSET SYNC RATE",
      "metric": "syncRate",
      "color": "#1D8EE6",
      "tone": "blue"
    },
    {
      "label": "PATCHABILITY RATE",
      "metric": "patchRate",
      "color": "#10b981",
      "tone": "green"
    },
    {
      "label": "TOTAL VULNERABILITIES",
      "metric": "totalCves",
      "color": "#111827",
      "tone": "gray",
      "to": "vulnerabilities"
    }
  ],
  "sections": [
    {
      "title": "Asset Intelligence Coverage",
      "cards": [
        {
          "label": "{integrationName} Inventory",
          "metric": "totalIntegrationAssets",
          "color": "#1D8EE6",
          "to": "endpoints?filter=appAssets",
          "icon": "Globe",
          "subtitle": "Active assets identified in {integrationName}"
        },
        {
          "label": "Action1 Managed",
          "metric": "totalAction1Assets",
          "color": "#10b981",
          "to": "endpoints?filter=action1Assets",
          "icon": "Server",
          "subtitle": "Endpoints under Action1 management"
        },
        {
          "label": "Audit Gap: {integrationName}",
          "metric": "missingFromIntegration",
          "color": "#f97316",
          "to": "endpoints?filter=missingApp",
          "icon": "Activity",
          "subtitle": "In Action1 but not found in {integrationName}"
        },
        {
          "label": "Audit Gap: Action1",
          "metric": "missingFromAction1",
          "color": "#ef4444",
          "to": "endpoints?filter=missingAction1",
          "icon": "AlertTriangle",
          "subtitle": "In {integrationName} but missing Action1 agent"
        }
      ]
    },
    {
      "title": "Threat Severity Profile",
      "cards": [
        {
          "label": "Critical",
          "metric": "totalCritical",
          "color": "#ef4444",
          "to": "vulnerabilities?severity=Critical",
          "icon": "ShieldAlert",
          "subtitle": "Immediate corrective action required"
        },
        {
          "label": "High",
          "metric": "totalHigh",
          "color": "#f97316",
          "to": "vulnerabilities?severity=High",
          "icon": "AlertTriangle",
          "subtitle": "Significant risk of exploitation"
        },
        {
          "label": "Medium",
          "metric": "totalMedium",
          "color": "#eab308",
          "to": "vulnerabilities?severity=Medium",
          "icon": "Activity",
          "subtitle": "Targeted remediation recommended"
        },
        {
          "label": "Low",
          "metric": "totalLow",
          "color": "#3b82f6",
          "to": "vulnerabilities?severity=Low",
          "icon": "BarChart3",
          "subtitle": "Minor security anomalies"
        }
      ]
    },
    {
      "title": "Distribution",
      "type": "severityDistribution"
    },
    {
      "title": "Remediation Strategy & Readiness",
      "columns": 3,
      "cards": [
        {
          "label": "Verified Patch Available",
          "metric": "totalPatchable",
          "color": "#10b981",
          "to": "vulnerabilities?status=Patch Available",
          "icon": "CheckCircle2",
          "subtitle": "Identified CVEs with available Action1 patches"
        },
        {
          "label": "No Immediate Patch",
          "metric": "totalNotPatchable",
          "color": "#ef4444",
          "to": "vulnerabilities?status=No Patch Available",
          "icon": "AlertTriangle",
          "subtitle": "Vulnerabilities requiring alternative mitigation"
        },
        {
          "label": "Unrecognized/Unknown",
          "metric": "totalUnrecognized",
          "color": "#9CA3AF",
          "to": "vulnerabilities?status=Not Recognized",
          "icon": "Cpu",
          "subtitle": "CVEs requiring further manual investigation"
        }
      ]
    }
  ]
};

const dashboardCache = new Map();
const integrationDefCache = new Map();

function tokenText(value, integrationName) {
  return String(value || '').replaceAll('{integrationName}', integrationName);
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

function targetPath(integration, to = '') {
  if (!to) return `/apps/${integration}/dashboard`;
  return `/apps/${integration}/${to}`;
}

function compactSyncDetails(details = '') {
  const text = String(details || '').trim();
  if (!text) return 'No additional sync details were reported.';
  if (text.includes('Marketplace restarted while this sync was running')) {
    return 'The previous sync was interrupted by a marketplace restart. Start a new sync when ready.';
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const latestLine = lines[lines.length - 1] || text;
  return latestLine.length > 220 ? `${latestLine.slice(0, 217)}...` : latestLine;
}

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
  return {
    x: cx + (radius * Math.cos(angleInRadians)),
    y: cy + (radius * Math.sin(angleInRadians))
  };
}

function donutSegmentPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z'
  ].join(' ');
}

function Dashboard({ syncing, runSync, canRunSync, integrationMeta }) {
  const navigate = useNavigate();
  const { integration } = useParams();
  const [data, setData] = useState(null);
  const [integrationDef, setIntegrationDef] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;
    const cachedDashboard = dashboardCache.get(integration) || null;
    const cachedIntegration = integrationDefCache.get(integration) || integrationMeta || null;

    if (integrationMeta) {
      integrationDefCache.set(integration, integrationMeta);
    }

    setData(cachedDashboard);
    setIntegrationDef(cachedIntegration);
    setLoading(!(cachedDashboard && cachedIntegration));

    const loadDashboard = async (retry = true) => {
      if (!dashboardCache.has(integration) || !integrationDefCache.has(integration)) setLoading(true);
      setError('');
      try {
        const dashboardPromise = fetch(`/api/dashboard?integration=${integration}`);
        const integrationPromise = cachedIntegration
          ? Promise.resolve(cachedIntegration)
          : fetch(`/api/marketplace/${integration}`)
              .then(async response => {
                const json = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(json.error || 'Unable to load integration display definition.');
                return json;
              });
        const [dashboardResponse, integrationJson] = await Promise.all([dashboardPromise, integrationPromise]);
        const dashboardJson = await dashboardResponse.json().catch(() => ({}));
        if (!dashboardResponse.ok) throw new Error(dashboardJson.error || 'Unable to load dashboard.');
        if (!cancelled) {
          dashboardCache.set(integration, dashboardJson);
          integrationDefCache.set(integration, integrationJson);
          setData(dashboardJson);
          setIntegrationDef(integrationJson);
          if (dashboardJson.status === 'Running') {
            refreshTimer = window.setTimeout(() => loadDashboard(false), 15000);
          }
        }
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
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [integration, syncing, integrationMeta]);


  if (loading) return <div style={{ padding: '2rem' }}>Loading Dashboard...</div>;
  if (error) {
    return (
      <div className="glass-panel" style={{ borderLeft: '4px solid #ef4444', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <AlertTriangle color="#ef4444" size={20} />
          <strong style={{ color: '#991B1B' }}>Unable to load dashboard</strong>
        </div>
        <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: '#B91C1C' }}>{error}</p>
      </div>
    );
  }

  const stats = data?.stats || {};
  const integrationName = integrationDef?.name || integration.charAt(0).toUpperCase() + integration.slice(1);
  const dashboard = defaultDashboard;
  const kpis = Array.isArray(dashboard.kpis) ? dashboard.kpis : [];
  const sections = Array.isArray(dashboard.sections) ? dashboard.sections : [];
  const isRunning = syncing || data?.status === 'Running';
  const hasCompletedMetrics = Boolean(data?.stats);
  const runningAgeMinutes = Math.floor((data?.runningAgeSeconds || 0) / 60);
  const runningTitle = hasCompletedMetrics ? 'Sync is running' : 'Initial sync is running';
  const runningMessage = hasCompletedMetrics
    ? 'Existing dashboard metrics remain visible while the latest sync finishes. This page will refresh periodically.'
    : runningAgeMinutes >= 30
      ? 'This sync is still working through vulnerability scoring data. Large NIST lookups can take a while, especially when several integrations are synced at the same time.'
      : 'Dashboard metrics will fill in after this sync writes endpoint, vulnerability, and scoring data. This page will refresh periodically.';
  const isInterrupted = data?.status === 'Interrupted' || String(data?.details || '').includes('Marketplace restarted while this sync was running');
  const alertTitle = isInterrupted ? 'Previous Sync Was Interrupted' : 'Operational Alert: Last Synchronization Failed';
  const alertColor = isInterrupted ? '#92400E' : '#991B1B';
  const alertBackground = isInterrupted ? '#FFFBEB' : '#FEF2F2';
  const alertBorder = isInterrupted ? '#f59e0b' : '#ef4444';
  const alertMessageColor = isInterrupted ? '#B45309' : '#B91C1C';
  const pieData = [
    { name: 'Critical', value: stats.totalCritical || 0, color: '#ef4444' },
    { name: 'High', value: stats.totalHigh || 0, color: '#f97316' },
    { name: 'Medium', value: stats.totalMedium || 0, color: '#eab308' },
    { name: 'Low', value: stats.totalLow || 0, color: '#3b82f6' }
  ];
  const hasSeverityData = pieData.some(item => item.value > 0);
  const totalSeverity = pieData.reduce((sum, item) => sum + item.value, 0);
  let chartAngle = 0;
  const donutSegments = pieData
    .filter(item => item.value > 0)
    .map(item => {
      const startAngle = chartAngle;
      const endAngle = chartAngle + (item.value / totalSeverity) * 360;
      chartAngle = endAngle;
      return { ...item, startAngle, endAngle };
    });

  const Card = ({ card }) => {
    const Icon = iconMap[card.icon];
    const value = metricValue(card.metric, stats);
    return (
      <div
        className="stat-card glass-panel"
        style={{ borderTop: `4px solid ${card.color || '#1D8EE6'}`, cursor: 'pointer', transition: 'transform 0.12s' }}
        onClick={() => navigate(targetPath(integration, card.to))}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {Icon && <Icon className="card-icon" size={48} />}
        <h3>{tokenText(card.label, integrationName)}</h3>
        <div className="value" style={{ color: card.color || '#1D8EE6' }}>{value ?? 0}</div>
        {card.subtitle && <div className="subtitle">{tokenText(card.subtitle, integrationName)}</div>}
      </div>
    );
  };

  const Section = ({ title, children }) => (
    <div className="dashboard-section">
      <div className="section-header">
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );

  const renderCards = (section) => (
    <div className="dashboard-grid" style={section.columns ? { gridTemplateColumns: `repeat(${section.columns}, 1fr)` } : undefined}>
      {(section.cards || []).map((card, index) => <Card key={`${card.label}-${index}`} card={card} />)}
    </div>
  );

  const renderDistribution = ({ showTitle = true } = {}) => (
    <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', padding: '1rem' }}>
      {showTitle && <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Distribution</h3>}
      <div style={{ height: '240px', minHeight: '240px' }}>
        {hasSeverityData ? (
          <svg viewBox="0 0 260 220" width="100%" height="100%" role="img" aria-label="Severity distribution">
            <g transform="translate(20 0)">
              {donutSegments.map(segment => (
                <path
                  key={segment.name}
                  d={donutSegmentPath(110, 110, 86, 58, segment.startAngle, segment.endAngle)}
                  fill={segment.color}
                  stroke="#fff"
                  strokeWidth="4"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/apps/${integration}/vulnerabilities?severity=${segment.name}`)}
                >
                  <title>{`${segment.name}: ${segment.value}`}</title>
                </path>
              ))}
              <circle cx="110" cy="110" r="52" fill="#fff" />
              <text x="110" y="105" textAnchor="middle" style={{ fontSize: '24px', fontWeight: 800, fill: 'var(--text-primary)' }}>{totalSeverity}</text>
              <text x="110" y="124" textAnchor="middle" style={{ fontSize: '11px', fontWeight: 700, fill: 'var(--text-secondary)' }}>CVEs</text>
            </g>
          </svg>
        ) : (
          <div style={{ height: '100%', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#9CA3AF', fontSize: '0.85rem', padding: '1rem' }}>
            {hasCompletedMetrics ? 'No severity data was reported in the latest successful sync.' : 'Severity distribution will appear after the first successful sync.'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        {pieData.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} /> {d.name}
          </div>
        ))}
      </div>
    </div>
  );

  const renderSection = (section, index) => {
    if (section.type === 'severityDistribution') {
      return (
        <Section key={index} title={tokenText(section.title, integrationName)}>
          {renderDistribution({ showTitle: false })}
        </Section>
      );
    }

    if (section.layout === 'severity-with-distribution') {
      return (
        <Section key={index} title={tokenText(section.title, integrationName)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: '1.25rem', alignItems: 'stretch' }}>
            <div className="dashboard-grid">
              {(section.cards || []).map((card, cardIndex) => <Card key={`${card.label}-${cardIndex}`} card={card} />)}
            </div>
            {renderDistribution()}
          </div>
        </Section>
      );
    }

    return (
      <Section key={index} title={tokenText(section.title, integrationName)}>
        {renderCards(section)}
      </Section>
    );
  };

  return (
    <div className="dashboard-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>{tokenText(dashboard.title, integrationName)}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>{tokenText(dashboard.description, integrationName)}</p>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-light)', background: '#fff', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <Calendar size={14} />
            Last Synced: {data?.lastRun ? new Date(data.lastRun).toLocaleString() : 'Never'}
          </div>
          {canRunSync && (
            <button className="btn-primary" onClick={runSync} disabled={isRunning} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem', fontSize: '0.85rem' }}>
              <RefreshCw size={14} style={{ animation: isRunning ? 'spin 1s linear infinite' : 'none' }} />
              {isRunning ? 'Syncing...' : 'Run Sync Now'}
            </button>
          )}
        </div>
      </div>

      {isRunning && !hasCompletedMetrics && (
        <div className="glass-panel" style={{ borderLeft: '4px solid #1D8EE6', background: '#EFF6FF' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <RefreshCw color="#1D8EE6" size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <strong style={{ color: '#1E3A8A' }}>{runningTitle}</strong>
          </div>
          <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: '#1D4ED8' }}>
            {runningMessage}
          </p>
        </div>
      )}

      {(data?.status === 'Failed' || data?.status === 'Interrupted') && (
        <div className="glass-panel" style={{ borderLeft: `4px solid ${alertBorder}`, background: alertBackground }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <AlertTriangle color={alertBorder} size={20} />
            <strong style={{ color: alertColor }}>{alertTitle}</strong>
          </div>
          <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: alertMessageColor }}>{compactSyncDetails(data?.details)}</p>
        </div>
      )}

      {kpis.length > 0 && (
        <div className="dashboard-grid" style={{ gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
          {kpis.map((kpi, index) => (
            <div
              key={`${kpi.label}-${index}`}
              className="glass-panel"
              onClick={() => kpi.to && navigate(targetPath(integration, kpi.to))}
              style={{ textAlign: 'center', background: '#fff', cursor: kpi.to ? 'pointer' : 'default' }}
            >
              <div style={{ color: kpi.color || 'var(--text-primary)', fontWeight: 700, fontSize: '1.75rem' }}>{metricValue(kpi.metric, stats)}{String(kpi.metric || '').toLowerCase().includes('rate') ? '%' : ''}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{tokenText(kpi.label, integrationName)}</div>
            </div>
          ))}
        </div>
      )}

      {sections.map(renderSection)}
    </div>
  );
}

export default Dashboard;
