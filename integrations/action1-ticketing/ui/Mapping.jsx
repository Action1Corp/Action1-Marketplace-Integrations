import { useEffect, useRef, useState } from 'react';
import { INITIAL_PROVIDER_ID, isUiProviderAvailable, resolveUiProvider } from './providerRegistry.js';
import { buildMappingSavePlan, buildOrganizationMappingRows, buildPersistRows, executeMappingSavePlan, isCurrentMappingRequest, mappingOptionsForRow, normalizeMappingRows, paginateMappingRows } from './mappingState.mjs';

function Action1OrganizationSelector({ id, label, rowIndex, options, value, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const filtered = options.filter((option) => !normalizedQuery || option.name.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').includes(normalizedQuery));
  const selectOption = (option) => {
    onChange(option.value);
    setQuery('');
    setOpen(false);
    setActiveIndex(0);
  };
  return (
    <div style={{ position: 'relative', minWidth: 220 }}>
      <input
        id={id}
        data-map-org={rowIndex}
        type="search"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        placeholder="Search Action1 organizations..."
        value={open ? query : (selected?.name || '')}
        onFocus={() => { setOpen(true); setQuery(''); setActiveIndex(0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(filtered.length - 1, index + 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
          else if (event.key === 'Enter' && open && filtered[activeIndex]) { event.preventDefault(); selectOption(filtered[activeIndex]); }
          else if (event.key === 'Escape') { setOpen(false); setQuery(''); }
        }}
        style={styles.input}
        disabled={disabled}
      />
      {open ? (
        <div id={`${id}-options`} role="listbox" aria-label={`${label} options`} style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid var(--border-color)', borderRadius: 6 }}>
          {filtered.length ? filtered.map((option, index) => (
            <button
              id={`${id}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.65rem', border: 0, background: index === activeIndex ? '#F3F4F6' : '#fff', cursor: 'pointer' }}
            >{option.name}</button>
          )) : <div role="status" style={{ padding: '0.6rem' }}>No Action1 organizations found.</div>}
        </div>
      ) : null}
    </div>
  );
}

const ACTIONS = {
  list: 'list-ticketing-org-destination-mappings',
  save: 'save-ticketing-org-destination-mapping',
  remove: 'delete-ticketing-org-destination-mapping',
  discoverAction1: 'discover-action1-mapping-options',
  discover: 'discover-ticketing-mapping-options',
  previewAutoMatch: 'preview-ticketing-mapping-auto-match',
  applyAutoMatch: 'apply-ticketing-mapping-auto-match'
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
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationHasMore, setDestinationHasMore] = useState(false);
  const [destinationNextPageToken, setDestinationNextPageToken] = useState(null);
  const [destinationSearchSupported, setDestinationSearchSupported] = useState(false);
  const [destinationPaginationSupported, setDestinationPaginationSupported] = useState(false);
  const [destinationPageComplete, setDestinationPageComplete] = useState(false);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [mappingFilter, setMappingFilter] = useState('All');
  const [mappingPage, setMappingPage] = useState(0);
  const [activeProviderId, setActiveProviderId] = useState(INITIAL_PROVIDER_ID);
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
  const [autoMatchPreview, setAutoMatchPreview] = useState(null);
  const [autoMatchCategory, setAutoMatchCategory] = useState('exact');
  const [selectedAutoMatches, setSelectedAutoMatches] = useState([]);
  const [autoMatchBusy, setAutoMatchBusy] = useState(false);
  const [autoMatchError, setAutoMatchError] = useState('');
  const [autoMatchMessage, setAutoMatchMessage] = useState('');
  const savedMappingsRef = useRef(savedMappings);
  const draftRowsRef = useRef(draftRows);
  const requestGeneration = useRef(0);
  const destinationRequestGeneration = useRef(0);
  const destinationSeenTokens = useRef(new Set());
  const destinationContext = useRef({ providerId: activeProviderId, query: '' });
  const activeProviderRef = useRef(activeProviderId);
  activeProviderRef.current = activeProviderId;

  const provider = resolveUiProvider(activeProviderId);
  const providerAvailable = isUiProviderAvailable(provider);
  const mappingReady = providerAvailable && typeof provider?.DestinationMappingFields === 'function';

  const syncMappings = (nextMappings) => {
    const normalized = normalizeMappingRows(nextMappings);
    savedMappingsRef.current = normalized;
    draftRowsRef.current = normalized;
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
    isCurrentMappingRequest({ providerId, generation }, { providerId: activeProviderRef.current, generation: requestGeneration.current });

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

  const loadDestinationOptions = async (providerId, generation, query = '', continuationToken = null, append = false) => {
    const destinationGeneration = ++destinationRequestGeneration.current;
    const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ');
    if (!append) {
      destinationContext.current = { providerId, query: normalizedQuery };
      destinationSeenTokens.current = new Set();
      setDestinationQuery(String(query || ''));
      setDestinationOptions([]);
      setDestinationNextPageToken(null);
      setDestinationHasMore(false);
      setDestinationSearchSupported(false);
      setDestinationPaginationSupported(false);
      setDestinationPageComplete(false);
    } else if (destinationContext.current.providerId !== providerId || destinationContext.current.query !== normalizedQuery) {
      return;
    }
    setDestinationError('');
    setDestinationDiagnostics(null);
    setDestinationLoading(true);
    const selected = resolveUiProvider(providerId);
    if (!isUiProviderAvailable(selected)) {
      if (requestIsCurrent(providerId, generation)) {
        setDestinationOptions([]);
        setDestinationError(`${selected?.label || 'This ticketing system'} is unavailable. Configure an implemented provider in Settings.`);
      }
      if (destinationGeneration === destinationRequestGeneration.current) setDestinationLoading(false);
      return;
    }
    try {
      const data = await invokeAction(ACTIONS.discover, providerId, { query: normalizedQuery, pageSize: 50, continuationToken });
      if (!requestIsCurrent(providerId, generation) || destinationGeneration !== destinationRequestGeneration.current || destinationContext.current.providerId !== providerId || destinationContext.current.query !== normalizedQuery) return;
      const incoming = Array.isArray(data?.destinationOptions) ? data.destinationOptions : [];
      if (append && continuationToken) destinationSeenTokens.current.add(continuationToken);
      if (data?.nextPageToken && destinationSeenTokens.current.has(data.nextPageToken)) {
        setDestinationHasMore(false);
        setDestinationNextPageToken(null);
        setDestinationError('The provider returned a repeated destination page. Refresh Discovery and try again.');
        return;
      }
      if (data?.nextPageToken) destinationSeenTokens.current.add(data.nextPageToken);
      setDestinationOptions((current) => {
        const merged = append ? [...current] : [];
        const indexes = new Map(merged.map((option, index) => [String(option.id), index]));
        for (const option of incoming) {
          const key = String(option.id);
          if (indexes.has(key)) merged[indexes.get(key)] = option;
          else { indexes.set(key, merged.length); merged.push(option); }
        }
        return merged;
      });
      setDestinationHasMore(data?.hasMore === true);
      setDestinationNextPageToken(data?.hasMore === true ? data.nextPageToken : null);
      setDestinationSearchSupported(data?.searchSupported === true);
      setDestinationPaginationSupported(data?.paginationSupported === true);
      setDestinationPageComplete(data?.complete === true);
    } catch (error) {
      if (!requestIsCurrent(providerId, generation) || destinationGeneration !== destinationRequestGeneration.current || destinationContext.current.providerId !== providerId || destinationContext.current.query !== normalizedQuery) return;
      setDestinationDiagnostics(error?.diagnostics || null);
      setDestinationError(error?.message || 'Unable to load destination options.');
    } finally {
      if (destinationGeneration === destinationRequestGeneration.current) setDestinationLoading(false);
    }
  };

  const searchDestinationOptions = (query) => loadDestinationOptions(activeProviderRef.current, requestGeneration.current, query, null, false);
  const loadMoreDestinationOptions = () => {
    if (!destinationHasMore || !destinationNextPageToken || destinationLoading) return;
    return loadDestinationOptions(activeProviderRef.current, requestGeneration.current, destinationQuery, destinationNextPageToken, true);
  };

  const refreshDiscovery = async (providerId = activeProviderRef.current, generation = null) => {
    const currentGeneration = generation ?? ++requestGeneration.current;
    if (!requestIsCurrent(providerId, currentGeneration)) return;
    setDiscovering(true);
    await Promise.allSettled([
      loadAction1Organizations(providerId, currentGeneration),
      loadDestinationOptions(providerId, currentGeneration)
    ]);
    if (requestIsCurrent(providerId, currentGeneration)) setDiscovering(false);
  };

  const loadActiveProviderView = async (providerId) => {
    const generation = ++requestGeneration.current;
    activeProviderRef.current = providerId;
    setActiveProviderId(providerId);
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
        await loadActiveProviderView(active);
      } catch (error) {
        if (!cancelled) {
          const providerId = 'connectwise-psa';
          setPageError(error?.message || 'Unable to load active ticketing system settings.');
          await loadActiveProviderView(providerId);
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
    const next = draftRowsRef.current.map((row, index) => index === rowIndex
      ? { ...row, [valueKey]: nextValue, [nameKey]: nextName }
      : row);
    draftRowsRef.current = next;
    setDraftRows(next);
    setSaveMessage('');
    setSaveError('');
  };

  const addMappingRow = () => {
    const next = draftRowsRef.current.concat({ ...EMPTY_ROW });
    draftRowsRef.current = next;
    setDraftRows(next);
    setMappingFilter('All');
    setOrganizationSearch('');
    setMappingPage(Math.floor((draftRows.length + action1Organizations.length) / 25));
    setSaveMessage('');
    setSaveError('');
  };

  const removeDraftRow = (rowIndex) => {
    const next = draftRowsRef.current.filter((_, index) => index !== rowIndex);
    draftRowsRef.current = next;
    setDraftRows(next);
    setSaveMessage('');
    setSaveError('');
  };

  const updateProjectedRow = (projectedRow, valueKey, nameKey, nextValue, nextName) => {
    if (projectedRow.draftIndex !== null) {
      updateRow(projectedRow.draftIndex, valueKey, nameKey, nextValue, nextName);
      return;
    }
    if (valueKey !== 'destinationId' || !projectedRow.action1OrgId) return;
    const current = draftRowsRef.current;
    const existingIndex = current.findIndex((row) => row.action1OrgId === projectedRow.action1OrgId);
      const updated = { ...EMPTY_ROW, action1OrgId: projectedRow.action1OrgId, action1OrgName: projectedRow.action1OrgName, destinationId: nextValue, destinationName: nextName };
    const next = existingIndex >= 0
        ? current.map((row, index) => index === existingIndex ? { ...row, ...updated } : row)
        : current.concat(updated);
    draftRowsRef.current = next;
    setDraftRows(next);
    setSaveMessage('');
    setSaveError('');
  };

  const openAutoMatchPreview = async () => {
    setAutoMatchBusy(true);
    setAutoMatchError('');
    setAutoMatchMessage('');
    try {
      const data = await invokeAction(ACTIONS.previewAutoMatch, activeProviderRef.current, { draftRows: draftRowsRef.current });
      if (data.complete && activeProviderRef.current !== data.providerId) throw new Error('The active ticketing system changed. Refresh Mapping and run Auto Match again.');
      setAutoMatchPreview(data);
      setAutoMatchCategory('exact');
      setSelectedAutoMatches(data.complete ? data.exactMatches.map((item) => item.action1OrgId) : []);
    } catch (error) {
      setAutoMatchPreview(null);
      setAutoMatchError(error?.message || 'Unable to preview Auto Match.');
    } finally { setAutoMatchBusy(false); }
  };

  const applyAutoMatches = async () => {
    if (!autoMatchPreview?.complete || !selectedAutoMatches.length) return;
    setAutoMatchBusy(true);
    setAutoMatchError('');
    try {
      const matches = autoMatchPreview.exactMatches.filter((item) => selectedAutoMatches.includes(item.action1OrgId));
      const data = await invokeAction(ACTIONS.applyAutoMatch, activeProviderRef.current, { matches, draftRows: draftRowsRef.current });
      if (!data.complete && data.applied === undefined) throw new Error(data.message || 'Auto Match could not be completed.');
      if (data.mappings) {
        const normalizedSaved = normalizeMappingRows(data.mappings);
        const appliedBySource = new Map((data.appliedMappings || []).map((row) => [row.action1OrgId, row]));
        const currentDraft = draftRowsRef.current;
        const previousSavedIds = new Set(savedMappingsRef.current.map((row) => row.id));
        const nextDraft = currentDraft.map((row) => {
          const applied = appliedBySource.get(row.action1OrgId);
          const previewItem = matches.find((item) => item.action1OrgId === row.action1OrgId);
          if (applied && previewItem?.draftSnapshot && JSON.stringify(row) === JSON.stringify(previewItem.draftSnapshot)) return applied;
          return row;
        });
        for (const row of data.appliedMappings || []) {
          if (!nextDraft.some((item) => item.action1OrgId === row.action1OrgId)) nextDraft.push(row);
        }
        for (const row of normalizedSaved) {
          if (!previousSavedIds.has(row.id) && !nextDraft.some((item) => item.action1OrgId === row.action1OrgId)) nextDraft.push(row);
        }
        savedMappingsRef.current = normalizedSaved;
        draftRowsRef.current = nextDraft;
        setSavedMappings(normalizedSaved);
        setDraftRows(nextDraft);
      }
      setAutoMatchMessage(data.message || `Applied ${data.applied || 0} matches; skipped ${data.skipped || 0}; failed ${data.failed || 0}.`);
      setAutoMatchPreview(null);
    } catch (error) {
      setAutoMatchError(error?.message || 'Unable to apply Auto Match.');
    } finally { setAutoMatchBusy(false); }
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
        delete: (id) => invokeAction(ACTIONS.remove, activeProviderId, { payload: { id } }),
        save: (row) => invokeAction(ACTIONS.save, activeProviderId, { payload: {
          ...(row.id !== null ? { id: row.id } : {}),
          action1OrgId: row.action1OrgId,
          action1OrgName: row.action1OrgName,
          destinationId: row.destinationId,
          destinationName: row.destinationName,
          enabled: true
        } })
      });
      const data = await invokeAction(ACTIONS.list, activeProviderId);
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

  const activeProviderSettings = Object.fromEntries(
    (provider?.settingKeys || []).map((key) => [key, settings[key] ?? ''])
  );
  const DestinationFields = provider?.DestinationMappingFields;
  const projectedRows = buildOrganizationMappingRows(action1Organizations, draftRows, { filter: mappingFilter, search: organizationSearch });
  const page = paginateMappingRows(projectedRows, mappingPage, 25);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Mapping</h1>
        <p style={styles.description}>
          Map Action1 organizations to the active ticketing system so qualifying tickets use the correct destination organization.
        </p>
        <p style={styles.description} aria-label="Active ticketing system">
          Active ticketing system: {provider?.label || activeProviderId}
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
            <p style={styles.statLabel}>Loaded {provider?.label || 'Destination'} Options</p>
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
      {autoMatchError && !autoMatchPreview && <div role="alert" style={{ ...styles.statusMessage, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>{autoMatchError}</div>}

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div>
            <h2 style={styles.cardTitle}>Organization Mapping</h2>
            <p style={styles.description}>Choose a destination customer for each Action1 organization.</p>
          </div>
        </div>
        <div style={{ ...styles.headingRow, marginBottom: '0.75rem' }}>
          <div style={{ ...styles.buttonRow, flex: '1 1 320px', alignItems: 'center' }}>
            <input
              type="search"
              aria-label="Search organizations"
              placeholder="Search organizations..."
              value={organizationSearch}
              onChange={(event) => { setOrganizationSearch(event.target.value); setMappingPage(0); }}
              style={{ ...styles.input, flex: '1 1 240px', maxWidth: 440 }}
            />
            <select
              aria-label="Mapping filter"
              value={mappingFilter}
              onChange={(event) => { setMappingFilter(event.target.value); setMappingPage(0); }}
              style={{ ...styles.input, width: 'auto', minWidth: 130 }}
            >
              <option value="All">All</option>
              <option value="Mapped">Mapped</option>
              <option value="Unmapped">Unmapped</option>
            </select>
          </div>
          <div style={styles.buttonRow}>
            <button className="btn-secondary" type="button" onClick={addMappingRow} disabled={!mappingReady}>
              + Add Mapping
            </button>
            <button className="btn-secondary" type="button" onClick={openAutoMatchPreview} disabled={!mappingReady || loading || discovering || saving || autoMatchBusy}>
              Auto Match
            </button>
          </div>
        </div>
        <div style={{ ...styles.section, overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHead}>Action1 Organization</th>
                <th style={styles.tableHead}>Destination Customer</th>
                <th style={styles.tableHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 ? (
                <tr><td style={styles.tableCell} colSpan={3}>{action1Organizations.length ? 'No organizations match the current search and filter.' : 'No Action1 organizations are available.'}</td></tr>
              ) : page.rows.map((projectedRow, visibleIndex) => {
                const { row, draftIndex } = projectedRow;
                const rowIndex = draftIndex ?? -1;
                const sourceOptions = draftIndex === null ? [] : mappingOptionsForRow(
                  action1Organizations,
                  draftRows,
                  draftIndex,
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
                const selectedDestinationOption = destinationFieldOptions.find((option) => option.id === row.destinationId) || null;
                const destinationResultOptions = destinationFieldOptions.filter((option) => destinationOptions.some((current) => String(current.id) === option.id));

                return (
                  <tr key={projectedRow.key} data-mapping-row={projectedRow.kind}>
                    <td style={styles.tableCell}>
                      {projectedRow.kind === 'blank-draft' ? (
                        <>
                          <Action1OrganizationSelector
                            id={`map-org-${rowIndex}`}
                            label={`Action1 Organization row ${visibleIndex + 1}`}
                            rowIndex={rowIndex}
                            options={sourceOptions}
                            value={row.action1OrgId}
                            disabled={sourceOptions.length === 0 || Boolean(action1Error)}
                            onChange={(value) => {
                              const selected = sourceOptions.find((option) => option.value === value);
                              updateRow(rowIndex, 'action1OrgId', 'action1OrgName', value, selected?.name || '');
                            }}
                          />
                          {!row.action1OrgId || !row.destinationId ? <div style={{ ...styles.description, fontSize: '0.78rem' }}>Incomplete draft row</div> : null}
                        </>
                      ) : (
                        <>
                          <span>{projectedRow.action1OrgName}</span>
                          {draftIndex !== null && (!row.action1OrgId || !row.destinationId) ? <div style={{ ...styles.description, fontSize: '0.78rem' }}>Incomplete mapping</div> : null}
                        </>
                      )}
                    </td>
                    <td style={styles.tableCell}>
                      {DestinationFields ? (
                        <DestinationFields
                          providerId={activeProviderId}
                          providerLabel={provider?.label}
                          settings={activeProviderSettings}
                          row={{ ...row, action1OrgId: projectedRow.action1OrgId, action1OrgName: projectedRow.action1OrgName }}
                          rowIndex={visibleIndex}
                          options={destinationResultOptions}
                          selectedOption={selectedDestinationOption}
                          loading={discovering}
                          destinationLoading={destinationLoading}
                          error={destinationError}
                          disabled={saving}
                          searchQuery={destinationQuery}
                          hasMore={destinationHasMore}
                          nextPageToken={destinationNextPageToken}
                          searchSupported={destinationSearchSupported}
                          paginationSupported={destinationPaginationSupported}
                          complete={destinationPageComplete}
                          onSearch={searchDestinationOptions}
                          onLoadMore={loadMoreDestinationOptions}
                          onChange={(id, name) => updateProjectedRow(projectedRow, 'destinationId', 'destinationName', id, name)}
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
                      {draftIndex !== null ? (
                        <button
                          className="btn-secondary"
                          type="button"
                          data-map-remove={rowIndex}
                          aria-label={`Remove mapping row ${visibleIndex + 1}`}
                          onClick={() => removeDraftRow(rowIndex)}
                        >Remove</button>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={styles.tableButtonRow}>
          <div aria-live="polite">{page.total ? `Showing ${page.start}–${page.end} of ${page.total}` : 'Showing 0–0 of 0'}</div>
          <button className="btn-secondary" type="button" onClick={() => setMappingPage((current) => Math.max(0, current - 1))} disabled={page.page <= 0}>
            Previous
          </button>
          <button className="btn-secondary" type="button" onClick={() => setMappingPage((current) => Math.min(page.pageCount - 1, current + 1))} disabled={page.page >= page.pageCount - 1}>
            Next
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={saveMappings}
            disabled={!mappingReady || saving || Boolean(action1Error) || Boolean(destinationError)}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <div style={styles.tableFeedback} data-save-feedback>
            {autoMatchMessage && <div role="status" style={{ ...styles.statusMessage, width: '100%', background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }}>{autoMatchMessage}</div>}
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
      {autoMatchPreview ? (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !autoMatchBusy) setAutoMatchPreview(null); }} style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(17, 24, 39, 0.48)' }}>
          <section role="dialog" aria-modal="true" aria-labelledby="auto-match-title" className="glass-panel" style={{ ...styles.panel, width: 'min(720px, 100%)', maxHeight: '85vh', overflow: 'auto', background: '#fff' }}>
            <div style={{ ...styles.headingRow, alignItems: 'center' }}>
              <h2 id="auto-match-title" style={styles.cardTitle}>Auto Match Organizations</h2>
              <button type="button" className="btn-secondary" aria-label="Close Auto Match preview" onClick={() => setAutoMatchPreview(null)} disabled={autoMatchBusy}>×</button>
            </div>
            {autoMatchPreview.complete ? <p>{autoMatchPreview.analyzedCount} unmapped Action1 organizations analyzed</p> : <div role="alert" style={{ ...styles.statusMessage, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>{autoMatchPreview.message || 'Destination discovery is incomplete. Apply is unavailable.'}</div>}
            <div style={styles.buttonRow} aria-label="Auto Match result counts">
              <span>Exact Matches: {autoMatchPreview.counts?.exact || 0}</span><span>Unmatched: {autoMatchPreview.counts?.unmatched || 0}</span><span>Ambiguous: {autoMatchPreview.counts?.ambiguous || 0}</span>
            </div>
            {autoMatchPreview.complete ? <>
              <div role="tablist" aria-label="Auto Match results" style={{ ...styles.buttonRow, margin: '1rem 0' }}>
                {[['exact', 'Exact Matches'], ['unmatched', 'Unmatched'], ['ambiguous', 'Ambiguous']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={autoMatchCategory === key} onClick={() => setAutoMatchCategory(key)} className={autoMatchCategory === key ? 'btn-primary' : 'btn-secondary'}>{label}</button>)}
              </div>
              <div role="tabpanel" style={{ display: 'grid', gap: '0.35rem', maxHeight: 360, overflowY: 'auto' }}>
                {(autoMatchPreview[autoMatchCategory === 'exact' ? 'exactMatches' : autoMatchCategory] || []).map((item) => <div key={`${autoMatchCategory}-${item.action1OrgId}`} style={{ display: 'grid', gridTemplateColumns: autoMatchCategory === 'exact' ? '24px 1fr 1fr' : '1fr 1fr', gap: '0.6rem', alignItems: 'center', padding: '0.55rem', borderBottom: '1px solid var(--border-color)' }}>
                  {autoMatchCategory === 'exact' ? <input type="checkbox" aria-label={`Select ${item.action1OrgName}`} data-auto-match-source={item.action1OrgId} checked={selectedAutoMatches.includes(item.action1OrgId)} onChange={(event) => setSelectedAutoMatches((current) => event.target.checked ? [...new Set([...current, item.action1OrgId])] : current.filter((id) => id !== item.action1OrgId))} /> : null}
                  <span>{item.action1OrgName}</span><span>{autoMatchCategory === 'exact' ? `→ ${item.destinationName}` : item.reason || ''}</span>
                </div>)}
                {(autoMatchPreview[autoMatchCategory === 'exact' ? 'exactMatches' : autoMatchCategory] || []).length === 0 ? <p role="status">No {autoMatchCategory} results.</p> : null}
              </div>
            </> : null}
            {autoMatchError && <p role="alert" style={{ color: '#B91C1C' }}>{autoMatchError}</p>}
            <div style={{ ...styles.buttonRow, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn-secondary" onClick={() => setAutoMatchPreview(null)} disabled={autoMatchBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={applyAutoMatches} disabled={!autoMatchPreview.complete || autoMatchBusy || selectedAutoMatches.length === 0}>{autoMatchBusy ? 'Applying...' : `Apply Matches (${selectedAutoMatches.length})`}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
export default Mapping;
