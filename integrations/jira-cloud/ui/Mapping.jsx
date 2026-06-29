import { useEffect, useState } from 'react';

const ACTIONS = {
  list: 'list-jira-org-project-mappings',
  save: 'save-jira-org-project-mapping',
  remove: 'delete-jira-org-project-mapping',
  discoverAction1: 'discover-action1-mapping-options',
  discoverProjects: 'discover-jira-project-mapping-options',
  discoverIssueTypes: 'discover-jira-issue-type-mapping-options'
};

const EMPTY_ROW = {
  id: null,
  action1OrgId: '',
  action1OrgName: '',
  jiraProjectId: '',
  jiraProjectKey: '',
  jiraProjectName: '',
  jiraIssueTypeId: '',
  jiraIssueTypeName: ''
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

function normalizeOptions(rows, labelBuilder) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = String(row?.id || '').trim();
      if (!id) {
        return null;
      }

      const label = String(labelBuilder(row) || '').trim();
      if (!label) {
        return null;
      }

      return {
        value: id,
        label,
        row
      };
    })
    .filter(Boolean);
}

function ensureSelectedOption(options, value, label, row = {}) {
  const selectedValue = String(value || '').trim();
  const selectedLabel = String(label || '').trim();

  if (!selectedValue || !selectedLabel) {
    return options;
  }

  if (options.some((option) => option.value === selectedValue)) {
    return options;
  }

  return options.concat({
    value: selectedValue,
    label: selectedLabel,
    row
  });
}

function rowsEquivalent(left, right) {
  return (
    String(left?.action1OrgId || '') === String(right?.action1OrgId || '') &&
    String(left?.action1OrgName || '') === String(right?.action1OrgName || '') &&
    String(left?.jiraProjectId || '') === String(right?.jiraProjectId || '') &&
    String(left?.jiraProjectKey || '') === String(right?.jiraProjectKey || '') &&
    String(left?.jiraProjectName || '') === String(right?.jiraProjectName || '') &&
    String(left?.jiraIssueTypeId || '') === String(right?.jiraIssueTypeId || '') &&
    String(left?.jiraIssueTypeName || '') === String(right?.jiraIssueTypeName || '')
  );
}

function normalizeMappingRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row?.id ?? null,
    action1OrgId: String(row?.action1OrgId || ''),
    action1OrgName: String(row?.action1OrgName || ''),
    jiraProjectId: String(row?.jiraProjectId || ''),
    jiraProjectKey: String(row?.jiraProjectKey || ''),
    jiraProjectName: String(row?.jiraProjectName || ''),
    jiraIssueTypeId: String(row?.jiraIssueTypeId || ''),
    jiraIssueTypeName: String(row?.jiraIssueTypeName || '')
  }));
}

function mappingOptionsForRow(allOptions, rows, rowIndex, valueKey, labelKey, rowResolver) {
  const normalized = normalizeOptions(allOptions, rowResolver);
  const currentRow = rows[rowIndex] || EMPTY_ROW;
  const currentValue = String(currentRow?.[valueKey] || '').trim();
  return ensureSelectedOption(normalized, currentRow?.[valueKey], currentRow?.[labelKey], {
    id: currentRow?.[valueKey],
    name: currentRow?.[labelKey]
  });
}

function buildPersistRows(rows, action1Organizations, jiraProjects, issueTypesByProjectId) {
  const errors = [];
  const persistRows = [];
  const orgsById = new Map((Array.isArray(action1Organizations) ? action1Organizations : []).map((row) => [String(row.id), String(row.name)]));
  const projectsById = new Map((Array.isArray(jiraProjects) ? jiraProjects : []).map((row) => [String(row.id), row]));
  const seenAction1 = new Set();

  for (const row of rows) {
    const action1OrgId = String(row?.action1OrgId || '').trim();
    const jiraProjectId = String(row?.jiraProjectId || '').trim();
    const jiraIssueTypeId = String(row?.jiraIssueTypeId || '').trim();

    if (!action1OrgId && !jiraProjectId && !jiraIssueTypeId) {
      continue;
    }

    if (!action1OrgId || !jiraProjectId || !jiraIssueTypeId) {
      errors.push('Select an Action1 organization, a Jira project, and a Jira issue type, or remove the incomplete row.');
      continue;
    }

    if (seenAction1.has(action1OrgId)) {
      errors.push('Each Action1 organization can only be mapped once. Remove duplicate mappings before saving.');
      continue;
    }
    seenAction1.add(action1OrgId);

    const action1OrgName = String(orgsById.get(action1OrgId) || row?.action1OrgName || '').trim();
    const project = projectsById.get(jiraProjectId) || {
      id: row?.jiraProjectId,
      key: row?.jiraProjectKey,
      name: row?.jiraProjectName
    };
    const issueTypes = Array.isArray(issueTypesByProjectId?.[jiraProjectId]) ? issueTypesByProjectId[jiraProjectId] : [];
    const issueType = issueTypes.find((item) => String(item.id) === jiraIssueTypeId) || {
      id: row?.jiraIssueTypeId,
      name: row?.jiraIssueTypeName
    };

    const jiraProjectKey = String(project?.key || row?.jiraProjectKey || '').trim();
    const jiraProjectName = String(project?.name || row?.jiraProjectName || '').trim();
    const jiraIssueTypeName = String(issueType?.name || row?.jiraIssueTypeName || '').trim();

    if (!action1OrgName || !jiraProjectKey || !jiraProjectName || !jiraIssueTypeName) {
      errors.push('Saved mapping values are unavailable. Refresh discovery and reselect the Jira project or issue type before saving.');
      continue;
    }

    persistRows.push({
      id: row?.id ?? null,
      action1OrgId,
      action1OrgName,
      jiraProjectId,
      jiraProjectKey,
      jiraProjectName,
      jiraIssueTypeId,
      jiraIssueTypeName,
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
  const [jiraProjects, setJiraProjects] = useState([]);
  const [issueTypesByProjectId, setIssueTypesByProjectId] = useState({});
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [action1Error, setAction1Error] = useState('');
  const [jiraProjectError, setJiraProjectError] = useState('');
  const [issueTypeErrorsByProjectId, setIssueTypeErrorsByProjectId] = useState({});
  const [action1Diagnostics, setAction1Diagnostics] = useState(null);
  const [jiraProjectDiagnostics, setJiraProjectDiagnostics] = useState(null);
  const [issueTypeDiagnosticsByProjectId, setIssueTypeDiagnosticsByProjectId] = useState({});

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

  const loadJiraProjects = async () => {
    setJiraProjectError('');
    setJiraProjectDiagnostics(null);

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.discoverProjects}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: {} })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        setJiraProjects([]);
        setJiraProjectDiagnostics(data?.diagnostics || null);
        setJiraProjectError(data?.message || 'Unable to load Jira project options.');
        return;
      }

      setJiraProjects(Array.isArray(data?.jiraProjects) ? data.jiraProjects : []);
      setJiraProjectDiagnostics(null);
    } catch (nextError) {
      setJiraProjects([]);
      setJiraProjectError(nextError?.message || 'Unable to load Jira project options.');
    }
  };

  const loadIssueTypesForProject = async (jiraProjectId) => {
    const normalizedProjectId = String(jiraProjectId || '').trim();
    if (!normalizedProjectId) {
      return;
    }

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${ACTIONS.discoverIssueTypes}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {},
          payload: { jiraProjectId: normalizedProjectId }
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        setIssueTypesByProjectId((current) => ({ ...current, [normalizedProjectId]: [] }));
        setIssueTypeDiagnosticsByProjectId((current) => ({
          ...current,
          [normalizedProjectId]: data?.diagnostics || null
        }));
        setIssueTypeErrorsByProjectId((current) => ({
          ...current,
          [normalizedProjectId]: data?.message || 'Unable to load Jira issue type options.'
        }));
        return;
      }

      setIssueTypesByProjectId((current) => ({
        ...current,
        [normalizedProjectId]: Array.isArray(data?.jiraIssueTypes) ? data.jiraIssueTypes : []
      }));
      setIssueTypeDiagnosticsByProjectId((current) => ({
        ...current,
        [normalizedProjectId]: null
      }));
      setIssueTypeErrorsByProjectId((current) => ({
        ...current,
        [normalizedProjectId]: ''
      }));
    } catch (nextError) {
      setIssueTypesByProjectId((current) => ({ ...current, [normalizedProjectId]: [] }));
      setIssueTypeErrorsByProjectId((current) => ({
        ...current,
        [normalizedProjectId]: nextError?.message || 'Unable to load Jira issue type options.'
      }));
    }
  };

  const refreshDiscovery = async () => {
    setDiscovering(true);
    await Promise.allSettled([loadAction1Organizations(), loadJiraProjects()]);
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

  useEffect(() => {
    const projectIds = Array.from(new Set(
      draftRows
        .map((row) => String(row?.jiraProjectId || '').trim())
        .filter(Boolean)
    ));

    projectIds.forEach((projectId) => {
      if (!Object.prototype.hasOwnProperty.call(issueTypesByProjectId, projectId)) {
        loadIssueTypesForProject(projectId);
      }
    });
  }, [draftRows, issueTypesByProjectId]);

  const updateRow = (rowIndex, updater) => {
    setDraftRows((current) =>
      current.map((row, idx) => {
        if (idx !== rowIndex) {
          return row;
        }
        return updater(row);
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
      const { errors, persistRows } = buildPersistRows(draftRows, action1Organizations, jiraProjects, issueTypesByProjectId);

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
            jiraProjectId: row.jiraProjectId,
            jiraProjectKey: row.jiraProjectKey,
            jiraProjectName: row.jiraProjectName,
            jiraIssueTypeId: row.jiraIssueTypeId,
            jiraIssueTypeName: row.jiraIssueTypeName,
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
    return <div style={{ padding: '2rem' }}>Loading project mapping...</div>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 className="page-title" style={styles.title}>Project Mapping</h1>
        <p style={styles.description}>Map Action1 organizations to Jira projects and Jira issue types so future tickets are routed under the correct Jira destination.</p>
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
            <p style={styles.statLabel}>Jira Projects</p>
            <p style={styles.statValue}>{jiraProjects.length}</p>
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
      {jiraProjectError && (
        <div style={{ ...styles.statusMessage, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          {jiraProjectError}
          {jiraProjectDiagnostics ? <DiagnosticDetails diagnostics={jiraProjectDiagnostics} /> : null}
        </div>
      )}

      <div className="glass-panel" style={styles.panel}>
        <div style={styles.headingRow}>
          <div>
            <h4 style={styles.cardTitle}>Organization Mapping</h4>
            <p style={styles.description}>
              Choose the Jira project and Jira issue type for each Action1 organization.
            </p>
          </div>
        </div>

        <div style={{ ...styles.section, overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHead}>Action1 Organization</th>
                <th style={styles.tableHead}>Jira Project</th>
                <th style={styles.tableHead}>Jira Issue Type</th>
                <th style={styles.tableHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr>
                  <td style={styles.tableCell} colSpan={4}>No mappings added yet.</td>
                </tr>
              ) : (
                draftRows.map((row, rowIndex) => {
                  const action1Options = mappingOptionsForRow(
                    action1Organizations,
                    draftRows,
                    rowIndex,
                    'action1OrgId',
                    'action1OrgName',
                    (item) => item?.name
                  );
                  const projectOptions = mappingOptionsForRow(
                    jiraProjects,
                    draftRows,
                    rowIndex,
                    'jiraProjectId',
                    'jiraProjectName',
                    (item) => {
                      const name = String(item?.name || '').trim();
                      const key = String(item?.key || '').trim();
                      return key ? `${name} (${key})` : name;
                    }
                  );
                  const issueTypeRows = issueTypesByProjectId[row.jiraProjectId] || [];
                  const issueTypeOptions = ensureSelectedOption(
                    normalizeOptions(issueTypeRows, (item) => item?.name),
                    row.jiraIssueTypeId,
                    row.jiraIssueTypeName,
                    { id: row.jiraIssueTypeId, name: row.jiraIssueTypeName }
                  );
                  const rowIssueTypeError = issueTypeErrorsByProjectId[row.jiraProjectId] || '';
                  const rowIssueTypeDiagnostics = issueTypeDiagnosticsByProjectId[row.jiraProjectId] || null;

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
                            updateRow(rowIndex, (current) => ({
                              ...current,
                              action1OrgId: nextId,
                              action1OrgName: String(selected?.row?.name || '')
                            }));
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
                          id={`map-project-${rowIndex}`}
                          aria-label={`Jira Project row ${rowIndex + 1}`}
                          data-map-project={rowIndex}
                          value={row.jiraProjectId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const selected = projectOptions.find((option) => option.value === nextId)?.row || null;
                            updateRow(rowIndex, (current) => ({
                              ...current,
                              jiraProjectId: nextId,
                              jiraProjectKey: String(selected?.key || ''),
                              jiraProjectName: String(selected?.name || ''),
                              jiraIssueTypeId: '',
                              jiraIssueTypeName: ''
                            }));
                            if (nextId) {
                              loadIssueTypesForProject(nextId);
                            }
                          }}
                          style={styles.input}
                          disabled={projectOptions.length === 0 || Boolean(jiraProjectError)}
                        >
                          <option value="">-- Select --</option>
                          {projectOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={styles.tableCell}>
                        <select
                          id={`map-issuetype-${rowIndex}`}
                          aria-label={`Jira Issue Type row ${rowIndex + 1}`}
                          data-map-issuetype={rowIndex}
                          value={row.jiraIssueTypeId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const selected = issueTypeOptions.find((option) => option.value === nextId)?.row || null;
                            updateRow(rowIndex, (current) => ({
                              ...current,
                              jiraIssueTypeId: nextId,
                              jiraIssueTypeName: String(selected?.name || '')
                            }));
                          }}
                          style={styles.input}
                          disabled={!row.jiraProjectId || issueTypeOptions.length === 0 || Boolean(rowIssueTypeError)}
                        >
                          <option value="">{row.jiraProjectId ? '-- Select --' : 'Select project first'}</option>
                          {issueTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        {rowIssueTypeError && (
                          <div style={{ marginTop: '0.45rem', color: '#92400E', fontSize: '0.82rem', lineHeight: 1.45 }}>
                            {rowIssueTypeError}
                            {rowIssueTypeDiagnostics ? <DiagnosticDetails diagnostics={rowIssueTypeDiagnostics} /> : null}
                          </div>
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
            disabled={saving || Boolean(action1Error) || Boolean(jiraProjectError)}
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
