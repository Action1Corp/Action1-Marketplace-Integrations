import { useCallback, useEffect, useMemo, useState } from 'react';
import { extractHistoryEnvelope } from './historyEnvelope.js';
import { createHistoryAdapter } from './historyAdapter.js';
import {
  buildPageItems,
  DEFAULT_HISTORY_PAGE_SIZE,
  getCompactHistorySummary,
  getHistoryRange,
  getRelevantCounterEntries,
  HISTORY_PAGE_SIZES
} from './historyViewModel.js';
import {
  buttonBaseStyle,
  pageSurfaceStyle,
  policyUiTokens,
  secondaryButtonStyle,
  textLinkButtonStyle
} from './policies/policyUiStyles.js';

const styles = {
  shell: { width: '100%', maxWidth: 1080, margin: '0 auto', display: 'grid', gap: '0.75rem' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' },
  title: { margin: 0, color: policyUiTokens.textPrimary, fontSize: 24, lineHeight: 1.2, fontWeight: 600 },
  description: { margin: '0.25rem 0 0', color: policyUiTokens.textSecondary, fontSize: 14, lineHeight: 1.45 },
  toolbar: { display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: 32 },
  rowsLabel: { color: policyUiTokens.textSecondary, fontSize: 12, lineHeight: 1.35 },
  select: { ...secondaryButtonStyle, height: 32, minHeight: 32, padding: '0 8px', fontSize: 12, lineHeight: 1.35, fontWeight: 400 },
  count: { marginLeft: 'auto', color: policyUiTokens.textMuted, fontSize: 11, lineHeight: 1.35 },
  tableSurface: { ...pageSurfaceStyle, overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12, lineHeight: 1.35, color: policyUiTokens.textPrimary },
  columnWidths: { 'Date & time': '18%', Operation: '16%', Policy: '22%', Organization: '12%', Result: '8%', Summary: '17%', Actions: '7%' },
  th: { padding: '9px 14px', textAlign: 'left', color: policyUiTokens.textMuted, fontSize: 11, lineHeight: 1.35, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: `1px solid ${policyUiTokens.borderColor}` },
  td: { padding: '8px 14px', verticalAlign: 'middle', borderBottom: `1px solid ${policyUiTokens.borderColor}`, overflowWrap: 'anywhere', lineHeight: 1.35, whiteSpace: 'nowrap' },
  auditValue: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' },
  dateValue: { color: policyUiTokens.textSecondary, fontVariantNumeric: 'tabular-nums', overflow: 'visible', textOverflow: 'clip' },
  policyValue: { color: policyUiTokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' },
  organizationValue: { color: policyUiTokens.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' },
  operation: { color: policyUiTokens.textPrimary, whiteSpace: 'nowrap', fontSize: 12 },
  summary: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35, fontSize: 12 },
  summaryText: { color: policyUiTokens.textSecondary },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  chip: { display: 'inline-flex', alignItems: 'baseline', gap: 5, padding: '1px 6px', border: `1px solid ${policyUiTokens.borderColor}`, borderRadius: 4, background: policyUiTokens.mutedBackground, color: policyUiTokens.textSecondary, fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace', fontSize: 10, lineHeight: 1.25, whiteSpace: 'nowrap' },
  chipValue: { color: policyUiTokens.textPrimary, fontFamily: 'inherit', fontSize: 10 },
  detailChip: { display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '3px 9px', border: `1px solid ${policyUiTokens.borderColor}`, borderRadius: 4, background: policyUiTokens.mutedBackground, color: policyUiTokens.textSecondary, fontSize: 11, lineHeight: 1.35 },
  detailChipValue: { color: policyUiTokens.textPrimary, fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace', fontSize: 12 },
  chipZero: { color: policyUiTokens.textMuted },
  empty: { padding: '2rem 1.5rem', textAlign: 'center' },
  error: { ...pageSurfaceStyle, padding: '1rem', color: policyUiTokens.danger, background: policyUiTokens.dangerSoftBackground },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.35rem' },
  pageButton: { minWidth: 30, minHeight: 30, padding: '0.25rem 0.5rem', fontSize: 12 },
  pageCurrent: { background: policyUiTokens.accentBackground, borderColor: policyUiTokens.accentBorder, color: policyUiTokens.accent },
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(31, 35, 40, 0.45)' },
  dialog: { ...pageSurfaceStyle, width: 'min(620px, 100%)', maxHeight: '82vh', overflowY: 'auto', padding: '0 1.35rem 1.25rem', boxShadow: policyUiTokens.shadowOverlay },
  dialogHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1.05rem 0 0.85rem', borderBottom: `1px solid ${policyUiTokens.borderColor}` },
  dialogTitle: { margin: 0, fontSize: 15, lineHeight: 1.45, fontWeight: 600, color: policyUiTokens.textPrimary },
  dialogSub: { margin: '0.2rem 0 0', color: policyUiTokens.textMuted, fontSize: 11, lineHeight: 1.35 },
  keyValue: { display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '6px 18px', margin: '16px 0 0', fontSize: 12, lineHeight: 1.35 },
  key: { color: policyUiTokens.textMuted, fontSize: 11 },
  value: { minWidth: 0, color: policyUiTokens.textPrimary, overflowWrap: 'anywhere', margin: 0, fontSize: 12, lineHeight: 1.35 },
  section: { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${policyUiTokens.borderColor}` },
  sectionTitle: { margin: 0, fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: policyUiTokens.textPrimary },
  countRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  familyList: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 20, marginTop: 4 },
  familyRow: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '0.35rem 0', borderBottom: `1px solid ${policyUiTokens.borderColor}`, fontSize: 12, lineHeight: 1.35 },
  familyName: { minWidth: 0, overflowWrap: 'anywhere' },
  familyOutcome: { flex: '0 0 auto', color: policyUiTokens.textMuted, fontSize: 10, lineHeight: 1.35 }
};

styles.actionCell = { textAlign: 'right', whiteSpace: 'nowrap' };

const detailsLinkStyle = { ...textLinkButtonStyle, fontSize: 11, lineHeight: 1.35 };

function resultBadgeStyle(result) {
  if (result === 'Success') return { color: policyUiTokens.success, fontSize: 12, lineHeight: 1.35, fontWeight: 600, whiteSpace: 'nowrap' };
  if (result === 'Running') return { color: policyUiTokens.accent, fontSize: 12, lineHeight: 1.35, fontWeight: 600, whiteSpace: 'nowrap' };
  return { color: policyUiTokens.danger, fontSize: 12, lineHeight: 1.35, fontWeight: 600, whiteSpace: 'nowrap' };
}

function CounterChips({ row, detail = false }) {
  const entries = getRelevantCounterEntries(row);
  if (entries.length === 0) return null;
  return <div style={{ ...styles.chips, ...(detail ? { marginTop: 8 } : {}) }}>{entries.map((entry) => <span key={entry.key} style={{ ...(detail ? styles.detailChip : styles.chip), ...(entry.value === 0 ? styles.chipZero : {}) }}><span>{entry.label}</span><strong style={{ ...(detail ? styles.detailChipValue : styles.chipValue), ...(entry.value === 0 ? styles.chipZero : {}) }}>{entry.value}</strong></span>)}</div>;
}

function FamilyChangeList({ families }) {
  return <div style={styles.familyList}>{families.map((outcome, index) => <div style={styles.familyRow} key={`${outcome.familyName}-${index}`}><span style={styles.familyName}>{outcome.familyName}</span><span style={styles.familyOutcome}>{outcome.outcome}</span></div>)}</div>;
}

function DetailDialog({ row, onClose }) {
  if (!row) return null;
  const counts = getRelevantCounterEntries(row);
  const policyGroups = Array.isArray(row.policies) ? row.policies : [];
  const families = row.familyOutcomes?.length > 0 ? row.familyOutcomes : policyGroups[0]?.familyChanges || [];
  const errors = row.errors || [];
  return (
    <div style={styles.overlay} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
        <div style={styles.dialogHeader}>
          <div><h2 id="history-detail-title" style={styles.dialogTitle}>History details</h2><p style={styles.dialogSub}>{row.operation}</p></div>
          <button type="button" style={{ ...buttonBaseStyle, ...secondaryButtonStyle }} onClick={onClose}>Close</button>
        </div>
        <dl style={styles.keyValue}>
          <dt style={styles.key}>Date &amp; time</dt><dd style={styles.value}>{row.timestampLabel}</dd>
          <dt style={styles.key}>Policy</dt><dd style={styles.value}>{row.policyName}</dd>
          <dt style={styles.key}>Organization</dt><dd style={styles.value}>{row.organizationName}</dd>
          <dt style={styles.key}>Result</dt><dd style={styles.value}><span style={resultBadgeStyle(row.result)}>{row.result}</span></dd>
          <dt style={styles.key}>Summary</dt><dd style={styles.value}>{row.summary}</dd>
        </dl>
        {counts.length > 0 ? <div style={styles.section}><h3 style={styles.sectionTitle}>Counts</h3><CounterChips row={row} detail /></div> : null}
        {families.length > 0 && policyGroups.length <= 1 ? <div style={styles.section}><h3 style={styles.sectionTitle}>Control Family changes · {families.length}</h3><FamilyChangeList families={families} /></div> : null}
        {policyGroups.length > 1 ? <div style={styles.section}><h3 style={styles.sectionTitle}>Control Family changes · {policyGroups.reduce((total, policy) => total + (policy.familyChanges || []).length, 0)}</h3>{policyGroups.map((policy, index) => <div key={`${policy.policyNameSnapshot}-${index}`} style={{ marginTop: index === 0 ? 8 : 14 }}><div style={{ ...styles.familyName, fontWeight: 600 }}>{policy.policyNameSnapshot}</div><div style={{ color: policyUiTokens.textMuted, fontSize: 11 }}>{policy.organizationNameSnapshot}</div><FamilyChangeList families={policy.familyChanges || []} /></div>)}</div> : null}
        {errors.length > 0 ? <div style={styles.section}><h3 style={styles.sectionTitle}>Issues</h3><ul style={{ ...styles.description, paddingLeft: '1.1rem', marginTop: '0.45rem' }}>{errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div> : null}
      </section>
    </div>
  );
}

function History({ integration = 'action1-configuration-manager' }) {
  const adapter = useMemo(() => createHistoryAdapter({ integration, extractEnvelope: extractHistoryEnvelope }), [integration]);
  const [state, setState] = useState({ status: 'loading', rows: [], total: 0, page: 1, pageSize: DEFAULT_HISTORY_PAGE_SIZE, error: '' });
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (page = 1, pageSize = DEFAULT_HISTORY_PAGE_SIZE) => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const result = await adapter.list({ page, pageSize });
      setState({ ...result, status: 'ready', error: '' });
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error: 'Unable to load Policy History. Try Refresh again.' }));
    }
  }, [adapter]);

  useEffect(() => { load(1, DEFAULT_HISTORY_PAGE_SIZE); }, [load]);

  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const range = getHistoryRange(state.page, state.pageSize, state.total);
  const pageItems = buildPageItems(state.page, totalPages);
  const hasNext = state.page < totalPages;
  const hasRows = state.rows.length > 0;

  return (
    <div style={styles.shell}>
      <header style={styles.header}><div><h1 className="page-title" style={styles.title}>History</h1><p style={styles.description}>Review Configuration Manager Policy operations and their outcomes.</p></div></header>
      <div style={styles.toolbar}>
        <label htmlFor="history-page-size" style={styles.rowsLabel}>Rows:</label>
        <select id="history-page-size" aria-label="Rows per page" value={state.pageSize} style={styles.select} disabled={state.status === 'loading'} onChange={(event) => load(1, Number(event.target.value))}>{HISTORY_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select>
        <span style={styles.count}>Showing {range.start}–{range.end} of {range.total} operations</span>
        <button type="button" style={{ ...buttonBaseStyle, ...secondaryButtonStyle, minHeight: 34 }} onClick={() => load(state.page, state.pageSize)} disabled={state.status === 'loading'}>Refresh</button>
      </div>
      {state.status === 'error' ? <div style={styles.error} role="alert">{state.error} <button type="button" style={textLinkButtonStyle} onClick={() => load(state.page, state.pageSize)}>Refresh</button></div> : null}
      {state.status === 'loading' && !hasRows ? <div style={{ ...pageSurfaceStyle, ...styles.empty }} aria-live="polite">Loading Policy History...</div> : null}
      {state.status !== 'loading' && !hasRows ? <div style={{ ...pageSurfaceStyle, ...styles.empty }}><strong>No Policy history yet</strong><p style={styles.description}>Policy operations will appear here after they complete.</p></div> : null}
      {hasRows ? <>
        <div style={styles.tableSurface}>
          <table style={styles.table}><thead><tr>{['Date & time', 'Operation', 'Policy', 'Organization', 'Result', 'Summary', 'Actions'].map((column) => <th scope="col" aria-label={column} key={column} style={{ ...styles.th, width: styles.columnWidths[column] }}>{column === 'Actions' ? '' : column}</th>)}</tr></thead>
            <tbody>{state.rows.map((row) => <tr key={row.id}><td style={{ ...styles.td, ...styles.auditValue, ...styles.dateValue }} title={row.timestamp || undefined}>{row.timestampLabel}</td><td style={{ ...styles.td, ...styles.operation }}>{row.operation}</td><td style={{ ...styles.td, ...styles.auditValue, ...styles.policyValue }} title={row.policyName}>{row.policyName}</td><td style={{ ...styles.td, ...styles.auditValue, ...styles.organizationValue }} title={row.organizationName}>{row.organizationName}</td><td style={styles.td}><span style={resultBadgeStyle(row.result)}>{row.result}</span></td><td style={{ ...styles.td, ...styles.summary }} title={getCompactHistorySummary(row)}><div style={styles.summaryText}>{getCompactHistorySummary(row)}</div></td><td style={{ ...styles.td, ...styles.actionCell }}><button type="button" style={detailsLinkStyle} onClick={() => setSelected(row)}>Details</button></td></tr>)}</tbody>
          </table>
        </div>
        {totalPages > 1 ? <nav aria-label="History pages" style={styles.pagination}><button type="button" style={{ ...buttonBaseStyle, ...secondaryButtonStyle, ...styles.pageButton }} disabled={state.page <= 1 || state.status === 'loading'} onClick={() => load(state.page - 1, state.pageSize)}>Previous</button>{pageItems.map((item) => typeof item === 'number' ? <button type="button" key={item} aria-current={item === state.page ? 'page' : undefined} style={{ ...buttonBaseStyle, ...secondaryButtonStyle, ...styles.pageButton, ...(item === state.page ? styles.pageCurrent : {}) }} disabled={state.status === 'loading'} onClick={() => load(item, state.pageSize)}>{item}</button> : <span key={item} style={{ color: policyUiTokens.textMuted, padding: '0 0.15rem' }}>…</span>)}<button type="button" style={{ ...buttonBaseStyle, ...secondaryButtonStyle, ...styles.pageButton }} disabled={!hasNext || state.status === 'loading'} onClick={() => load(state.page + 1, state.pageSize)}>Next</button></nav> : null}
      </> : null}
      <DetailDialog row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default History;
