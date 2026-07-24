import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
import { useParams } from 'react-router-dom';

const PAGE_SIZE = 25;
const fallbackDisplay = {
  title: 'Run History',
  searchPlaceholder: 'Search history...',
  emptyText: 'No sync history found matching criteria.',
  defaultSort: { key: 'id', direction: 'desc' },
  columns: [
    { key: 'id', label: 'Run ID', type: 'runId' },
    { key: 'action_label', label: 'Action', type: 'text' },
    { key: 'timestamp', label: 'Timestamp', type: 'datetime' },
    { key: 'status', label: 'Status', type: 'runStatus' },
    { key: 'assets_processed', label: 'Endpoints Processed', type: 'number' },
    { key: 'actions', label: 'Actions', type: 'historyActions', sortable: false }
  ]
};

function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.85rem', color: '#6B7280' }}>Page {page} of {totalPages}</span>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn-secondary" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Previous</button>
        <button className="btn-secondary" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>Next</button>
      </div>
    </div>
  );
}

function History() {
  const { integration } = useParams();
  const [integrationMeta, setIntegrationMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState(fallbackDisplay.defaultSort);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const display = fallbackDisplay;
  const columns = fallbackDisplay.columns;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketplace/${integration}`)
      .then(r => r.json())
      .then(meta => {
        if (cancelled) return;
        setIntegrationMeta(meta);
        setSortConfig(fallbackDisplay.defaultSort);
      })
      .catch(() => {
        if (!cancelled) setIntegrationMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [integration]);

  const fetchParams = useMemo(() => {
    const params = new URLSearchParams({
      integration,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortKey: sortConfig.key,
      sortDirection: sortConfig.direction
    });

    if (searchQuery) params.set('search', searchQuery);
    return params.toString();
  }, [integration, page, sortConfig, searchQuery]);

  const fetchHistory = useCallback((showLoading = false) => {
    if (showLoading) setLoading(true);
    return fetch(`/api/history?${fetchParams}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch history');
        return res.json();
      })
      .then(data => {
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setLastRefreshedAt(new Date());
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [fetchParams]);

  useEffect(() => {
    fetchHistory(true);
  }, [fetchHistory]);

  useEffect(() => {
    setPage(1);
  }, [integration, searchQuery, sortConfig]);

  const handleSort = (column) => {
    if (column.sortable === false) return;
    let direction = 'desc';
    if (sortConfig.key === column.key && sortConfig.direction === 'desc') direction = 'asc';
    setSortConfig({ key: column.key, direction });
  };

  const toggleRow = (id) => {
    if (expandedRow === id) setExpandedRow(null);
    else setExpandedRow(id);
  };

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const isAutoRefreshing = rows.some(row => row.status === 'Running') || expandedRow !== null;

  useEffect(() => {
    if (!isAutoRefreshing) return undefined;

    const interval = setInterval(() => {
      fetchHistory(false);
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchHistory, isAutoRefreshing]);

  const arrow = column => column.sortable === false ? '' : sortConfig.key === column.key ? (sortConfig.direction === 'asc' ? ' (asc)' : ' (desc)') : '';

  const renderCell = (row, column) => {
    const value = row[column.key];
    if (column.type === 'runId') return <td style={{ fontWeight: '500' }}>#{row.integration_run_id ?? value}</td>;
    if (column.type === 'datetime') return <td>{value ? new Date(value).toLocaleString() : ''}</td>;
    if (column.type === 'runStatus') {
      return (
        <td>
          <span className={`status-pill ${
            row.status === 'Success' ? 'status-success' :
            row.status === 'Running' ? 'status-running' : 'status-failed'
          }`}>
            {row.status}
          </span>
        </td>
      );
    }
    if (column.type === 'number') return <td>{value || 0}</td>;
    if (column.type === 'historyActions') {
      return (
        <td>
          <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>
            {expandedRow === row.id ? 'Hide Logs' : 'View Logs'}
          </button>
        </td>
      );
    }
    return <td>{value}</td>;
  };

  if (loading) return <div>Loading history...</div>;
  if (error) return <div style={{ color: 'var(--critical-red)' }}>{error}</div>;

  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap'}}>
        <h2 className="page-title" style={{margin: 0}}>{display.title || fallbackDisplay.title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <input
            type="text"
            placeholder={display.searchPlaceholder || fallbackDisplay.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.6rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
              width: '300px'
            }}
          />
          {lastRefreshedAt && (
            <span style={{ fontSize: '0.8rem', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
              {isAutoRefreshing ? 'Auto-refreshing' : 'Updated'} {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
          <span style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>{total} result{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column.key} onClick={() => handleSort(column)} style={{cursor: column.sortable === false ? 'default' : 'pointer'}}>
                  {column.label}{arrow(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '2rem' }}>{display.emptyText || fallbackDisplay.emptyText}</td>
              </tr>
            ) : (
              rows.map(row => (
                <React.Fragment key={row.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => toggleRow(row.id)}>
                    {columns.map(column => renderCell(row, column))}
                  </tr>
                  {expandedRow === row.id && (
                    <tr style={{ backgroundColor: '#F9FAFB' }}>
                      <td colSpan={columns.length} style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Log Details:</div>
                        <pre style={{
                          margin: 0,
                          padding: '1rem',
                          background: '#1F2937',
                          color: '#F3F4F6',
                          borderRadius: '4px',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          maxHeight: '420px',
                          overflowY: 'auto'
                        }}>
                          {row.details || 'No details string logged.'}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

export default History;
