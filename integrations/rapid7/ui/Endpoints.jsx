import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

const PAGE_SIZE = 50;
const fallbackDisplay = {
  title: 'Endpoints',
  searchPlaceholder: 'Global search across endpoint columns...',
  emptyText: 'No endpoints match the current filters.',
  defaultSort: { key: 'endpoint_name', direction: 'asc' },
  columns: [
    { key: 'endpoint_name', label: 'Name', type: 'strong' },
    { key: 'ipv4', label: 'IP Address', type: 'monospace' },
    { key: 'os', label: 'OS' },
    { key: 'integration_total_vulns', label: '{integrationName} Total', type: 'number' },
    { key: 'action1_total_vulns', label: 'Action1 Total', type: 'number' },
    { key: 'critical_vulns', label: 'Critical', type: 'severityBadge', severity: 'critical' },
    { key: 'high_vulns', label: 'High', type: 'severityBadge', severity: 'high' },
    { key: 'medium_vulns', label: 'Medium', type: 'severityBadge', severity: 'medium' },
    { key: 'low_vulns', label: 'Low', type: 'severityBadge', severity: 'low' },
    { key: 'status', label: 'Status', type: 'syncStatus' }
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

function tokenText(value, integrationName) {
  return String(value || '').replaceAll('{integrationName}', integrationName);
}

function Endpoints() {
  const { integration } = useParams();
  const location = useLocation();
  const [integrationMeta, setIntegrationMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState(fallbackDisplay.defaultSort);
  const [colFilters, setColFilters] = useState({});

  const integrationName = integrationMeta?.name || integration.charAt(0).toUpperCase() + integration.slice(1);
  const display = fallbackDisplay;
  const columns = fallbackDisplay.columns;
  const filterType = new URLSearchParams(location.search).get('filter') || '';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketplace/${integration}`)
      .then(r => r.json())
      .then(meta => {
        if (cancelled) return;
        setIntegrationMeta(meta);
        setSortConfig(fallbackDisplay.defaultSort);
        setColFilters({});
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
    if (filterType) params.set('filterType', filterType);

    for (const column of columns) {
      const value = colFilters[column.key];
      if (column.filter !== false && value) params.set(column.filterParam || column.key, value);
    }

    return params.toString();
  }, [integration, page, sortConfig, searchQuery, colFilters, filterType, columns]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/endpoints?${fetchParams}`)
      .then(r => r.json())
      .then(data => {
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [fetchParams]);

  useEffect(() => {
    setPage(1);
  }, [integration, searchQuery, sortConfig, colFilters, filterType]);

  const handleSort = column => {
    if (column.sortable === false) return;
    setSortConfig(prev => ({ key: column.key, direction: prev.key === column.key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const setCol = (key, val) => setColFilters(prev => ({ ...prev, [key]: val }));
  const getStatus = ep =>
    ep.missing_from_tenable ? `Missing (${integrationName})` : ep.missing_from_action1 ? 'Missing (Action1)' : 'Synced';
  const arrow = column => column.sortable === false ? '' : sortConfig.key === column.key ? (sortConfig.direction === 'asc' ? ' (asc)' : ' (desc)') : '';
  const colInput = { width: '100%', padding: '3px 6px', fontSize: '0.78rem', border: '1px solid #E5E7EB', borderRadius: '3px', background: '#fff' };
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const renderCell = (row, column) => {
    const value = row[column.key];
    if (column.type === 'strong') return <td style={{ fontWeight: 600 }}>{value}</td>;
    if (column.type === 'monospace') return <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{value}</td>;
    if (column.type === 'number') return <td style={{ fontWeight: 600 }}>{value ?? 0}</td>;
    if (column.type === 'severityBadge') {
      return <td><span className={`badge badge-${column.severity || column.key.replace('_vulns', '')}`}>{value ?? 0}</span></td>;
    }
    if (column.type === 'syncStatus') {
      const missing = row.missing_from_tenable || row.missing_from_action1;
      return (
        <td>
          <span className={`status-pill ${missing ? 'status-failed' : 'status-success'}`}>
            {getStatus(row)}
          </span>
        </td>
      );
    }
    return <td>{value}</td>;
  };

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={display.searchPlaceholder || fallbackDisplay.searchPlaceholder}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ padding: '0.55rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', width: '320px', fontSize: '0.875rem' }}
        />
        <span style={{ fontSize: '0.85rem', color: '#9CA3AF', alignSelf: 'center' }}>{total} result{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column.key} onClick={() => handleSort(column)} style={{ cursor: column.sortable === false ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {tokenText(column.label, integrationName)}{arrow(column)}
                </th>
              ))}
            </tr>
            <tr style={{ background: '#F9FAFB' }}>
              {columns.map(column => (
                <th key={column.key} style={{ padding: '6px 8px', fontWeight: 'normal' }}>
                  {column.filter === false ? null : (
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters[column.key] || ''}
                      style={colInput}
                      onChange={e => setCol(column.key, e.target.value)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                {columns.map(column => renderCell(row, column))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} style={{ textAlign: 'center', padding: '2.5rem', color: '#9CA3AF' }}>{display.emptyText || fallbackDisplay.emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

export default Endpoints;
