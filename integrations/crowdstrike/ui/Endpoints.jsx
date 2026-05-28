import { useEffect, useState } from 'react';
import { DataTable, PAGE_SIZE, useIntegrationMeta } from './viewToolkit.jsx';

function Endpoints({ integration }) {
  const meta = useIntegrationMeta(integration);
  const [rows, setRows] = useState([]);
  const display = meta?.display?.endpoints || {};
  const columns = display.columns || [];

  useEffect(() => {
    fetch(`/api/endpoints?integration=${integration}&page=1&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);

  return <DataTable title={display.title || 'Endpoints'} columns={columns} rows={rows} emptyText={display.emptyText} integration={integration} />;
}

export default Endpoints;
