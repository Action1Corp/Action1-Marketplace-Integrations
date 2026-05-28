import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { DataTable, PAGE_SIZE, useIntegrationMeta } from './viewToolkit.jsx';

function Vulnerabilities({ integration }) {
  const meta = useIntegrationMeta(integration);
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const display = meta?.display?.vulnerabilities || {};
  const columns = display.columns || [];

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    query.set('integration', integration);
    query.set('page', '1');
    query.set('pageSize', String(PAGE_SIZE));
    fetch(`/api/vulnerabilities?${query}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration, location.search]);

  return <DataTable title={display.title || 'Vulnerabilities'} columns={columns} rows={rows} emptyText={display.emptyText} integration={integration} />;
}

export default Vulnerabilities;
