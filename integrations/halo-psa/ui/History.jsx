import { useEffect, useState } from 'react';

function History({ integration }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetch(`/api/history?integration=${integration}&page=1&pageSize=50`)
      .then(response => response.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);

  return (
    <div>
      <h1 className="page-title">Run History</h1>
      <div className="glass-panel">
        {rows.length === 0 ? (
          <div style={{ color: '#6B7280' }}>No runs have been recorded yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Action</th>
                <th>Timestamp</th>
                <th>Status</th>
                <th>Items Processed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>#{row.id}</td>
                  <td>{row.action_label || row.action_id || 'Action'}</td>
                  <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : ''}</td>
                  <td>{row.status}</td>
                  <td>{Number(row.assets_processed || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default History;
