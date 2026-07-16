import { useEffect, useState } from 'react';
import { TIMESTAMP_LABEL, buildHistoryRows, resultTone } from '../historyViewModel.mjs';

const HISTORY_PAGE_SIZE = 30;

const styles = {
  page: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
    display: 'grid',
    gap: '0.5rem'
  },
  header: {
    display: 'grid',
    gap: '0.35rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    lineHeight: 1.2
  },
  description: {
    margin: 0,
    color: '#526173',
    fontSize: '0.92rem',
    lineHeight: 1.6,
    maxWidth: 760
  },
  card: {
    padding: '1.25rem',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.82)'
  },
  headingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
    marginBottom: '1rem'
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.25
  },
  cardMeta: {
    margin: '0.25rem 0 0',
    color: '#526173',
    fontSize: '0.84rem',
    lineHeight: 1.5
  },
  tableWrap: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableCellCompact: {
    padding: '0.8rem 0.35rem',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
    fontSize: '0.92rem',
    color: '#0F172A',
    whiteSpace: 'nowrap'
  },
  tableHead: {
    textAlign: 'left',
    padding: '0.65rem 0.35rem',
    borderBottom: '1px solid var(--border-color)',
    color: '#4B5563',
    fontSize: '0.82rem',
    textTransform: 'uppercase',
    letterSpacing: '0.03em'
  },
  tableCell: {
    padding: '0.8rem 0.35rem',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
    fontSize: '0.92rem',
    color: '#0F172A'
  },
  resultText: {
    fontWeight: 500
  },
  detailsButton: {
    border: '1px solid #CBD5E1',
    borderRadius: 6,
    background: '#F8FAFC',
    color: '#0F172A',
    fontSize: '0.85rem',
    lineHeight: 1.2,
    padding: '0.3rem 0.6rem',
    cursor: 'pointer'
  },
  detailsMuted: {
    color: '#64748B'
  },
  dialogBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.35)',
    display: 'grid',
    placeItems: 'center',
    padding: '1rem',
    zIndex: 30
  },
  dialog: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 12,
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.2)',
    padding: '1rem',
    display: 'grid',
    gap: '0.9rem'
  },
  dialogHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem'
  },
  dialogTitle: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 600,
    lineHeight: 1.3
  },
  dialogBody: {
    display: 'grid',
    gap: '0.55rem'
  },
  detailLine: {
    margin: 0,
    color: '#334155',
    fontSize: '0.92rem',
    lineHeight: 1.55
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.65rem',
    flexWrap: 'wrap'
  },
  emptyState: {
    color: '#6B7280',
    fontSize: '0.92rem',
    lineHeight: 1.6
  },
  message: {
    padding: '0.85rem 0.95rem',
    borderRadius: 8,
    fontSize: '0.9rem',
    lineHeight: 1.5
  }
};

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', 'true');
  input.style.position = 'absolute';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, input.value.length);

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(input);
  }
}

function History({ integration }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState('');

  const loadHistory = async (mode = 'initial') => {
    if (mode === 'initial') {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      setError('');

      const response = await fetch(`/api/history?integration=${integration}&page=1&pageSize=${HISTORY_PAGE_SIZE}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Unable to load Microsoft Entra history.');
      }

      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load Microsoft Entra history.');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHistory('initial');
  }, [integration]);

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading history...</div>;
  }

  const recentRuns = buildHistoryRows(rows).slice(0, HISTORY_PAGE_SIZE);
  const handleCopyDetails = async () => {
    if (!selectedDetails?.copyText) {
      return;
    }

    try {
      const copied = await copyTextToClipboard(selectedDetails.copyText);
      setCopyFeedback(copied ? 'Copied.' : 'Copy unavailable.');
    } catch {
      setCopyFeedback('Copy unavailable.');
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>History</h1>
        <p style={styles.description}>
          Review recent Microsoft Entra synchronization runs and Marketplace action results.
        </p>
      </div>

      {error && (
        <div style={{ ...styles.message, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          {error}
        </div>
      )}

      <div className="glass-panel" style={styles.card}>
        <div style={styles.headingRow}>
          <div>
            <h2 style={styles.cardTitle}>Recent runs</h2>
            <p style={styles.cardMeta}>Showing latest 30 runs</p>
          </div>
          <button className="btn-secondary" type="button" onClick={() => loadHistory('refresh')} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {recentRuns.length === 0 ? (
          <div style={styles.emptyState}>No Microsoft Entra runs have been recorded yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHead}>{TIMESTAMP_LABEL}</th>
                  <th style={styles.tableHead}>RESULT</th>
                  <th style={styles.tableHead}>SYNCED</th>
                  <th style={styles.tableHead}>SKIPPED</th>
                  <th style={styles.tableHead}>FAILED</th>
                  <th style={styles.tableHead}>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((row) => (
                  <tr key={row.id ?? `${row.started}-${row.result}`}>
                    <td style={styles.tableCell}>{row.started}</td>
                    <td style={styles.tableCell}>
                      <span style={{ ...styles.resultText, ...resultTone(row.result) }}>{row.result}</span>
                    </td>
                    <td style={styles.tableCell}>{Number(row.endpointsSynchronized || 0).toLocaleString()}</td>
                    <td style={styles.tableCell}>{Number(row.skipped || 0).toLocaleString()}</td>
                    <td style={styles.tableCell}>{Number(row.failedEndpointUpdates || 0).toLocaleString()}</td>
                    <td style={styles.tableCellCompact}>
                      {row.detailsLabel === 'View' ? (
                        <button
                          type="button"
                          style={styles.detailsButton}
                          onClick={() => {
                            setSelectedDetails(row.diagnosticSummary);
                            setCopyFeedback('');
                          }}
                        >
                          View
                        </button>
                      ) : (
                        <span style={styles.detailsMuted}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDetails ? (
        <div style={styles.dialogBackdrop}>
          <div role="dialog" aria-modal="true" aria-labelledby="entra-history-details-title" style={styles.dialog}>
            <div style={styles.dialogHeader}>
              <div>
                <h2 id="entra-history-details-title" style={styles.dialogTitle}>Run details</h2>
              </div>
              <button className="btn-secondary" type="button" onClick={() => setSelectedDetails(null)}>
                Close
              </button>
            </div>

            <div style={styles.dialogBody}>
              {selectedDetails.lines.map((line) => (
                <p key={line} style={styles.detailLine}>{line}</p>
              ))}
            </div>

            <div style={styles.dialogActions}>
              {copyFeedback ? <span style={styles.detailsMuted}>{copyFeedback}</span> : null}
              <button className="btn-secondary" type="button" onClick={handleCopyDetails}>
                Copy details
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default History;
