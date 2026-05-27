import { useState } from 'react';

const actions = [
  {
    id: 'inspect-settings',
    title: 'Inspect Settings',
    description: 'Returns a safe summary of values supplied to the integration action handler.',
    buttonLabel: 'Inspect'
  },
  {
    id: 'generate-summary',
    title: 'Generate Summary',
    description: 'Returns an example operational summary payload for the custom screen.',
    buttonLabel: 'Generate'
  },
  {
    id: 'runtime-diagnostics',
    title: 'Runtime Diagnostics',
    description: 'Uses Marketplace runtime context to return integration and database information.',
    buttonLabel: 'Run Diagnostics'
  }
];

function renderValue(value) {
  if (value === null || value === undefined || value === '') return <span style={{ color: '#9CA3AF' }}>Not provided</span>;
  if (typeof value === 'object') {
    return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>{JSON.stringify(value, null, 2)}</pre>;
  }
  return String(value);
}

function Result({ result }) {
  if (!result) return null;
  const details = result.details && typeof result.details === 'object' ? Object.entries(result.details) : [];
  return (
    <div style={{ marginTop: '0.8rem', padding: '0.8rem', borderRadius: 6, border: '1px solid #BFDBFE', background: '#EFF6FF' }}>
      <div style={{ color: '#1D4ED8', fontWeight: 800, fontSize: '0.85rem' }}>{result.message || 'Action completed.'}</div>
      {details.length > 0 && (
        <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.7rem' }}>
          {details.map(([key, value]) => (
            <div key={key} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: '0.75rem', fontSize: '0.82rem' }}>
              <strong style={{ color: '#4B5563' }}>{key}</strong>
              <span>{renderValue(value)}</span>
            </div>
          ))}
        </div>
      )}
      {result.data !== undefined && <div style={{ marginTop: '0.75rem' }}>{renderValue(result.data)}</div>}
    </div>
  );
}

function ActionsLab({ integration }) {
  const [running, setRunning] = useState('');
  const [results, setResults] = useState({});

  const runAction = async (action) => {
    setRunning(action.id);
    setResults(current => ({ ...current, [action.id]: null }));
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${action.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { screen: 'actions-lab', source: 'integration-owned-ui' } })
      });
      const result = await response.json().catch(() => ({}));
      setResults(current => ({ ...current, [action.id]: response.ok ? result : { ok: false, message: result.message || 'Action failed.' } }));
    } catch (error) {
      setResults(current => ({ ...current, [action.id]: { ok: false, message: error.message || 'Action failed.' } }));
    } finally {
      setRunning('');
    }
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: '0.35rem' }}>Actions Lab</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
          This screen is rendered by the integration-owned React component at ui/ActionsLab.jsx.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        {actions.map(action => (
          <div key={action.id} className="glass-panel" style={{ margin: 0 }}>
            <div style={{ minHeight: 96 }}>
              <h3 style={{ margin: '0 0 0.45rem 0' }}>{action.title}</h3>
              <p style={{ margin: 0, color: '#6B7280', fontSize: '0.85rem', lineHeight: 1.5 }}>{action.description}</p>
            </div>
            <button className="btn-primary" type="button" onClick={() => runAction(action)} disabled={!!running} style={{ width: '100%', justifyContent: 'center' }}>
              {running === action.id ? 'Running...' : action.buttonLabel}
            </button>
            <Result result={results[action.id]} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActionsLab;
