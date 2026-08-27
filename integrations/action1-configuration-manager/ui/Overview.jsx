import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildPolicyDetailsPath } from './policies/policyRouting.js';
import { pageSurfaceStyle, policyUiTokens, secondaryButtonStyle, textLinkButtonStyle } from './policies/policyUiStyles.js';
import { buildNonCompliantReportUrl, formatPercent } from './overviewReportLink.js';

const DESCRIPTION = 'Monitor configuration evaluation and compliance across active policies and their assigned Windows endpoints.';
const TOOLtips = {
  active: 'Enabled Configuration Manager Policies currently included in Dashboard evaluation. Assignment totals are Policy-endpoint assignments and may include overlapping scopes.',
  attention: 'Fully evaluated endpoints with one or more non-compliant Controls. Endpoints without a complete evaluation are not included.',
  incomplete: 'Assigned endpoints that do not yet have a complete current result set for every Control selected in the Policy.',
  coverage: 'Percentage of assigned Windows endpoints with a complete current result for every Control selected in their Policy. Disconnected endpoints remain assigned and stay in the denominator.',
  assigned: 'Current Windows endpoints assigned to the Policy scope. Disconnected endpoints remain included.',
  evaluated: 'Assigned endpoints with a complete current result for every Control selected in the Policy.',
  compliant: 'Fully evaluated endpoints where every selected Control is compliant.',
  rowAttention: 'Fully evaluated endpoints with one or more non-compliant Controls.',
  rowIncomplete: 'Assigned endpoints with partial results or no current data.',
  rowCoverage: 'Fully evaluated endpoints divided by assigned endpoints.',
  compliance: 'Compliant endpoints divided by fully evaluated endpoints. Endpoints without a complete evaluation are excluded.'
};

const styles = {
  shell: { width: '100%', maxWidth: 1160, margin: '0 auto', display: 'grid', gap: '0.75rem', fontFamily: policyUiTokens.fontFamily },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' },
  title: { margin: 0, color: policyUiTokens.textPrimary, fontSize: 24, lineHeight: 1.2, fontWeight: 600 },
  description: { margin: '0.25rem 0 0', color: policyUiTokens.textSecondary, fontSize: 14, lineHeight: 1.45 },
  sectionTitle: { margin: '0.75rem 0 0', color: policyUiTokens.textPrimary, fontSize: 15, lineHeight: 1.3, fontWeight: 600 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 },
  kpi: { ...pageSurfaceStyle, padding: '1rem 1.1rem', minWidth: 0 },
  kpiLabel: { display: 'flex', alignItems: 'center', gap: 6, color: policyUiTokens.textSecondary, fontSize: 12, lineHeight: 1.3 },
  value: { marginTop: 8, color: policyUiTokens.textPrimary, fontSize: 28, lineHeight: 1.1, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  sub: { margin: '0.35rem 0 0', color: policyUiTokens.textMuted, fontSize: 12, lineHeight: 1.35 },
  bar: { height: 4, marginTop: 10, borderRadius: 2, background: policyUiTokens.borderColor, overflow: 'hidden' },
  barFill: { height: '100%', background: policyUiTokens.accent },
  surface: { ...pageSurfaceStyle, overflow: 'visible' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, lineHeight: 1.35, color: policyUiTokens.textPrimary },
  th: { padding: '9px 8px', textAlign: 'right', color: policyUiTokens.textMuted, fontSize: 11, fontWeight: 600, whiteSpace: 'normal', background: policyUiTokens.mutedBackground, borderBottom: `1px solid ${policyUiTokens.borderColor}` },
  thFirst: { textAlign: 'left' },
  td: { padding: '10px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${policyUiTokens.borderColor}`, fontVariantNumeric: 'tabular-nums' },
  tdFirst: { textAlign: 'left', whiteSpace: 'normal', minWidth: 190 },
  nameLink: { ...textLinkButtonStyle, fontWeight: 600 },
  attentionLink: { ...textLinkButtonStyle, color: '#A85B00', fontWeight: 600 },
  total: { fontWeight: 600, background: policyUiTokens.mutedBackground, borderBottom: 0 },
  notice: { ...pageSurfaceStyle, padding: '1rem', color: policyUiTokens.textSecondary },
  error: { ...pageSurfaceStyle, padding: '1rem', color: policyUiTokens.danger, background: policyUiTokens.dangerSoftBackground },
  bubble: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, border: `1px solid ${policyUiTokens.inputBorderColor}`, borderRadius: '50%', color: policyUiTokens.textMuted, fontSize: 10, fontWeight: 600, cursor: 'help' }
};

function InfoBubble({ label, text }) {
  return <span style={styles.bubble} role="img" aria-label={`${label} information`} title={text}>i</span>;
}

function MetricLabel({ label, tooltip }) {
  return <span style={styles.kpiLabel}>{label}<InfoBubble label={label} text={tooltip} /></span>;
}

function displayCount(value) { return Number.isFinite(Number(value)) ? String(value) : '—'; }

function MetricCell({ label, value, tooltip, first = false, attention = false }) {
  const content = attention && Number(value) > 0 ? <a href="#non-compliant-report" style={styles.attentionLink} aria-label={`${value} ${label}; open Non-Compliant Endpoints report`}>{displayCount(value)}</a> : displayCount(value);
  return <td style={{ ...styles.td, ...(first ? styles.tdFirst : {}) }}><span title={tooltip}>{content}</span></td>;
}

function PercentCell({ value, tooltip }) {
  return <td style={styles.td}><span title={tooltip}>{formatPercent(value)}</span></td>;
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
  if (!summary || !reportId) return <div style={styles.shell}><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p><div style={{ ...styles.notice, marginTop: 8 }} role="status">Dashboard reporting is not configured. Go to Settings → Set up reporting.</div></div>;
  if (policies.length === 0) return <div style={styles.shell}><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p><h2 style={styles.sectionTitle}>Overview</h2><div style={{ ...styles.notice, marginTop: 8 }}><strong>No enabled Policies</strong><p style={styles.description}>Create and enable a Policy to start monitoring configuration evaluation.</p><button type="button" style={secondaryButtonStyle} onClick={() => navigate(`/apps/${encodeURIComponent(integration)}/policies`)}>Open Policies</button></div></div>;

  const reportUrl = (policy) => buildNonCompliantReportUrl(reportId, policy.organizationId);
  return <div style={styles.shell} data-integration={integration}>
    <header style={styles.header}><div><h1 style={styles.title}>Dashboard</h1><p style={styles.description}>{DESCRIPTION}</p></div><button type="button" style={secondaryButtonStyle} onClick={() => load('manual-refresh')} disabled={state.refreshing}>{state.refreshing ? 'Refreshing...' : 'Refresh'}</button></header>
    {state.error ? <div style={styles.error} role="alert">{state.error} <button type="button" style={textLinkButtonStyle} onClick={() => load('manual-refresh')}>Refresh</button></div> : null}
    <h2 style={styles.sectionTitle}>Overview</h2>
    <div style={styles.kpis}>
      <div style={styles.kpi}><MetricLabel label="Active Policies" tooltip={TOOLtips.active} /><div style={styles.value}>{displayCount(summary.activePoliciesCount)}</div><p style={styles.sub}>{displayCount(summary.assignedCount)} Policy-endpoint assignments</p></div>
      <div style={styles.kpi}><MetricLabel label="Need Attention" tooltip={TOOLtips.attention} /><div style={{ ...styles.value, color: '#A85B00' }}>{displayCount(summary.needsAttentionCount)}</div><p style={styles.sub}>fully evaluated endpoints</p></div>
      <div style={styles.kpi}><MetricLabel label="Not Fully Evaluated" tooltip={TOOLtips.incomplete} /><div style={styles.value}>{displayCount(summary.notFullyEvaluatedCount)}</div><p style={styles.sub}>endpoints with partial or no current data</p></div>
      <div style={styles.kpi}><MetricLabel label="Evaluation Coverage" tooltip={TOOLtips.coverage} /><div style={styles.value}>{formatPercent(summary.evaluationCoveragePercent)}</div><p style={styles.sub}>{displayCount(summary.fullyEvaluatedCount)} of {displayCount(summary.assignedCount)} endpoints evaluated</p><div style={styles.bar} aria-label={`Evaluation coverage ${formatPercent(summary.evaluationCoveragePercent)}`} role="img"><div style={{ ...styles.barFill, width: `${Math.max(0, Math.min(100, Number(summary.evaluationCoveragePercent) || 0))}%` }} /></div></div>
    </div>
    <h2 style={styles.sectionTitle}>Policies</h2>
    <div style={styles.surface}><table style={styles.table}><thead><tr>{[
      ['Policy', null], ['Assigned', TOOLtips.assigned], ['Evaluated', TOOLtips.evaluated], ['Compliant', TOOLtips.compliant], ['Need attention', TOOLtips.rowAttention], ['Not fully evaluated', TOOLtips.rowIncomplete], ['Coverage', TOOLtips.rowCoverage], ['Compliance', TOOLtips.compliance]
    ].map(([label, tooltip], index) => <th key={label} scope="col" style={{ ...styles.th, ...(index === 0 ? styles.thFirst : {}) }}>{tooltip ? <span>{label} <InfoBubble label={label} text={tooltip} /></span> : label}</th>)}</tr></thead><tbody>{policies.map((policy) => <tr key={policy.policyId}>
      <td style={{ ...styles.td, ...styles.tdFirst }}><button type="button" style={styles.nameLink} onClick={() => navigate(buildPolicyDetailsPath(integration, policy.policyId))}>{policy.policyName}</button></td>
      <MetricCell label="Assigned" value={policy.assignedCount} tooltip={TOOLtips.assigned} /><MetricCell label="Evaluated" value={policy.fullyEvaluatedCount} tooltip={TOOLtips.evaluated} /><MetricCell label="Compliant" value={policy.compliantCount} tooltip={TOOLtips.compliant} />
      <td style={styles.td}><a href={reportUrl(policy)} target="_blank" rel="noreferrer" style={styles.attentionLink} aria-label={`${policy.needsAttentionCount} Need attention; open Non-Compliant Endpoints report`}>{displayCount(policy.needsAttentionCount)}</a></td>
      <MetricCell label="Not fully evaluated" value={policy.notFullyEvaluatedCount} tooltip={TOOLtips.rowIncomplete} /><PercentCell value={policy.evaluationCoveragePercent} tooltip={TOOLtips.rowCoverage} /><PercentCell value={policy.compliancePercent} tooltip={TOOLtips.compliance} />
    </tr>)}</tbody><tfoot><tr>{[
      ['All policies', true], [summary.assignedCount], [summary.fullyEvaluatedCount], [summary.compliantCount], [summary.needsAttentionCount], [summary.notFullyEvaluatedCount], [formatPercent(summary.evaluationCoveragePercent)], [formatPercent(summary.compliancePercent)]
    ].map(([value, first], index) => <td key={index} style={{ ...styles.td, ...styles.total, ...(first ? styles.tdFirst : {}) }}>{value}</td>)}</tr></tfoot></table></div>
  </div>;
}
