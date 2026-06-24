import { useEffect, useState } from 'react';
import { buildHistoryRows } from '../historyViewModel.mjs';

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

function resultTone(result) {
  if (result === 'Completed') return { color: '#15803D' };
  if (result === 'Running') return { color: '#1D4ED8' };
  if (result === 'Interrupted') return { color: '#92400E' };
  if (result === 'Failed') return { color: '#B91C1C' };
  return { color: '#334155' };
}

function History({ integration }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

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
        throw new Error(data?.error || 'Unable to load HaloPSA history.');
      }

      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load HaloPSA history.');
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

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>History</h1>
        <p style={styles.description}>
          Review recent HaloPSA synchronization runs and Marketplace action results.
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
          <div style={styles.emptyState}>No HaloPSA runs have been recorded yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHead}>Started</th>
                  <th style={styles.tableHead}>Result</th>
                  <th style={styles.tableHead}>Created</th>
                  <th style={styles.tableHead}>Updated</th>
                  <th style={styles.tableHead}>Skipped</th>
                  <th style={styles.tableHead}>Failed</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((row) => (
                  <tr key={row.id ?? `${row.started}-${row.result}`}>
                    <td style={styles.tableCell}>{row.started}</td>
                    <td style={styles.tableCell}>
                      <span style={{ ...styles.resultText, ...resultTone(row.result) }}>{row.result}</span>
                    </td>
                    <td style={styles.tableCell}>{Number(row.created || 0).toLocaleString()}</td>
                    <td style={styles.tableCell}>{Number(row.updated || 0).toLocaleString()}</td>
                    <td style={styles.tableCell}>{Number(row.skipped || 0).toLocaleString()}</td>
                    <td style={styles.tableCell}>{Number(row.failed || 0).toLocaleString()}</td>
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

export default History;
