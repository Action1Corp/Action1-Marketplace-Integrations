import { useEffect, useRef, useState } from 'react';
import { loadReleasedControlCatalog, countExpectedAutomations, countSelectedControlFamilies } from '../catalog/controlPackCatalog.js';
import PolicyDetailsView from './PolicyDetailsView.jsx';
import PolicyEditorView from './PolicyEditorView.jsx';
import PolicyListView from './PolicyListView.jsx';
import OperationStatus from './OperationStatus.jsx';
import { createPolicyApi } from './policyApi.js';
import { createPolicyDiscoveryApi } from './policyDiscoveryApi.js';
import { createAction1OrganizationRepository } from './action1OrganizationRepository.js';
import { createAction1EndpointGroupRepository } from './action1EndpointGroupRepository.js';
import {
  destructivePrimaryButtonStyle,
  pageSurfaceStyle,
  policyUiTokens,
  primaryButtonStyle,
  secondaryButtonStyle
} from './policyUiStyles.js';
import { createDraftFromPolicy, createPolicyDraft } from './policyEditorState.js';
import { validatePolicyDraft } from './policyValidation.js';

const styles = {
  shell: {
    width: '100%',
    maxWidth: 960,
    margin: '0 auto',
    display: 'grid',
    gap: '0.75rem'
  },
  title: {
    margin: 0
  },
  description: {
    margin: 0,
    color: policyUiTokens.textSecondary,
    fontSize: policyUiTokens.fontSizes.body,
    lineHeight: 1.5
  },
  notice: {
    ...pageSurfaceStyle,
    padding: '0.875rem 1rem',
    color: policyUiTokens.textSecondary
  },
  errorNotice: {
    ...pageSurfaceStyle,
    padding: '0.875rem 1rem',
    color: '#b91c1c',
    borderColor: '#fecaca',
    background: '#fff7f7'
  },
  dialogBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.16)',
    display: 'grid',
    placeItems: 'center',
    padding: '1rem',
    zIndex: 20
  },
  dialogCard: {
    ...pageSurfaceStyle,
    width: '100%',
    maxWidth: 520,
    padding: '1rem',
    display: 'grid',
    gap: '0.75rem',
    boxShadow: policyUiTokens.shadowOverlay
  },
  dialogTitle: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.section,
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  },
  dialogText: {
    margin: 0,
    color: policyUiTokens.textSecondary,
    fontSize: policyUiTokens.fontSizes.label,
    lineHeight: 1.5
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem'
  },
  button: {
    ...secondaryButtonStyle
  },
  primaryButton: {
    ...primaryButtonStyle
  },
  destructiveButton: {
    ...destructivePrimaryButtonStyle
  }
};

function formatCurrentDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrentTimePlusThirtyMinutes(date) {
  const nextDate = new Date(date.getTime() + 30 * 60 * 1000);
  const hours = String(nextDate.getHours()).padStart(2, '0');
  const minutes = String(nextDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function attachPolicyMetrics(policy) {
  return {
    ...policy,
    selectedFamilyCount: countSelectedControlFamilies(policy.selectedControls || []),
    expectedAutomationCount: countExpectedAutomations(policy.selectedControls || [])
  };
}

function buildPolicyDraftPayload(draft, catalog) {
  return {
    mode: draft.mode,
    policyId: draft.policyId || '',
    enabled: draft.enabled !== false,
    baseName: draft.baseName,
    description: draft.description || '',
    organizationId: draft.organizationId,
    organizationName: draft.organizationName,
    scopeType: draft.scopeType,
    endpointGroupId: draft.scopeType === 'ENDPOINT_GROUP' ? draft.endpointGroupId : '',
    endpointGroupName: draft.scopeType === 'ENDPOINT_GROUP' ? draft.endpointGroupName : '',
    policyMode: draft.policyMode,
    runSchedule: {
      runEveryHours: draft.runSchedule?.runEveryHours,
      startDate: draft.runSchedule?.startDate,
      startTime: draft.runSchedule?.startTime,
      timezone: draft.runSchedule?.timezone
    },
    completionDeadlineMinutes: draft.completionDeadlineMinutes,
    controlPackId: catalog.packId,
    controlPackVersion: catalog.packVersion,
    selectedControls: (draft.selectedControls || []).map((selectedControl) => ({
      controlId: selectedControl.controlId,
      controlVersion: selectedControl.controlVersion,
      automationGroupId: selectedControl.automationGroupId,
      automationGroupVersion: selectedControl.automationGroupVersion,
      parameters: selectedControl.parameters || {}
    }))
  };
}

function formatLifecycleMessage(kind, policy) {
  if (kind === 'enable') {
    return `Enable ${policy.displayName}. The Policy remains reserved for its current scope.`;
  }

  if (kind === 'disable') {
    return `Disable ${policy.displayName}. The Policy remains available, and its scope reservation stays in place.`;
  }

  return `Delete ${policy.displayName}. This removes the persisted Policy and releases its reserved scope.`;
}

function PolicyPage({ integration }) {
  const catalogRef = useRef(loadReleasedControlCatalog());
  const policyApiRef = useRef(createPolicyApi(integration));
  const discoveryApiRef = useRef(createPolicyDiscoveryApi(integration));
  const repositoriesRef = useRef({
    organizationRepository: createAction1OrganizationRepository(discoveryApiRef.current),
    endpointGroupRepository: createAction1EndpointGroupRepository(discoveryApiRef.current)
  });
  const [mode, setMode] = useState({ kind: 'list', policyId: null });
  const [draft, setDraft] = useState(null);
  const [validationResult, setValidationResult] = useState({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
  const [pendingAction, setPendingAction] = useState(null);
  const [busyOperation, setBusyOperation] = useState('');
  const [policies, setPolicies] = useState([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [pageError, setPageError] = useState('');
  const [organizations, setOrganizations] = useState([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState('');
  const [endpointGroupsByOrganization, setEndpointGroupsByOrganization] = useState({});
  const [endpointGroupStateByOrganization, setEndpointGroupStateByOrganization] = useState({});
  const [allEndpointsAvailableByOrganization, setAllEndpointsAvailableByOrganization] = useState({});

  const catalog = catalogRef.current;
  const selectedPolicy = mode.policyId ? policies.find((policy) => policy.policyId === mode.policyId) || null : null;

  async function refreshPolicies() {
    setLoadingPolicies(true);
    try {
      const nextPolicies = await policyApiRef.current.listPolicies();
      setPolicies((nextPolicies || []).map(attachPolicyMetrics));
      setPageError('');
    } catch (error) {
      setPageError(error?.message || 'Unable to load Policies.');
    } finally {
      setLoadingPolicies(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingPolicies(true);
      try {
        const nextPolicies = await policyApiRef.current.listPolicies();
        if (!cancelled) {
          setPolicies((nextPolicies || []).map(attachPolicyMetrics));
          setPageError('');
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(error?.message || 'Unable to load Policies.');
        }
      } finally {
        if (!cancelled) {
          setLoadingPolicies(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [integration]);

  async function loadOrganizations() {
    setOrganizationsLoading(true);
    setOrganizationsError('');
    try {
      const nextOrganizations = await repositoriesRef.current.organizationRepository.listOrganizations();
      setOrganizations(nextOrganizations || []);
    } catch (error) {
      setOrganizations([]);
      setOrganizationsError(error?.message || 'Unable to load Action1 organizations.');
    } finally {
      setOrganizationsLoading(false);
    }
  }

  async function loadEndpointGroupsForOrganization(organizationId, options = {}) {
    if (!organizationId) {
      return;
    }

    setEndpointGroupStateByOrganization((current) => ({
      ...current,
      [organizationId]: { loading: true, error: '' }
    }));

    try {
      const result = await repositoriesRef.current.endpointGroupRepository.listEndpointGroups(organizationId, options);
      setEndpointGroupsByOrganization((current) => ({
        ...current,
        [organizationId]: result.endpointGroups || []
      }));
      setAllEndpointsAvailableByOrganization((current) => ({
        ...current,
        [organizationId]: result.allEndpointsAvailable !== false
      }));
      setEndpointGroupStateByOrganization((current) => ({
        ...current,
        [organizationId]: { loading: false, error: '' }
      }));
    } catch (error) {
      setEndpointGroupsByOrganization((current) => ({
        ...current,
        [organizationId]: []
      }));
      setAllEndpointsAvailableByOrganization((current) => ({
        ...current,
        [organizationId]: false
      }));
      setEndpointGroupStateByOrganization((current) => ({
        ...current,
        [organizationId]: {
          loading: false,
          error: error?.message || 'Unable to load Action1 endpoint groups.'
        }
      }));
    }
  }

  function openCreate() {
    const now = new Date();
    setMode({ kind: 'create', policyId: null });
    setDraft(
      createPolicyDraft({
        currentDate: formatCurrentDate(now),
        currentTime: formatCurrentTimePlusThirtyMinutes(now),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    );
    setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
    if (!organizationsLoading && organizations.length === 0 && !organizationsError) {
      void loadOrganizations();
    }
  }

  function openDetails(policyId) {
    setMode({ kind: 'details', policyId });
    setDraft(null);
    setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
  }

  async function openEdit(policyId) {
    try {
      const policy = policies.find((entry) => entry.policyId === policyId) || (await policyApiRef.current.getPolicy(policyId));
      if (!policy) {
        setPageError('Policy was not found.');
        return;
      }

      setMode({ kind: 'edit', policyId });
      setDraft(createDraftFromPolicy(policy, catalog));
      setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
      setPageError('');
    } catch (error) {
      setPageError(error?.message || 'Unable to load the Policy for editing.');
    }
  }

  function returnToList() {
    setMode({ kind: 'list', policyId: null });
    setDraft(null);
    setPendingAction(null);
    setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
  }

  function saveDraft(nextDraft) {
    const nextValidationResult = validatePolicyDraft(nextDraft, catalog, repositoriesRef.current);
    setValidationResult(nextValidationResult);

    if (
      nextDraft.__preventSave ||
      nextValidationResult.blockingMessage ||
      Object.keys(nextValidationResult.fieldErrors).length > 0
    ) {
      return false;
    }

    void (async () => {
      setBusyOperation(nextDraft.mode === 'edit' ? 'Applying Policy changes…' : 'Creating Action1 automations…');
      try {
        const savedPolicy = await policyApiRef.current.savePolicy(buildPolicyDraftPayload(nextDraft, catalog));
        await refreshPolicies();
        if (nextDraft.mode === 'edit') {
          openDetails(savedPolicy.policyId);
        } else {
          returnToList();
        }
      } catch (error) {
        setPageError(error?.message || 'Unable to save the Policy.');
      } finally {
        setBusyOperation('');
      }
    })();

    return true;
  }

  function togglePolicyEnabled(policyId, enabled) {
    if (busyOperation) return;
    setBusyOperation(enabled ? 'Enabling Policy…' : 'Disabling Policy…');
    void (async () => {
      try {
        const updatedPolicy = await policyApiRef.current.setPolicyEnabled(policyId, enabled);
        await refreshPolicies();
        if (mode.kind === 'details') {
          setMode({ kind: 'details', policyId: updatedPolicy.policyId });
        }
      } catch (error) {
        setPageError(error?.message || 'Unable to update the Policy status.');
      } finally {
        setBusyOperation('');
      }
    })();
  }

  function deletePolicy(policyId) {
    if (busyOperation) return;
    setBusyOperation('Deleting Policy…');
    void (async () => {
      try {
        await policyApiRef.current.deletePolicy(policyId);
        await refreshPolicies();
        returnToList();
      } catch (error) {
        setPageError(error?.message || 'Unable to delete the Policy.');
      } finally {
        setBusyOperation('');
      }
    })();
  }

  function openLifecycleConfirmation(kind, policyId) {
    setPendingAction({ kind, policyId });
  }

  function confirmPendingAction() {
    if (!pendingAction) {
      return;
    }

    if (busyOperation) return;

    if (pendingAction.kind === 'enable') {
      togglePolicyEnabled(pendingAction.policyId, true);
    }
    if (pendingAction.kind === 'disable') {
      togglePolicyEnabled(pendingAction.policyId, false);
    }
    if (pendingAction.kind === 'delete') {
      deletePolicy(pendingAction.policyId);
    }
    setPendingAction(null);
  }

  const pendingPolicy = pendingAction?.policyId ? policies.find((policy) => policy.policyId === pendingAction.policyId) || null : null;
  const currentOrganizationId = draft?.organizationId || '';
  const endpointGroups = currentOrganizationId ? endpointGroupsByOrganization[currentOrganizationId] || [] : [];
  const endpointGroupState = currentOrganizationId ? endpointGroupStateByOrganization[currentOrganizationId] || { loading: false, error: '' } : { loading: false, error: '' };
  const allEndpointsAvailable = currentOrganizationId ? allEndpointsAvailableByOrganization[currentOrganizationId] !== false : false;

  useEffect(() => {
    if (mode.kind !== 'create') {
      return;
    }
    if (!organizationsLoading && organizations.length === 0 && !organizationsError) {
      void loadOrganizations();
    }
  }, [mode.kind, organizations.length, organizationsLoading, organizationsError]);

  useEffect(() => {
    if (mode.kind !== 'create' || !draft?.organizationId) {
      return;
    }
    if (endpointGroupsByOrganization[draft.organizationId] || endpointGroupStateByOrganization[draft.organizationId]?.loading) {
      return;
    }
    void loadEndpointGroupsForOrganization(draft.organizationId);
  }, [mode.kind, draft?.organizationId, endpointGroupsByOrganization, endpointGroupStateByOrganization]);

  return (
    <div style={styles.shell} data-integration={integration}>
      <h1 className="page-title" style={styles.title}>Policies</h1>
      <p style={styles.description}>
        Create and manage Windows configuration policies that assess and remediate endpoints through scheduled Action1 automations.
      </p>
      <OperationStatus label={busyOperation} />
      {pageError ? <div style={styles.errorNotice}>{pageError}</div> : null}
      {loadingPolicies ? <div style={styles.notice}>Loading Policies…</div> : null}
      {mode.kind === 'list' ? (
        <PolicyListView
          policies={policies}
          onCreate={openCreate}
          onDelete={(policyId) => openLifecycleConfirmation('delete', policyId)}
          onDisable={(policyId) => openLifecycleConfirmation('disable', policyId)}
          onEnable={(policyId) => openLifecycleConfirmation('enable', policyId)}
          onOpen={openDetails}
          onEdit={openEdit}
          busy={Boolean(busyOperation)}
        />
      ) : null}
      {mode.kind === 'details' && selectedPolicy ? (
        <PolicyDetailsView
          catalog={catalog}
          policy={selectedPolicy}
          onBack={returnToList}
          onDelete={() => openLifecycleConfirmation('delete', selectedPolicy.policyId)}
          onDisable={() => openLifecycleConfirmation('disable', selectedPolicy.policyId)}
          onEdit={() => openEdit(selectedPolicy.policyId)}
          onEnable={() => openLifecycleConfirmation('enable', selectedPolicy.policyId)}
          busy={Boolean(busyOperation)}
        />
      ) : null}
      {(mode.kind === 'create' || mode.kind === 'edit') && draft ? (
        <PolicyEditorView
          catalog={catalog}
          draft={draft}
          allEndpointsAvailable={allEndpointsAvailable}
          endpointGroups={endpointGroups}
          endpointGroupsError={endpointGroupState.error}
          endpointGroupsLoading={endpointGroupState.loading}
          isEditMode={mode.kind === 'edit'}
          onCancel={mode.kind === 'edit' ? () => openDetails(draft.policyId) : returnToList}
          onChange={setDraft}
          onSave={saveDraft}
          organizations={organizations}
          organizationsError={organizationsError}
          organizationsLoading={organizationsLoading}
          validationResult={validationResult}
          busy={Boolean(busyOperation)}
        />
      ) : null}
      {pendingAction && pendingPolicy ? (
        <div style={styles.dialogBackdrop}>
          <div style={styles.dialogCard}>
            <h2 style={styles.dialogTitle}>
              {pendingAction.kind === 'enable'
                ? 'Enable Policy?'
                : pendingAction.kind === 'disable'
                  ? 'Disable Policy?'
                  : 'Delete Policy?'}
            </h2>
            <p style={styles.dialogText}>{formatLifecycleMessage(pendingAction.kind, pendingPolicy)}</p>
            <div style={styles.dialogActions}>
              <button type="button" style={styles.button} onClick={() => setPendingAction(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={pendingAction.kind === 'delete' ? styles.destructiveButton : styles.primaryButton}
                onClick={confirmPendingAction}
              >
                {pendingAction.kind === 'enable'
                  ? 'Enable Policy'
                  : pendingAction.kind === 'disable'
                    ? 'Disable Policy'
                    : 'Delete Policy'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PolicyPage;
