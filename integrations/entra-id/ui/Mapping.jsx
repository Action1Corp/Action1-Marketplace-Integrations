import { useEffect, useMemo, useState } from 'react';

const ACTIONS = {
  list: 'list-entra-org-mappings',
  save: 'save-entra-org-mapping',
  remove: 'delete-entra-org-mapping',
  discoverAction1: 'discover-action1-mapping-options'
};

const EMPTY_ROW = {
  id: null,
  action1OrgId: '',
  action1OrgName: ''
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
    fontWeight: 400
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
    String(left?.action1OrgName || '') === String(right?.action1OrgName || '')
  );
}

function normalizeMappingRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row?.id ?? null,
    action1OrgId: String(row?.action1OrgId || ''),
    action1OrgName: String(row?.action1OrgName || '')
  }));
}

function mappingOptionsForRow(allOptions, rows, rowIndex) {
  const normalized = normalizeOptions(allOptions);
  const selectedInOtherRows = new Set(
    rows
      .filter((_, idx) => idx !== rowIndex)
      .map((row) => String(row?.action1OrgId || '').trim())
      .filter(Boolean)
  );
  const currentRow = rows[rowIndex] || EMPTY_ROW;
  const currentValue = String(currentRow?.action1OrgId || '').trim();

  const allowed = normalized.filter((option) => {
    if (option.value === currentValue) {
      return true;
    }

    return !selectedInOtherRows.has(option.value);
  });

  return ensureSelectedOption(allowed, currentRow?.action1OrgId, currentRow?.action1OrgName);
}

function buildPersistRows(rows, action1Organizations) {
  const errors = [];
  const persistRows = [];
  const orgsById = new Map(normalizeOptions(action1Organizations).map((row) => [row.value, row.name]));
  const seenAction1 = new Set();

  for (const row of rows) {
    const action1OrgId = String(row?.action1OrgId || '').trim();
    const action1OrgName = String(orgsById.get(action1OrgId) || row?.action1OrgName || '').trim();

    if (!action1OrgId) {
      continue;
    }

    if (seenAction1.has(action1OrgId)) {
      errors.push('Each Action1 organization can only be mapped once. Remove duplicate mappings before saving.');
      continue;
    }
    seenAction1.add(action1OrgId);

    if (!action1OrgName) {
      errors.push('Refresh Action1 organization options and reselect the organization before saving.');
      continue;
    }

    persistRows.push({
      id: row?.id ?? null,
      action1OrgId,
      action1OrgName
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
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [loadingAction1Options, setLoadingAction1Options] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mappingsLoadError, setMappingsLoadError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [discoveryError, setDiscoveryError] = useState('');
  const [duplicateSelectionError, setDuplicateSelectionError] = useState('');
  const [action1Diagnostics, setAction1Diagnostics] = useState(null);
  const [rowAdded, setRowAdded] = useState(false);

  const emptyMappings = useMemo(() => draftRows.length === 0, [draftRows]);
  const mappingStateLabel = loadingAction1Options
    ? 'Loading Action1 Organizations'
    : discoveryError
    ? 'Discovery Error'
    : saveError
    ? 'Save Error'
    : duplicateSelectionError
    ? 'Duplicate Org Selected'
    : emptyMappings
    ? 'Empty Mappings'
    : rowAdded
    ? 'Row Added'
    : 'Ready';

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
    setLoadingMappings(true);
    setMappingsLoadError('');

    try {
      const data = await invokeAction(ACTIONS.list, {});
      syncMappings(data?.mappings);
    } catch (error) {
      setMappingsLoadError(error?.message || 'Unable to load mapping screen.');
      syncMappings([]);
    } finally {
      setLoadingMappings(false);
    }
  };

  const loadAction1Organizations = async () => {
    setLoadingAction1Options(true);
    setDiscoveryError('');
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
        setDiscoveryError(data?.message || 'Unable to load Action1 organization options.');
        return;
      }

      setAction1Organizations(Array.isArray(data?.action1Organizations) ? data.action1Organizations : []);
      setAction1Diagnostics(null);
    } catch (error) {
      setAction1Organizations([]);
      setDiscoveryError(error?.message || 'Unable to load Action1 organization options.');
    } finally {
      setLoadingAction1Options(false);
    }
  };

  const refreshDiscovery = async () => {
    await loadAction1Organizations();
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      await Promise.allSettled([loadMappings(), loadAction1Organizations()]);
    };

    load();

    return () => {
      cancelled = true;
      if (cancelled) {
        return;
      }
    };
  }, [integration]);

  const updateRow = (rowIndex, nextValue, nextName) => {
    setDraftRows((current) =>
      current.map((row, idx) => {
        if (idx !== rowIndex) {
          return row;
        }

        return {
          ...row,
          action1OrgId: nextValue,
          action1OrgName: nextName
        };
      })
    );
    setSaveMessage('');
    setSaveError('');
    setDuplicateSelectionError('');
  };

  const addMappingRow = () => {
    setDraftRows((current) => current.concat({ ...EMPTY_ROW }));
    setRowAdded(true);
    setSaveMessage('');
    setSaveError('');
    setDuplicateSelectionError('');
  };

  const removeDraftRow = (rowIndex) => {
    setDraftRows((current) => current.filter((_, idx) => idx !== rowIndex));
    setRowAdded(false);
    setSaveMessage('');
    setSaveError('');
    setDuplicateSelectionError('');
  };

  const saveMappings = async () => {
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    setDuplicateSelectionError('');

    try {
      const { errors, persistRows } = buildPersistRows(draftRows, action1Organizations);

      if (errors.length > 0) {
        const duplicateError = errors.find((entry) => entry.includes('only be mapped once'));
        if (duplicateError) {
          setDuplicateSelectionError(duplicateError);
        }
        throw new Error(errors.join(' '));
      }

      const unchangedIds = new Set(
        persistRows
          .filter((row) => row.id !== null)
          .filter((row) => savedMappings.some((savedRow) => savedRow.id === row.id && rowsEquivalent(savedRow, row)))
          .map((row) => row.id)
      );

      const rowsToDelete = savedMappings.filter((row) => !persistRows.some((persistRow) => persistRow.id === row.id));
      for (const row of rowsToDelete) {
        await invokeAction(ACTIONS.remove, { payload: { id: row.id } });
      }

      const rowsToSave = persistRows.filter((row) => !(row.id !== null && unchangedIds.has(row.id)));
      for (const row of rowsToSave) {
        await invokeAction(ACTIONS.save, {
          payload: {
            id: row.id,
            action1OrgId: row.action1OrgId,
            action1OrgName: row.action1OrgName
          }
        });
      }

      await loadMappings();
      setRowAdded(false);
      setSaveMessage('Mappings saved.');
    } catch (error) {
      setSaveError(error?.message || 'Unable to save mappings.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingMappings) {
    return <div style={{ padding: '2rem' }}>Loading mappings...</div>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Organization Mapping</h1>
        <p style={styles.description}>
          Map the configured Microsoft Entra tenant to one or more Action1 organizations. Each Action1 organization can be mapped only once.
        </p>
      </div>

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div style={styles.buttonRow}>
            <button className="btn-secondary" type="button" onClick={refreshDiscovery} disabled={loadingAction1Options}>
              {loadingAction1Options ? 'Refreshing Action1 Organizations...' : 'Refresh Action1 Organizations'}
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
            <p style={styles.statLabel}>Mapping State</p>
            <p style={styles.statValue}>{mappingStateLabel}</p>
          </div>
        </div>
      </div>

      {mappingsLoadError && (
        <div style={{ ...styles.statusMessage, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          {mappingsLoadError}
        </div>
      )}
      {discoveryError && (
        <div style={{ ...styles.statusMessage, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          {discoveryError}
          {action1Diagnostics ? <DiagnosticDetails diagnostics={action1Diagnostics} /> : null}
        </div>
      )}
      {duplicateSelectionError && (
        <div style={{ ...styles.statusMessage, background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412' }}>
          {duplicateSelectionError}
        </div>
      )}

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div>
            <h4 style={styles.cardTitle}>Action1 Organizations</h4>
            <p style={styles.description}>
              Add one row per Action1 organization that later sync slices are allowed to process.
            </p>
          </div>
        </div>

        <div style={{ ...styles.section, overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHead}>Action1 Organization</th>
                <th style={styles.tableHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr>
                  <td style={styles.tableCell} colSpan={2}>No mappings added yet.</td>
                </tr>
              ) : (
                draftRows.map((row, rowIndex) => {
                  const action1Options = mappingOptionsForRow(action1Organizations, draftRows, rowIndex);

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
                            updateRow(rowIndex, nextId, selected?.name || '');
                          }}
                          style={styles.input}
                          disabled={loadingAction1Options || action1Options.length === 0 || Boolean(discoveryError)}
                        >
                          <option value="">{loadingAction1Options ? 'Loading Action1 organizations...' : '-- Select --'}</option>
                          {action1Options.map((option) => (
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
            disabled={saving || loadingAction1Options || Boolean(discoveryError)}
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
