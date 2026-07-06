import { useEffect, useState } from 'react';

const ACTIONS = {
  list: 'list-halo-org-client-mappings',
  save: 'save-halo-org-client-mapping',
  remove: 'delete-halo-org-client-mapping',
  discoverAction1: 'discover-action1-mapping-options',
  discover: 'discover-halo-mapping-options'
};

const EMPTY_ROW = {
  id: null,
  action1OrgId: '',
  action1OrgName: '',
  haloClientId: '',
  haloClientName: ''
};

const styles = {
  page: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
    display: 'grid',
    gap: '0.5rem'
  },
  header: {
    display: 'grid',
    gap: '0.35rem'
  },
  panel: {
    padding: '1.25rem',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.82)'
  },
  section: {
    padding: '0.35rem 0',
    border: 'none',
    borderRadius: 8,
    background: 'transparent'
  },
  headingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
    marginBottom: '1rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    lineHeight: 1.2
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.25
  },
  description: {
    margin: '0.35rem 0 0',
    color: '#4B5563',
    fontSize: '0.92rem',
    lineHeight: 1.6,
    maxWidth: 760
  },
  buttonRow: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '0.75rem'
  },
  statCard: {
    padding: '0.85rem 0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    background: '#fff'
  },
  statLabel: {
    margin: 0,
    color: '#6B7280',
    fontSize: '0.78rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  statValue: {
    margin: '0.35rem 0 0',
    fontSize: '1.2rem',
    fontWeight: 700
  },
  statusMessage: {
    margin: 0,
    padding: '0.85rem 0.95rem',
    borderRadius: 8,
    fontSize: '0.92rem',
    lineHeight: 1.5
  },
  input: {
    width: '100%',
    padding: '0.55rem 0.65rem',
    border: '1px solid var(--border-color)',
    borderRadius: 6,
    background: '#fff'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHead: {
    textAlign: 'left',
    padding: '0.55rem 0.65rem',
    borderBottom: '1px solid var(--border-color)',
    color: '#4B5563',
    fontSize: '0.82rem',
    textTransform: 'uppercase',
    letterSpacing: '0.03em'
  },
  tableCell: {
    padding: '0.45rem 0.65rem',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle'
  },
  actionCell: {
    padding: '0.45rem 0.65rem',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    width: 1
  },
  tableButtonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginTop: '0.9rem',
    flexWrap: 'wrap'
  },
  tableFeedback: {
    minHeight: '2.5rem',
    display: 'flex',
    alignItems: 'center',
    flex: '1 1 240px'
  },
  technicalDetails: {
    marginTop: '0.75rem'
  },
  technicalPre: {
    margin: '0.65rem 0 0',
    padding: '0.85rem',
    borderRadius: 8,
    background: 'rgba(17, 24, 39, 0.92)',
    color: '#E5E7EB',
    overflowX: 'auto',
    fontSize: '0.78rem',
    lineHeight: 1.55
  }
};

function normalizeOptions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = String(row?.id || '').trim();
      const name = String(row?.name || '').trim();

      if (!id || !name) {
        return null;
      }

      return {
        value: id,
        label: name,
        name
      };
    })
    .filter(Boolean);
}

function ensureSelectedOption(options, value, name) {
  const selectedValue = String(value || '').trim();
  const selectedName = String(name || '').trim();

  if (!selectedValue || !selectedName) {
    return options;
  }

  if (options.some((row) => row.value === selectedValue)) {
    return options;
  }

  return [
    ...options,
    {
      value: selectedValue,
      label: selectedName,
      name: selectedName
    }
  ];
}

function rowsEquivalent(left, right) {
  return (
    String(left?.action1OrgId || '') === String(right?.action1OrgId || '') &&
    String(left?.action1OrgName || '') === String(right?.action1OrgName || '') &&
    String(left?.haloClientId || '') === String(right?.haloClientId || '') &&
    String(left?.haloClientName || '') === String(right?.haloClientName || '')
  );
}

function normalizeMappingRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row?.id ?? null,
    action1OrgId: String(row?.action1OrgId || ''),
    action1OrgName: String(row?.action1OrgName || ''),
    haloClientId: String(row?.haloClientId || ''),
    haloClientName: String(row?.haloClientName || '')
  }));
}

function mappingOptionsForRow(allOptions, rows, rowIndex, valueKey, nameKey) {
  const normalized = normalizeOptions(allOptions);
  const selectedInOtherRows = new Set(
    rows
      .filter((_, idx) => idx !== rowIndex)
      .map((row) => String(row?.[valueKey] || '').trim())
      .filter(Boolean)
  );
  const currentRow = rows[rowIndex] || EMPTY_ROW;
  const currentValue = String(currentRow?.[valueKey] || '').trim();

  const allowed = normalized.filter((option) => {
    if (option.value === currentValue) {
      return true;
    }

    return !selectedInOtherRows.has(option.value);
  });

  return ensureSelectedOption(allowed, currentRow?.[valueKey], currentRow?.[nameKey]);
}

function buildPersistRows(rows, action1Organizations, haloClients) {
  const errors = [];
  const persistRows = [];
  const orgsById = new Map(normalizeOptions(action1Organizations).map((row) => [row.value, row.name]));
  const clientsById = new Map(normalizeOptions(haloClients).map((row) => [row.value, row.name]));
  const seenAction1 = new Set();
  const seenClients = new Set();

  for (const row of rows) {
    const action1OrgId = String(row?.action1OrgId || '').trim();
    const haloClientId = String(row?.haloClientId || '').trim();
    const action1OrgName = String(orgsById.get(action1OrgId) || row?.action1OrgName || '').trim();
    const haloClientName = String(clientsById.get(haloClientId) || row?.haloClientName || '').trim();

    if (!action1OrgId && !haloClientId) {
      continue;
    }

    if (!action1OrgId || !haloClientId) {
      errors.push('Select both an Action1 organization and a HaloPSA client, or remove the incomplete row.');
      continue;
    }

    if (seenAction1.has(action1OrgId)) {
      errors.push('Each Action1 organization can only be mapped once. Remove duplicate mappings before saving.');
    } else {
      seenAction1.add(action1OrgId);
    }

    if (seenClients.has(haloClientId)) {
      errors.push('Each HaloPSA client can only be mapped once. Remove duplicate mappings before saving.');
    } else {
      seenClients.add(haloClientId);
    }

    persistRows.push({
      id: row?.id ?? null,
      action1OrgId,
      action1OrgName,
      haloClientId,
      haloClientName,
      enabled: true
    });
  }

  return {
    errors: Array.from(new Set(errors)),
    persistRows
  };
}

function DiagnosticDetails({ diagnostics }) {
  if (!diagnostics) {
    return null;
  }

  return (
    <details style={styles.technicalDetails}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Technical details</summary>
      <pre style={styles.technicalPre}>{JSON.stringify(diagnostics, null, 2)}</pre>
    </details>
  );
}

function Mapping({ integration }) {
  const [savedMappings, setSavedMappings] = useState([]);
  const [draftRows, setDraftRows] = useState([]);
  const [action1Organizations, setAction1Organizations] = useState([]);
  const [haloClients, setHaloClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [action1Error, setAction1Error] = useState('');
  const [haloError, setHaloError] = useState('');
  const [action1Diagnostics, setAction1Diagnostics] = useState(null);
  const [haloDiagnostics, setHaloDiagnostics] = useState(null);

  const syncMappings = (nextMappings) => {
    const normalized = normalizeMappingRows(nextMappings);
    setSavedMappings(normalized);
    setDraftRows(normalized);
  };

  const invokeAction = async (actionId, body = {}) => {
    const response = await fetch(`/api/integrations/${integration}/actions/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || `Unable to run ${actionId}.`);
    }

    return data;
  };

  const loadMappings = async () => {
    const data = await invokeAction(ACTIONS.list, {});
    syncMappings(data?.mappings);
  };

  const loadAction1Organizations = async () => {
    setAction1Error('');
    setAction1Diagnostics(null);

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.discoverAction1}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        setAction1Organizations([]);
        setAction1Diagnostics(data?.diagnostics || null);
        setAction1Error(data?.message || 'Unable to load Action1 organization options.');
        return;
      }

      setAction1Organizations(Array.isArray(data?.action1Organizations) ? data.action1Organizations : []);
      setAction1Diagnostics(null);
    } catch (nextError) {
      setAction1Organizations([]);
      setAction1Error(nextError?.message || 'Unable to load Action1 organization options.');
    }
  };

  const loadHaloClients = async () => {
    setHaloError('');
    setHaloDiagnostics(null);

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.discover}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: {} })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        setHaloClients([]);
        setHaloDiagnostics(data?.diagnostics || null);
        setHaloError(data?.message || 'Unable to load HaloPSA client options.');
        return;
      }

      setHaloClients(Array.isArray(data?.haloClients) ? data.haloClients : []);
      setHaloDiagnostics(null);
    } catch (nextError) {
      setHaloClients([]);
      setHaloError(nextError?.message || 'Unable to load HaloPSA client options.');
    }
  };

  const refreshDiscovery = async () => {
    setDiscovering(true);
    await Promise.allSettled([loadAction1Organizations(), loadHaloClients()]);
    setDiscovering(false);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setPageError('');

      try {
        await loadMappings();
      } catch (nextError) {
        if (!cancelled) {
          setPageError(nextError?.message || 'Unable to load mapping screen.');
        }
      } finally {
        await refreshDiscovery();
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

  const updateRow = (rowIndex, valueKey, nameKey, nextValue, nextName) => {
    setDraftRows((current) =>
      current.map((row, idx) => {
        if (idx !== rowIndex) {
          return row;
        }

        return {
          ...row,
          [valueKey]: nextValue,
          [nameKey]: nextName
        };
      })
    );
    setSaveMessage('');
    setSaveError('');
  };

  const addMappingRow = () => {
    setDraftRows((current) => current.concat({ ...EMPTY_ROW }));
    setSaveMessage('');
    setSaveError('');
  };

  const removeDraftRow = (rowIndex) => {
    setDraftRows((current) => current.filter((_, idx) => idx !== rowIndex));
    setSaveMessage('');
    setSaveError('');
  };

  const saveMappings = async () => {
    setSaving(true);
    setSaveMessage('');
    setSaveError('');

    try {
      const { errors, persistRows } = buildPersistRows(draftRows, action1Organizations, haloClients);

      if (errors.length > 0) {
        throw new Error(errors.join(' '));
      }

      const unchangedIds = new Set(
        persistRows
          .filter((row) => row.id !== null)
          .filter((row) => savedMappings.some((savedRow) => savedRow.id === row.id && rowsEquivalent(savedRow, row)))
          .map((row) => row.id)
      );

      const rowsToDelete = savedMappings.filter((row) => !unchangedIds.has(row.id));
      for (const row of rowsToDelete) {
        await invokeAction(ACTIONS.remove, { payload: { id: row.id } });
      }

      const rowsToCreate = persistRows.filter((row) => !(row.id !== null && unchangedIds.has(row.id)));
      for (const row of rowsToCreate) {
        await invokeAction(ACTIONS.save, {
          payload: {
            action1OrgId: row.action1OrgId,
            action1OrgName: row.action1OrgName,
            haloClientId: row.haloClientId,
            haloClientName: row.haloClientName,
            enabled: true
          }
        });
      }

      await loadMappings();
      setSaveMessage('Mappings saved.');
    } catch (nextError) {
      setSaveError(nextError?.message || 'Unable to save mappings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading client mapping...</div>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Client Mapping</h1>
        <p style={styles.description}>Map Action1 organizations to HaloPSA clients so tickets are created under the correct customer account.</p>
      </div>

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div style={styles.buttonRow}>
            <button className="btn-secondary" type="button" onClick={refreshDiscovery} disabled={discovering}>
              {discovering ? 'Refreshing Discovery...' : 'Refresh Discovery'}
            </button>
          </div>
        </div>

        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <p style={styles.statLabel}>Saved Mappings</p>
            <p style={styles.statValue}>{savedMappings.length}</p>
          </div>
          <div style={styles.statCard}>
            <p style={styles.statLabel}>Action1 Organizations</p>
            <p style={styles.statValue}>{action1Organizations.length}</p>
          </div>
          <div style={styles.statCard}>
            <p style={styles.statLabel}>HaloPSA Clients</p>
            <p style={styles.statValue}>{haloClients.length}</p>
          </div>
        </div>
      </div>

      {pageError && (
        <div style={{ ...styles.statusMessage, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          {pageError}
        </div>
      )}
      {action1Error && (
        <div style={{ ...styles.statusMessage, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          {action1Error}
          {action1Diagnostics ? <DiagnosticDetails diagnostics={action1Diagnostics} /> : null}
        </div>
      )}
      {haloError && (
        <div style={{ ...styles.statusMessage, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          {haloError}
          {haloDiagnostics ? <DiagnosticDetails diagnostics={haloDiagnostics} /> : null}
        </div>
      )}

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div>
            <h4 style={styles.cardTitle}>Organization Mapping</h4>
            <p style={styles.description}>
              Choose the HaloPSA client for each Action1 organization.
            </p>
          </div>
        </div>

        <div style={{ ...styles.section, overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHead}>Action1 Organization</th>
                <th style={styles.tableHead}>HaloPSA Client</th>
                <th style={styles.tableHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr>
                  <td style={styles.tableCell} colSpan={3}>No mappings added yet.</td>
                </tr>
              ) : (
                draftRows.map((row, rowIndex) => {
                  const action1Options = mappingOptionsForRow(
                    action1Organizations,
                    draftRows,
                    rowIndex,
                    'action1OrgId',
                    'action1OrgName'
                  );
                  const clientOptions = mappingOptionsForRow(
                    haloClients,
                    draftRows,
                    rowIndex,
                    'haloClientId',
                    'haloClientName'
                  );

                  return (
                    <tr key={row.id ?? `draft-${rowIndex}`}>
                      <td style={styles.tableCell}>
                        <select
                          id={`map-org-${rowIndex}`}
                          aria-label={`Action1 Organization row ${rowIndex + 1}`}
                          data-map-org={rowIndex}
                          value={row.action1OrgId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const selected = action1Options.find((option) => option.value === nextId);
                            updateRow(rowIndex, 'action1OrgId', 'action1OrgName', nextId, selected?.name || '');
                          }}
                          style={styles.input}
                          disabled={action1Options.length === 0 || Boolean(action1Error)}
                        >
                          <option value="">-- Select --</option>
                          {action1Options.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={styles.tableCell}>
                        <select
                          id={`map-client-${rowIndex}`}
                          aria-label={`HaloPSA Client row ${rowIndex + 1}`}
                          data-map-client={rowIndex}
                          value={row.haloClientId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const selected = clientOptions.find((option) => option.value === nextId);
                            updateRow(rowIndex, 'haloClientId', 'haloClientName', nextId, selected?.name || '');
                          }}
                          style={styles.input}
                          disabled={clientOptions.length === 0 || Boolean(haloError)}
                        >
                          <option value="">-- Select --</option>
                          {clientOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={styles.actionCell}>
                        <button
                          className="btn-secondary"
                          type="button"
                          data-map-remove={rowIndex}
                          onClick={() => removeDraftRow(rowIndex)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.tableButtonRow}>
          <button className="btn-secondary" type="button" onClick={addMappingRow}>
            Add Mapping Row
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={saveMappings}
            disabled={saving || Boolean(action1Error) || Boolean(haloError)}
          >
            {saving ? 'Saving...' : 'Save Mappings'}
          </button>
          <div style={styles.tableFeedback} data-save-feedback>
            {saveMessage && (
              <div style={{ ...styles.statusMessage, width: '100%', background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }}>
                {saveMessage}
              </div>
            )}
            {saveError && (
              <div style={{ ...styles.statusMessage, width: '100%', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
                {saveError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Mapping;
