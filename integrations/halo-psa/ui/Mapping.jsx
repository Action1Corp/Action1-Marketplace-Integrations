import { useEffect, useState } from 'react';

const ACTIONS = {
  list: 'list-halo-org-client-mappings',
  save: 'save-halo-org-client-mapping',
  remove: 'delete-halo-org-client-mapping',
  discover: 'discover-halo-mapping-options'
};

const EMPTY_DRAFT = {
  id: null,
  action1OrgId: '',
  action1OrgName: '',
  haloClientId: '',
  haloClientName: '',
  enabled: true
};

function normalizeClientOptions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = String(row?.id || '').trim();
      const name = String(row?.name || '').trim();
      if (!id || !name) {
        return null;
      }
      return {
        value: id,
        label: `${name} (${id})`,
        name
      };
    })
    .filter(Boolean);
}

function Mapping({ integration }) {
  const [mappings, setMappings] = useState([]);
  const [haloClients, setHaloClients] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [discoveryError, setDiscoveryError] = useState('');

  const loadMappings = async () => {
    const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.list}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || 'Unable to load mappings.');
    }
    setMappings(Array.isArray(data?.mappings) ? data.mappings : []);
  };

  const refreshMappings = async () => {
    setMessage('');
    setError('');
    try {
      await loadMappings();
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load mappings.');
    }
  };

  const loadHaloClients = async () => {
    setDiscovering(true);
    setDiscoveryError('');
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.discover}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: {} })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.message || 'Unable to load Halo client options.');
      }
      setHaloClients(Array.isArray(data?.haloClients) ? data.haloClients : []);
    } catch (nextError) {
      setHaloClients([]);
      setDiscoveryError(nextError?.message || 'Unable to load Halo client options.');
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        await Promise.all([loadMappings(), loadHaloClients()]);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError?.message || 'Unable to load mapping screen.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [integration]);

  const clientOptions = normalizeClientOptions(haloClients);
  const selectedClientExists = clientOptions.some((row) => row.value === draft.haloClientId);
  const effectiveClientOptions = draft.haloClientId && draft.haloClientName && !selectedClientExists
    ? [...clientOptions, { value: draft.haloClientId, label: `${draft.haloClientName} (${draft.haloClientId})`, name: draft.haloClientName }]
    : clientOptions;

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setMessage('');
    setError('');
  };

  const startEdit = (row) => {
    setDraft({
      id: row.id,
      action1OrgId: row.action1OrgId || '',
      action1OrgName: row.action1OrgName || '',
      haloClientId: row.haloClientId || '',
      haloClientName: row.haloClientName || '',
      enabled: row.enabled !== false
    });
    setMessage('');
    setError('');
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.save}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: draft })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.message || 'Unable to save mapping.');
      }

      setMappings(Array.isArray(data?.mappings) ? data.mappings : []);
      setDraft(EMPTY_DRAFT);
      setMessage(data?.message || 'Mapping saved.');
    } catch (nextError) {
      setError(nextError?.message || 'Unable to save mapping.');
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row) => {
    setMessage('');
    setError('');
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.remove}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { id: row.id } })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.message || 'Unable to delete mapping.');
      }
      setMappings(Array.isArray(data?.mappings) ? data.mappings : []);
      if (draft.id === row.id) {
        setDraft(EMPTY_DRAFT);
      }
      setMessage(data?.message || 'Mapping deleted.');
    } catch (nextError) {
      setError(nextError?.message || 'Unable to delete mapping.');
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading mapping screen...</div>;
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div className="glass-panel">
        <h3 style={{ marginTop: 0 }}>Action1 Organization To Halo Client Mapping</h3>
        <p style={{ color: '#6B7280', fontSize: '0.88rem', lineHeight: 1.5 }}>
          Mapping rows are stored in HaloPSA-owned database tables, not in Marketplace settings. Halo client options can be refreshed from HaloPSA when connection settings are configured. Action1 organization discovery is not wired yet, so Action1 organization values are entered manually in this slice.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button className="btn-secondary" type="button" onClick={refreshMappings}>
            Refresh Mappings
          </button>
          <button className="btn-secondary" type="button" onClick={loadHaloClients} disabled={discovering}>
            {discovering ? 'Refreshing Halo Clients...' : 'Refresh Halo Clients'}
          </button>
        </div>

        {message && <div style={{ color: '#15803D', marginBottom: '0.75rem' }}>{message}</div>}
        {error && <div style={{ color: '#DC2626', marginBottom: '0.75rem' }}>{error}</div>}
        {discoveryError && <div style={{ color: '#B45309', marginBottom: '0.75rem' }}>{discoveryError}</div>}

        <form onSubmit={saveDraft} style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>Action1 Organization ID</label>
              <input
                type="text"
                value={draft.action1OrgId}
                onChange={(event) => setDraft((current) => ({ ...current, action1OrgId: event.target.value }))}
                style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>Action1 Organization Name</label>
              <input
                type="text"
                value={draft.action1OrgName}
                onChange={(event) => setDraft((current) => ({ ...current, action1OrgName: event.target.value }))}
                style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>Halo Client ID</label>
              {effectiveClientOptions.length > 0 ? (
                <select
                  value={draft.haloClientId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const selected = effectiveClientOptions.find((row) => row.value === nextId);
                    setDraft((current) => ({
                      ...current,
                      haloClientId: nextId,
                      haloClientName: selected?.name || current.haloClientName
                    }));
                  }}
                  style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4, background: '#fff' }}
                >
                  <option value="">Select...</option>
                  {effectiveClientOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={draft.haloClientId}
                  onChange={(event) => setDraft((current) => ({ ...current, haloClientId: event.target.value }))}
                  style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
                />
              )}
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>Halo Client Name</label>
              <input
                type="text"
                value={draft.haloClientName}
                onChange={(event) => setDraft((current) => ({ ...current, haloClientName: event.target.value }))}
                style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
              />
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            Mapping enabled
          </label>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving...' : draft.id ? 'Update Mapping' : 'Create Mapping'}
            </button>
            <button className="btn-secondary" type="button" onClick={resetDraft}>
              Clear Draft
            </button>
          </div>
        </form>

        {mappings.length === 0 ? (
          <div style={{ color: '#6B7280', fontSize: '0.9rem' }}>
            No mappings have been saved yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Action1 Org</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Halo Client</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Enabled</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((row) => (
                  <tr key={row.id}>
                    <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>
                      <strong>{row.action1OrgName}</strong>
                      <div style={{ color: '#6B7280', fontSize: '0.82rem' }}>{row.action1OrgId}</div>
                    </td>
                    <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>
                      <strong>{row.haloClientName}</strong>
                      <div style={{ color: '#6B7280', fontSize: '0.82rem' }}>{row.haloClientId}</div>
                    </td>
                    <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>
                      {row.enabled ? 'Enabled' : 'Disabled'}
                    </td>
                    <td style={{ padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="btn-secondary" type="button" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        <button className="btn-secondary" type="button" onClick={() => deleteRow(row)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Mapping;
