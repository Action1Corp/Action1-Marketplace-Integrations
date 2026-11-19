import { useEffect, useRef, useState } from 'react';
import { UI_PROVIDER_REGISTRY, isUiProviderAvailable, resolveUiProvider } from './providerRegistry.js';
import { buildMappingSavePlan, buildPersistRows, executeMappingSavePlan, isCurrentMappingRequest, mappingOptionsForRow, normalizeMappingRows } from './mappingState.mjs';

const ACTIONS = {
  list: 'list-ticketing-org-destination-mappings',
  save: 'save-ticketing-org-destination-mapping',
  remove: 'delete-ticketing-org-destination-mapping',
  discoverAction1: 'discover-action1-mapping-options',
  discover: 'discover-ticketing-mapping-options'
};

const EMPTY_ROW = {
  id: null,
  action1OrgId: '',
  action1OrgName: '',
  destinationId: '',
  destinationName: ''
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
  const [destinationOptions, setDestinationOptions] = useState([]);
  const [activeProviderId, setActiveProviderId] = useState('connectwise-psa');
  const [viewedProviderId, setViewedProviderId] = useState('connectwise-psa');
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [action1Error, setAction1Error] = useState('');
  const [destinationError, setDestinationError] = useState('');
  const [action1Diagnostics, setAction1Diagnostics] = useState(null);
  const [destinationDiagnostics, setDestinationDiagnostics] = useState(null);
  const requestGeneration = useRef(0);
  const viewedProviderRef = useRef(viewedProviderId);
  const savedMappingsRef = useRef(savedMappings);
  const draftRowsRef = useRef(draftRows);
  viewedProviderRef.current = viewedProviderId;
  savedMappingsRef.current = savedMappings;
  draftRowsRef.current = draftRows;

  const provider = resolveUiProvider(viewedProviderId);
  const providerAvailable = isUiProviderAvailable(provider);
  const mappingReady = providerAvailable && typeof provider?.DestinationMappingFields === 'function';
  const providers = Object.values(UI_PROVIDER_REGISTRY);

  const syncMappings = (nextMappings) => {
    const normalized = normalizeMappingRows(nextMappings);
    setSavedMappings(normalized);
    setDraftRows(normalized);
  };

  const invokeAction = async (actionId, providerId, body = {}) => {
    const payload = providerId ? { ...body, providerId } : body;
    const response = await fetch(`/api/integrations/${integration}/actions/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.message || `Unable to run ${actionId}.`);
      error.diagnostics = data?.diagnostics || null;
      throw error;
    }
    return data;
  };

  const requestIsCurrent = (providerId, generation) =>
    isCurrentMappingRequest({ providerId, generation }, { providerId: viewedProviderRef.current, generation: requestGeneration.current });

  const loadMappings = async (providerId, generation) => {
    if (!isUiProviderAvailable(resolveUiProvider(providerId))) {
      if (requestIsCurrent(providerId, generation)) {
        setSavedMappings([]);
        setDraftRows([]);
        setPageError(`${resolveUiProvider(providerId)?.label || 'This ticketing system'} is not available in this version. Configure an available provider in Settings.`);
      }
      return;
    }
    try {
      const data = await invokeAction(ACTIONS.list, providerId);
      if (requestIsCurrent(providerId, generation)) {
        setPageError('');
        syncMappings(data?.mappings);
      }
    } catch (error) {
      if (requestIsCurrent(providerId, generation)) setPageError(error?.message || 'Unable to load mapping screen.');
    }
  };

  const loadAction1Organizations = async (providerId, generation) => {
    setAction1Error('');
    setAction1Diagnostics(null);
    try {
      const data = await invokeAction(ACTIONS.discoverAction1, null);
      if (!requestIsCurrent(providerId, generation)) return;
      setAction1Organizations(Array.isArray(data?.action1Organizations) ? data.action1Organizations : []);
    } catch (error) {
      if (!requestIsCurrent(providerId, generation)) return;
      setAction1Diagnostics(error?.diagnostics || null);
      setAction1Error(error?.message || 'Unable to load Action1 organization options.');
    }
  };

  const loadDestinationOptions = async (providerId, generation) => {
    setDestinationError('');
    setDestinationDiagnostics(null);
    const selected = resolveUiProvider(providerId);
    if (!isUiProviderAvailable(selected)) {
      if (requestIsCurrent(providerId, generation)) {
        setDestinationOptions([]);
        setDestinationError(`${selected?.label || 'This ticketing system'} is unavailable. Configure an implemented provider in Settings.`);
      }
      return;
    }
    try {
      const data = await invokeAction(ACTIONS.discover, providerId);
      if (!requestIsCurrent(providerId, generation)) return;
      setDestinationOptions(Array.isArray(data?.destinationOptions) ? data.destinationOptions : []);
    } catch (error) {
      if (!requestIsCurrent(providerId, generation)) return;
      setDestinationDiagnostics(error?.diagnostics || null);
      setDestinationError(error?.message || 'Unable to load destination options.');
    }
  };

  const refreshDiscovery = async (providerId = viewedProviderRef.current, generation = null) => {
    const currentGeneration = generation ?? ++requestGeneration.current;
    if (!requestIsCurrent(providerId, currentGeneration)) return;
    setDiscovering(true);
    await Promise.allSettled([
      loadAction1Organizations(providerId, currentGeneration),
      loadDestinationOptions(providerId, currentGeneration)
    ]);
    if (requestIsCurrent(providerId, currentGeneration)) setDiscovering(false);
  };

  const loadProviderView = async (providerId) => {
    const generation = ++requestGeneration.current;
    viewedProviderRef.current = providerId;
    setViewedProviderId(providerId);
    setLoading(true);
    setPageError('');
    setSaveMessage('');
    setSaveError('');
    await Promise.all([
      loadMappings(providerId, generation),
      refreshDiscovery(providerId, generation)
    ]);
    if (requestIsCurrent(providerId, generation)) setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/settings');
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        const nextSettings = data.settings || {};
        const active = String(nextSettings.TicketingActiveProvider || 'connectwise-psa');
        setSettings(nextSettings);
        setActiveProviderId(active);
        await loadProviderView(active);
      } catch (error) {
        if (!cancelled) {
          const providerId = 'connectwise-psa';
          setPageError(error?.message || 'Unable to load active ticketing system settings.');
          await loadProviderView(providerId);
        }
      }
    };
    initialize();
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
    };
  }, [integration]);

  const updateRow = (rowIndex, valueKey, nameKey, nextValue, nextName) => {
    setDraftRows((current) => current.map((row, index) => index === rowIndex
      ? { ...row, [valueKey]: nextValue, [nameKey]: nextName }
      : row));
    setSaveMessage('');
    setSaveError('');
  };

  const addMappingRow = () => {
    setDraftRows((current) => current.concat({ ...EMPTY_ROW }));
    setSaveMessage('');
    setSaveError('');
  };

  const removeDraftRow = (rowIndex) => {
    setDraftRows((current) => current.filter((_, index) => index !== rowIndex));
    setSaveMessage('');
    setSaveError('');
  };

  const changeViewedProvider = (nextProviderId) => {
    if (nextProviderId === viewedProviderRef.current || !isUiProviderAvailable(resolveUiProvider(nextProviderId))) return;
    const currentPlan = buildMappingSavePlan(savedMappingsRef.current, draftRowsRef.current);
    if ((currentPlan.deletes.length || currentPlan.saves.length) && !window.confirm('Discard unsaved mapping changes?')) return;
    void loadProviderView(nextProviderId);
  };

  const saveMappings = async () => {
    if (!providerAvailable) return;
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      const { errors, persistRows } = buildPersistRows(draftRows, action1Organizations, destinationOptions);
      if (errors.length) throw new Error(errors.join(' '));
      const plan = buildMappingSavePlan(savedMappings, persistRows);
      await executeMappingSavePlan(plan, {
        delete: (id) => invokeAction(ACTIONS.remove, viewedProviderId, { payload: { id } }),
        save: (row) => invokeAction(ACTIONS.save, viewedProviderId, { payload: {
          ...(row.id !== null ? { id: row.id } : {}),
          action1OrgId: row.action1OrgId,
          action1OrgName: row.action1OrgName,
          destinationId: row.destinationId,
          destinationName: row.destinationName,
          enabled: true
        } })
      });
      const data = await invokeAction(ACTIONS.list, viewedProviderId);
      syncMappings(data?.mappings);
      setSaveMessage('Mappings saved.');
    } catch (error) {
      setSaveError(error?.message || 'Unable to save mappings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading mapping...</div>;
  }

  const viewedProviderSettings = Object.fromEntries(
    (provider?.settingKeys || []).map((key) => [key, settings[key] ?? ''])
  );
  const DestinationFields = provider?.DestinationMappingFields;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Mapping</h1>
        <p style={styles.description}>
          Map Action1 organizations to the selected ticketing system so qualifying tickets use the correct destination organization.
        </p>
        <label style={{ display: 'grid', gap: '0.35rem', maxWidth: 440 }}>
          <span>Ticketing System</span>
          <select
            value={viewedProviderId}
            onChange={(event) => changeViewedProvider(event.target.value)}
            disabled={saving || !providers.some(isUiProviderAvailable)}
          >
            {providers.map((item) => (
              <option key={item.providerId} value={item.providerId} disabled={!isUiProviderAvailable(item)}>
                {item.label}{isUiProviderAvailable(item) ? '' : ' — unavailable in this version'}
              </option>
            ))}
          </select>
        </label>
        <p style={styles.description}>
          Active ticketing system: {resolveUiProvider(activeProviderId)?.label || activeProviderId}
          {activeProviderId === viewedProviderId ? ' (viewing active provider)' : ' (viewing inactive provider)'}
        </p>
      </div>

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div style={styles.buttonRow}>
            <button className="btn-secondary" type="button" onClick={() => refreshDiscovery()} disabled={discovering}>
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
            <p style={styles.statLabel}>{provider?.label || 'Destination'} Options</p>
            <p style={styles.statValue}>{destinationOptions.length}</p>
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
      {destinationError && (
        <div style={{ ...styles.statusMessage, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          {destinationError}
          {destinationDiagnostics ? <DiagnosticDetails diagnostics={destinationDiagnostics} /> : null}
        </div>
      )}

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div>
            <h2 style={styles.cardTitle}>Organization Mapping</h2>
            <p style={styles.description}>Choose a destination organization for each Action1 organization.</p>
          </div>
        </div>
        <div style={{ ...styles.section, overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHead}>Action1 Organization</th>
                <th style={styles.tableHead}>{provider?.label || 'Destination'} Organization</th>
                <th style={styles.tableHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr><td style={styles.tableCell} colSpan={3}>No mappings added yet.</td></tr>
              ) : draftRows.map((row, rowIndex) => {
                const sourceOptions = mappingOptionsForRow(
                  action1Organizations,
                  draftRows,
                  rowIndex,
                  'action1OrgId',
                  'action1OrgName'
                );
                const destinationRowOptions = mappingOptionsForRow(
                  destinationOptions,
                  draftRows,
                  rowIndex,
                  'destinationId',
                  'destinationName'
                );
                const destinationFieldOptions = destinationRowOptions.map((option) => ({
                  id: option.value,
                  name: option.name,
                  label: option.label
                }));

                return (
                  <tr key={row.id ?? `draft-${rowIndex}`}>
                    <td style={styles.tableCell}>
                      <select
                        id={`map-org-${rowIndex}`}
                        aria-label={`Action1 Organization row ${rowIndex + 1}`}
                        data-map-org={rowIndex}
                        value={row.action1OrgId}
                        onChange={(event) => {
                          const value = event.target.value;
                          const selected = sourceOptions.find((option) => option.value === value);
                          updateRow(rowIndex, 'action1OrgId', 'action1OrgName', value, selected?.name || '');
                        }}
                        style={styles.input}
                        disabled={sourceOptions.length === 0 || Boolean(action1Error)}
                      >
                        <option value="">-- Select --</option>
                        {sourceOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={styles.tableCell}>
                      {DestinationFields ? (
                        <DestinationFields
                          providerId={viewedProviderId}
                          providerLabel={provider?.label}
                          settings={viewedProviderSettings}
                          row={row}
                          rowIndex={rowIndex}
                          options={destinationFieldOptions}
                          loading={discovering}
                          error={destinationError}
                          disabled={saving || Boolean(destinationError)}
                          onChange={(id, name) => updateRow(rowIndex, 'destinationId', 'destinationName', id, name)}
                          onRefresh={() => refreshDiscovery()}
                        />
                      ) : (
                        <span>
                          {providerAvailable
                            ? 'Destination mapping is unavailable for this provider.'
                            : 'Destination selection is unavailable until this ticketing system is implemented.'}
                        </span>
                      )}
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
              })}
            </tbody>
          </table>
        </div>
        <div style={styles.tableButtonRow}>
          <button className="btn-secondary" type="button" onClick={addMappingRow} disabled={!mappingReady}>
            Add Mapping Row
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={saveMappings}
            disabled={!mappingReady || saving || Boolean(action1Error) || Boolean(destinationError)}
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
