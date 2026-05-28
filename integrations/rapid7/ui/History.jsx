import { useEffect, useState } from 'react';
import { DataTable, PAGE_SIZE, useIntegrationMeta } from './viewToolkit.jsx';

function History({ integration }) {
  const meta = useIntegrationMeta(integration);
  const [rows, setRows] = useState([]);
  const display = meta?.display?.history || {};
  const columns = display.columns || [];

  useEffect(() => {
    fetch(`/api/history?integration=${integration}&page=1&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);

  return <DataTable title={display.title || 'Run History'} columns={columns} rows={rows} emptyText={display.emptyText} integration={integration} />;
}

export default History;
