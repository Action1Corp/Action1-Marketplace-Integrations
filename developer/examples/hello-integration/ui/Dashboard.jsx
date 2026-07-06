import { Link } from 'react-router-dom';

function Dashboard({ integration }) {
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: '0.35rem' }}>Hello Integration Dashboard</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
          This dashboard is owned by the integration package, not by the Marketplace dashboard renderer.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          ['View source', 'ui/Dashboard.jsx'],
          ['Screen owner', 'Hello Integration'],
          ['Render model', 'Downloaded package']
        ].map(([label, value]) => (
          <div key={label} className="glass-panel" style={{ margin: 0 }}>
            <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ marginTop: '0.4rem', fontSize: '1.1rem', fontWeight: 800, color: '#111827' }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="glass-panel">
        <h3 style={{ margin: '0 0 0.5rem 0' }}>Developer-owned UI</h3>
        <p style={{ margin: '0 0 1rem 0', color: '#4B5563', lineHeight: 1.55 }}>
          An integration can provide React components for screens such as dashboard, endpoints, vulnerabilities,
          settings, or custom paths. The Marketplace still owns auth, routing, permissions, and APIs.
        </p>
        <Link className="btn-primary" style={{ display: 'inline-flex', textDecoration: 'none' }} to={`/apps/${integration}/actions-lab`}>
          Open Actions Lab
        </Link>
      </div>
    </div>
  );
}

export default Dashboard;
