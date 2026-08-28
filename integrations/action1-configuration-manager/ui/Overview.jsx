import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildPolicyDetailsPath } from './policies/policyRouting.js';
import { deriveDisplayName } from './policies/policyViewModel.js';
import { pageSurfaceStyle, policyUiTokens, secondaryButtonStyle, textLinkButtonStyle } from './policies/policyUiStyles.js';
import { buildNonCompliantReportUrl, formatPercent } from './overviewReportLink.js';

const DESCRIPTION = 'Monitor current configuration evaluation and compliance across active policies and assigned Windows endpoints. Coverage reflects the latest available reporting data and may change as endpoint availability changes.';
const POLICY_GRID_COLUMNS = '28% 8% 8% 9% 13% 14% 8% 12%';
const TOOLtips = {
  active: 'Enabled Configuration Manager policies included in this Dashboard.',
  attention: 'Fully evaluated endpoints with one or more non-compliant controls.',
  incomplete: 'Assigned endpoints with partial results or no current evaluation data.',
  coverage: 'Percentage of assigned endpoints with a complete evaluation in the latest available report data. Coverage may change as endpoint availability and report data are refreshed.',
  assigned: 'Windows endpoints currently assigned to the policy scope.',
  evaluated: 'Assigned endpoints with a complete result for every selected control.',
  compliant: 'Fully evaluated endpoints where every selected control is compliant.',
  rowAttention: 'Fully evaluated endpoints with one or more non-compliant controls.',
  rowIncomplete: 'Assigned endpoints with partial results or no current evaluation data.',
  rowCoverage: 'Fully evaluated endpoints divided by assigned endpoints.',
  compliance: 'Compliant endpoints divided by fully evaluated endpoints. Endpoints without a complete evaluation are excluded.'
};

const styles = {
  shell: { width: '100%', maxWidth: 1080, margin: '0 auto', fontFamily: policyUiTokens.fontFamily, fontSize: 13, lineHeight: 1.5, color: '#313752' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' },
  title: { margin: '0 0 4px', color: '#313752', fontSize: 20, lineHeight: 1.5, fontWeight: 600 },
  description: { margin: '0 0 22px', color: '#5A6079', fontSize: 13, lineHeight: 1.5 },
  refresh: { height: 30, padding: '0 14px', fontSize: 13, lineHeight: 1.5, fontWeight: 600, fontFamily: 'inherit', borderRadius: 3, cursor: 'pointer', border: '1px solid #C3CAD8', background: '#FFFFFF', color: '#313752' },
  sectionHead: { margin: '26px 0 12px' },
  sectionTitle: { margin: 0, color: '#313752', fontSize: 15, lineHeight: 1.5, fontWeight: 600 },
  sectionDescription: { margin: '3px 0 0', color: '#5A6079', fontSize: 13, lineHeight: 1.5, maxWidth: 640 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 },
  kpi: { ...pageSurfaceStyle, borderRadius: 6, padding: '16px 18px', minWidth: 0 },
  kpiLabel: { display: 'flex', alignItems: 'center', gap: 6, color: '#5A6079', fontSize: 13, lineHeight: 1.5, fontWeight: 600, marginBottom: 8 },
  value: { color: '#313752', fontSize: 28, lineHeight: 1.1, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  sub: { margin: '5px 0 0', color: '#8A90A6', fontSize: 12, lineHeight: 1.5 },
  bar: { height: 4, marginTop: 10, borderRadius: 2, background: policyUiTokens.borderColor, overflow: 'hidden' },
  barFill: { height: '100%', background: '#0337A1' },
  surface: { ...pageSurfaceStyle, borderRadius: 6, overflow: 'visible', position: 'relative', zIndex: 0 },
  th: { padding: '11px 6px', textAlign: 'right', color: '#8A90A6', fontSize: 12, lineHeight: 1.5, fontWeight: 600, whiteSpace: 'normal', textTransform: 'none', background: '#f6f8fa' },
  groupTh: { padding: '9px 16px 2px', textAlign: 'center', color: '#5A6079', fontSize: 12, lineHeight: 1.5, fontWeight: 600, textTransform: 'none', letterSpacing: 0, background: '#f6f8fa' },
  thFirst: { textAlign: 'left' },
  headTh: { borderBottom: `1px solid ${policyUiTokens.borderColor}`, paddingTop: 2 },
  td: { padding: '11px 16px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #E4E8F0', fontVariantNumeric: 'tabular-nums' },
  tdFirst: { textAlign: 'left', whiteSpace: 'normal' },
  policyGrid: { display: 'grid', gridTemplateColumns: POLICY_GRID_COLUMNS, width: '100%', fontSize: 14, lineHeight: 1.5, color: '#313752', fontVariantNumeric: 'tabular-nums' },
  policyGridHeader: { display: 'grid', gridTemplateColumns: POLICY_GRID_COLUMNS, gridTemplateRows: 'auto auto', width: '100%' },
  nameLink: { ...textLinkButtonStyle, fontWeight: 600 },
  attentionLink: { ...textLinkButtonStyle, color: '#A85B00', fontWeight: 600 },
  total: { fontWeight: 600, background: '#f6f8fa', borderBottom: 0, borderTop: `1px solid ${policyUiTokens.borderColor}` },
  notice: { ...pageSurfaceStyle, padding: '1rem', color: policyUiTokens.textSecondary },
  error: { ...pageSurfaceStyle, padding: '1rem', color: policyUiTokens.danger, background: policyUiTokens.dangerSoftBackground },
  percent: { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 58 },
  percentBar: { display: 'block', width: 58, height: 4, borderRadius: 2, background: policyUiTokens.borderColor, overflow: 'hidden' },
  percentFill: { display: 'block', height: '100%', borderRadius: 2 },
  controlTable: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.5, color: '#313752', fontVariantNumeric: 'tabular-nums' },
  controlHead: { padding: '11px 16px', textAlign: 'right', color: '#8A90A6', fontSize: 12, lineHeight: 1.5, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'none', background: '#f6f8fa', borderBottom: `1px solid ${policyUiTokens.borderColor}` },
  controlCell: { padding: '11px 16px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #E4E8F0', fontVariantNumeric: 'tabular-nums' },
  controlFirst: { textAlign: 'left', whiteSpace: 'normal', width: '40%', fontWeight: 600 },
  controlPolicy: { textAlign: 'left', whiteSpace: 'normal', color: '#5A6079' },
  controlCount: { fontWeight: 400, color: '#313752' },
  controlEmpty: { margin: 0, padding: '10px 16px 16px', color: '#5A6079', fontSize: 12, lineHeight: 1.5 },
  footer: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 },
  footerLink: { fontSize: 13, lineHeight: 1.5, color: '#0337A1', textDecoration: 'none' }
};

const DASHBOARD_TOOLTIP_CSS = `
.dashboard-tip { position: relative; display: inline-block; cursor: help; border-bottom: 1px dotted #C3CAD8; }
.dashboard-tip:hover { border-bottom-color: #8A90A6; }
.dashboard-tip:focus-visible { outline: 2px solid #0337A1; outline-offset: 2px; }
.dashboard-tip::after {
  content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  background: #313752; color: #fff; font-size: 11px; font-weight: 400; line-height: 1.4;
  text-transform: none; letter-spacing: 0; padding: 7px 10px; border-radius: 3px; width: 220px;
  text-align: left; opacity: 0; visibility: hidden; transition: opacity .12s; z-index: 20;
  pointer-events: none; white-space: normal;
}
.dashboard-tip:hover::after, .dashboard-tip:focus::after { opacity: 1; visibility: visible; }
th:last-child .dashboard-tip::after, th:nth-last-child(2) .dashboard-tip::after { left: auto; right: -4px; transform: none; }
.policiesGrid { position: relative; }
.policyDivider, .metricsDivider { position: absolute; top: 0; bottom: 0; width: 1px; background: #E4E8F0; pointer-events: none; z-index: 2; }
.policyDivider { left: 28%; }
.metricsDivider { left: 80%; }
`;

function TooltipLabel({ label, tooltip }) {
  return <span className="dashboard-tip" data-tip={tooltip} tabIndex="0" role="button" aria-label={`${label}: ${tooltip}`}>{label}</span>;
}

function MetricLabel({ label, tooltip }) {
  return <span style={styles.kpiLabel}><TooltipLabel label={label} tooltip={tooltip} /></span>;
}

function displayCount(value) { return Number.isFinite(Number(value)) ? String(value) : '—'; }
function ratioPercent(numerator, denominator) { return denominator ? (Number(numerator) / Number(denominator)) * 100 : null; }
function policyDisplayName(policy) { return deriveDisplayName(policy?.policyName, policy?.scope?.name); }

function MetricCell({ label, value, tooltip, attention = false }) {
  const content = attention && Number(value) > 0 ? <a href="#non-compliant-report" style={styles.attentionLink} aria-label={`${value} ${label}; open Non-Compliant Endpoints report`}>{displayCount(value)}</a> : displayCount(value);
  return <div role="cell" style={styles.td}><span aria-label={tooltip}>{content}</span></div>;
}

function PercentCell({ value, tooltip, coverage = false }) {
  const numeric = Number(value);
  const hasValue = value !== null && value !== undefined && Number.isFinite(numeric);
  const tone = coverage ? 'bar-accent' : (!hasValue ? 'metric-null' : (numeric >= 90 ? 'lvl-hi' : numeric >= 50 ? 'lvl-mid' : numeric >= 25 ? 'lvl-orange' : 'lvl-low'));
  const fillColor = coverage ? policyUiTokens.accent : (tone === 'lvl-hi' ? '#2E7D32' : tone === 'lvl-mid' ? '#A85B00' : tone === 'lvl-orange' ? '#C77C02' : '#B3261E');
  return <div role="cell" style={styles.td}><span aria-label={tooltip} style={styles.percent}><span>{formatPercent(value)}</span>{hasValue ? <span className={tone} style={styles.percentBar}><span style={{ ...styles.percentFill, width: `${Math.max(0, Math.min(100, numeric))}%`, background: fillColor }} /></span> : null}</span></div>;
}

export default function Overview({ integration = 'action1-configuration-manager' }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', overview: null, error: '' });
  const load = useCallback(async (operationType = 'initial-load') => {
    setState((current) => ({ ...current, status: current.overview ? 'ready' : 'loading', refreshing: operationType === 'manual-refresh', error: '' }));
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/get-overview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { operationType } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.message || 'Unable to load Dashboard.');
      setState({ status: 'ready', overview: result.overview || null, refreshing: false, error: '' });
    } catch (error) {
      setState((current) => ({ status: current.overview ? 'ready' : 'error', overview: current.overview, refreshing: false, error: error.message === 'Configuration Manager Dashboard reporting is not configured.' ? 'Dashboard reporting is not configured. Go to Settings → Set up reporting.' : 'Unable to load Dashboard. Try Refresh again.' }));
    }
  }, [integration]);

  useEffect(() => { load('initial-load'); }, [load]);

  if (state.status === 'loading') return <div style={styles.shell}><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p><div style={{ ...styles.notice, marginTop: 8 }} aria-live="polite">Loading Dashboard...</div></div>;
  if (state.status === 'error') return <div style={styles.shell}><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p><div style={{ ...styles.error, marginTop: 8 }} role="alert">{state.error} <button type="button" style={textLinkButtonStyle} onClick={load}>Refresh</button></div></div>;

  const overview = state.overview || {};
  const summary = overview.summary;
  const policies = Array.isArray(overview.policies) ? overview.policies : [];
  const reportId = overview.reporting?.dashboardNonCompliantEndpoints;
  const controlsReportId = overview.reporting?.dashboardNonCompliantControls;
  if (!summary || !reportId || !controlsReportId) return <div style={styles.shell}><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p><div style={{ ...styles.notice, marginTop: 8 }} role="status">Dashboard reporting is not configured. Go to Settings → Set up reporting.</div></div>;
  if (policies.length === 0) return <div style={styles.shell}><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p><h2 style={styles.sectionTitle}>Overview</h2><div style={{ ...styles.notice, marginTop: 8 }}><strong>No enabled Policies</strong><p style={styles.description}>Create and enable a Policy to start monitoring configuration evaluation.</p><button type="button" style={secondaryButtonStyle} onClick={() => navigate(`/apps/${encodeURIComponent(integration)}/policies`)}>Open Policies</button></div></div>;

  const reportUrl = (policy) => buildNonCompliantReportUrl(reportId, policy.organizationId);
  const controlReportUrl = (control) => buildNonCompliantReportUrl(controlsReportId, control.organizationId);
  const organizations = [...new Set(policies.map((policy) => policy.organizationId).filter(Boolean))];
  const footerReportUrl = organizations.length === 1 ? buildNonCompliantReportUrl(controlsReportId, organizations[0]) : null;
  const topControls = Array.isArray(overview.topControlsNeedingAttention) ? overview.topControlsNeedingAttention : [];
  return <div style={styles.shell} data-integration={integration}><style>{DASHBOARD_TOOLTIP_CSS}</style>
    <header style={styles.header}><div><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p></div><button type="button" style={styles.refresh} onClick={() => load('manual-refresh')} disabled={state.refreshing}>{state.refreshing ? 'Refreshing...' : 'Refresh'}</button></header>
    {state.error ? <div style={styles.error} role="alert">{state.error} <button type="button" style={textLinkButtonStyle} onClick={() => load('manual-refresh')}>Refresh</button></div> : null}
    <h2 style={{ ...styles.sectionTitle, ...styles.sectionHead }}>Overview</h2>
    <div style={styles.kpis}>
      <div style={styles.kpi}><MetricLabel label="Active Policies" tooltip={TOOLtips.active} /><div style={styles.value}>{displayCount(summary.activePoliciesCount)}</div><p style={styles.sub}>{displayCount(summary.assignedCount)} endpoints assigned</p></div>
      <div style={styles.kpi}><MetricLabel label="Need Attention" tooltip={TOOLtips.attention} /><div style={{ ...styles.value, color: '#A85B00' }}>{displayCount(summary.needsAttentionCount)}</div><p style={styles.sub}>{formatPercent(ratioPercent(summary.needsAttentionCount, summary.fullyEvaluatedCount))} of evaluated endpoints</p></div>
      <div style={styles.kpi}><MetricLabel label="Not Fully Evaluated" tooltip={TOOLtips.incomplete} /><div style={styles.value}>{displayCount(summary.notFullyEvaluatedCount)}</div><p style={styles.sub}>{formatPercent(ratioPercent(summary.notFullyEvaluatedCount, summary.assignedCount))} of assigned endpoints</p></div>
      <div style={styles.kpi}><MetricLabel label="Evaluation Coverage" tooltip={TOOLtips.coverage} /><div style={styles.value}>{formatPercent(summary.evaluationCoveragePercent)}</div><p style={styles.sub}>{displayCount(summary.fullyEvaluatedCount)} of {displayCount(summary.assignedCount)} endpoints evaluated</p><div style={styles.bar} aria-label={`Evaluation coverage ${formatPercent(summary.evaluationCoveragePercent)}`} role="img"><div style={{ ...styles.barFill, width: `${Math.max(0, Math.min(100, Number(summary.evaluationCoveragePercent) || 0))}%` }} /></div></div>
    </div>
    <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Policies</h2><p style={styles.sectionDescription}>Operational data for active policies.</p></div>
    <div style={styles.surface} className="policiesGrid" role="table" aria-label="Policies"><span className="policyDivider" aria-hidden="true" /><span className="metricsDivider" aria-hidden="true" /><div role="rowgroup" style={styles.policyGridHeader}>
      <div role="columnheader" style={{ ...styles.groupTh, ...styles.thFirst, gridColumn: '1', gridRow: '1 / span 2' }}>Policy</div>
      <div role="columnheader" style={{ ...styles.groupTh, gridColumn: '2 / span 5', gridRow: '1' }}>Endpoints</div>
      <div role="columnheader" style={{ ...styles.groupTh, gridColumn: '7 / span 2', gridRow: '1' }}>Metrics</div>
      <div role="columnheader" style={{ ...styles.th, ...styles.headTh, gridColumn: '1', gridRow: '2' }} />
      {[
        ['Assigned', TOOLtips.assigned], ['Evaluated', TOOLtips.evaluated], ['Compliant', TOOLtips.compliant], ['Need attention', TOOLtips.rowAttention], ['Partial / No data', TOOLtips.rowIncomplete], ['Coverage', TOOLtips.rowCoverage], ['Compliance', TOOLtips.compliance]
      ].map(([label, tooltip], index) => <div key={label} role="columnheader" style={{ ...styles.th, ...styles.headTh, gridColumn: String(index + 2), gridRow: '2' }}><TooltipLabel label={label} tooltip={tooltip} /></div>)}
    </div><div role="rowgroup">{policies.map((policy) => <div role="row" key={policy.policyId} style={styles.policyGrid}>
      <div role="cell" style={{ ...styles.td, ...styles.tdFirst }}><button type="button" style={styles.nameLink} onClick={() => navigate(buildPolicyDetailsPath(integration, policy.policyId))}>{policyDisplayName(policy)}</button></div>
      <MetricCell label="Assigned" value={policy.assignedCount} tooltip={TOOLtips.assigned} /><MetricCell label="Evaluated" value={policy.fullyEvaluatedCount} tooltip={TOOLtips.evaluated} /><MetricCell label="Compliant" value={policy.compliantCount} tooltip={TOOLtips.compliant} />
      <div role="cell" style={styles.td}><a href={reportUrl(policy)} target="_blank" rel="noreferrer" style={styles.attentionLink} aria-label={`${policy.needsAttentionCount} Need attention; open Non-Compliant Endpoints report`}>{displayCount(policy.needsAttentionCount)}</a></div>
      <MetricCell label="Not fully evaluated" value={policy.notFullyEvaluatedCount} tooltip={TOOLtips.rowIncomplete} /><PercentCell value={policy.evaluationCoveragePercent} tooltip={TOOLtips.rowCoverage} coverage /><PercentCell value={policy.compliancePercent} tooltip={TOOLtips.compliance} />
    </div>)}</div><div role="row" style={styles.policyGrid}><div role="cell" style={{ ...styles.td, ...styles.tdFirst, ...styles.total }}>All policies</div>{[
      summary.assignedCount, summary.fullyEvaluatedCount, summary.compliantCount, summary.needsAttentionCount, summary.notFullyEvaluatedCount, formatPercent(summary.evaluationCoveragePercent), formatPercent(summary.compliancePercent)
    ].map((value, index) => <div key={index} role="cell" style={{ ...styles.td, ...styles.total }}>{value}</div>)}</div></div>
    <div style={styles.sectionHead}><h2 id="top-controls-heading" style={styles.sectionTitle}>Top controls needing attention</h2><p style={styles.sectionDescription}>Controls affecting the largest number of endpoints across active policies.</p></div>
    <div style={styles.surface} aria-labelledby="top-controls-heading">{topControls.length ? <table style={styles.controlTable}><colgroup><col style={{ width: '40%' }} /><col style={{ width: '40%' }} /><col style={{ width: '20%' }} /></colgroup><thead><tr><th scope="col" style={{ ...styles.controlHead, ...styles.controlFirst }}>Control</th><th scope="col" style={{ ...styles.controlHead, ...styles.controlPolicy }}>Policy</th><th scope="col" style={styles.controlHead}>Affected endpoints</th></tr></thead><tbody>{topControls.map((control, index) => { const policy = policies.find((candidate) => candidate.policyId === control.policyId && candidate.organizationId === control.organizationId); const rowBorder = index === topControls.length - 1 ? { borderBottom: 'none' } : {}; return <tr key={`${control.organizationId}|${control.policyId}|${control.controlName}`}><td style={{ ...styles.controlCell, ...styles.controlFirst, ...rowBorder }}><a href={controlReportUrl(control)} target="_blank" rel="noreferrer" style={{ ...styles.footerLink, fontWeight: 600 }}>{control.controlName}</a></td><td style={{ ...styles.controlCell, ...styles.controlPolicy, ...rowBorder }}>{policy ? policyDisplayName(policy) : control.policyName}</td><td style={{ ...styles.controlCell, ...styles.controlCount, ...rowBorder }}>{displayCount(control.affectedEndpointCount)}</td></tr>; })}</tbody></table> : <p style={styles.controlEmpty}>No controls currently need attention.</p>}</div>
    {footerReportUrl ? <div style={styles.footer}><a href={footerReportUrl} target="_blank" rel="noreferrer" style={styles.footerLink}>View non-compliant controls report</a></div> : null}
  </div>;
}
