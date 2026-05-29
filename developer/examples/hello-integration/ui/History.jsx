import { useEffect, useState } from 'react';
import { DataTable, PAGE_SIZE } from './viewToolkit.jsx';

function History({ integration }) {
  const [rows, setRows] = useState([]);
  const columns = [
    { key: 'id', label: 'Run ID', type: 'runId' },
    { key: 'timestamp', label: 'Timestamp', type: 'datetime' },
    { key: 'status', label: 'Status', type: 'runStatus' },
    { key: 'assets_processed', label: 'Items Processed', type: 'number' },
    { key: 'actions', label: 'Actions', type: 'historyActions', sortable: false }
  ];

  useEffect(() => {
    fetch(`/api/history?integration=${integration}&page=1&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);

  return <DataTable title="Run History" columns={columns} rows={rows} emptyText="No run history found matching criteria." integration={integration} />;
}

export default History;
