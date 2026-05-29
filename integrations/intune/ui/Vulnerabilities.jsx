import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';

const PAGE_SIZE = 50;
const fallbackDisplay = {
  title: 'Vulnerabilities',
  searchPlaceholder: 'Global search across vulnerability columns...',
  emptyText: 'No vulnerabilities match the current filters.',
  defaultSort: { key: 'severity', direction: 'asc' },
  columns: [
    { key: 'cve', label: 'CVE', type: 'nistLink', filterParam: 'cve' },
    { key: 'severity', label: 'Severity', type: 'severityBadgeDynamic', filterParam: 'severityColumn' },
    { key: 'endpoint_name', label: 'Endpoint', filterParam: 'endpoint_name' },
    { key: 'plugin_name', label: 'Plugin Name', type: 'muted', filterParam: 'plugin_name' },
    { key: 'status', label: 'Status', type: 'patchStatus', filterParam: 'statusColumn' }
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

function Vulnerabilities() {
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

  const display = integrationMeta?.display?.vulnerabilities || fallbackDisplay;
  const columns = Array.isArray(display.columns) && display.columns.length > 0 ? display.columns : fallbackDisplay.columns;
  const params = new URLSearchParams(location.search);
  const severityFilter = params.get('severity') || '';
  const statusFilter = params.get('status') || '';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketplace/${integration}`)
      .then(r => r.json())
      .then(meta => {
        if (cancelled) return;
        const vulnerabilitiesDisplay = meta.display?.vulnerabilities || fallbackDisplay;
        setIntegrationMeta(meta);
        setSortConfig(vulnerabilitiesDisplay.defaultSort || fallbackDisplay.defaultSort);
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
    const apiParams = new URLSearchParams({
      integration,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortKey: sortConfig.key,
      sortDirection: sortConfig.direction
    });

    if (searchQuery) apiParams.set('search', searchQuery);
    if (severityFilter) apiParams.set('severityFilter', severityFilter);
    if (statusFilter) apiParams.set('statusFilter', statusFilter);

    for (const column of columns) {
      const value = colFilters[column.key];
      if (column.filter !== false && value) apiParams.set(column.filterParam || column.key, value);
    }

    return apiParams.toString();
  }, [integration, page, sortConfig, searchQuery, severityFilter, statusFilter, colFilters, columns]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cves?${fetchParams}`)
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
  }, [integration, searchQuery, sortConfig, severityFilter, statusFilter, colFilters]);

  const handleSort = column => {
    if (column.sortable === false) return;
    setSortConfig(prev => ({ key: column.key, direction: prev.key === column.key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const setCol = (key, val) => setColFilters(prev => ({ ...prev, [key]: val }));
  const arrow = column => column.sortable === false ? '' : sortConfig.key === column.key ? (sortConfig.direction === 'asc' ? ' (asc)' : ' (desc)') : '';
  const colInput = { width: '100%', padding: '3px 6px', fontSize: '0.78rem', border: '1px solid #E5E7EB', borderRadius: '3px', background: '#fff' };
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const activeFilter = severityFilter
    ? `Severity: ${severityFilter}`
    : statusFilter
    ? `Status: ${statusFilter}`
    : null;

  const renderCell = (row, column) => {
    const value = row[column.key];
    if (column.type === 'nistLink') {
      return (
        <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem' }}>
          <a
            href={`https://nvd.nist.gov/vuln/detail/${value}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${value} in NIST NVD`}
            style={{ color: 'var(--action1-blue)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
          >
            {value}
          </a>
        </td>
      );
    }
    if (column.type === 'severityBadgeDynamic') {
      return <td><span className={`badge badge-${String(value || '').toLowerCase()}`}>{value}</span></td>;
    }
    if (column.type === 'muted') return <td style={{ color: '#6B7280', fontSize: '0.82rem' }}>{value}</td>;
    if (column.type === 'patchStatus') {
      return (
        <td>
          <span style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: value === 'Patch Available' ? '#15803D' : value === 'No Patch Available' ? '#B91C1C' : '#6B7280'
          }}>
            {value}
          </span>
        </td>
      );
    }
    return <td>{value}</td>;
  };

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={display.searchPlaceholder || fallbackDisplay.searchPlaceholder}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ padding: '0.55rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', width: '320px', fontSize: '0.875rem' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {activeFilter && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', background: '#EFF6FF', color: '#1D4ED8', padding: '0.3rem 0.7rem', borderRadius: '999px', border: '1px solid #BFDBFE' }}>
              Filter: {activeFilter}
              <Link to={`/apps/${integration}/vulnerabilities`} style={{ color: '#1D4ED8', fontWeight: 700, textDecoration: 'none' }}>x</Link>
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
                <th key={column.key} onClick={() => handleSort(column)} style={{ cursor: column.sortable === false ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {column.label}{arrow(column)}
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

export default Vulnerabilities;
