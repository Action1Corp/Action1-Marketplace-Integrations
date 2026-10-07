import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildControlPackCatalog, countExpectedAutomations, countSelectedControlFamilies } from '../catalog/controlPackCatalog.js';
import PolicyDetailsView from './PolicyDetailsView.jsx';
import PolicyEditorView from './PolicyEditorView.jsx';
import PolicyListView from './PolicyListView.jsx';
import OperationStatus from './OperationStatus.jsx';
import { createHistoryAdapter } from '../historyAdapter.js';
import { extractHistoryEnvelope } from '../historyEnvelope.js';
import { createHistoryProgressPoller, formatAutomationProgressCopy } from './historyProgressPoller.js';
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
import { buildPolicyDetailsPath, buildPoliciesListPath, buildPolicyEditPath, buildPolicyCreatePath, getPolicyRouteFromSearch } from './policyRouting.js';

const styles = {
  shell: {
    width: '100%',
    maxWidth: 960,
    margin: '0 auto',
    display: 'grid',
    gap: '0.75rem',
    fontFamily: policyUiTokens.fontFamily
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
  notFound: {
    ...pageSurfaceStyle,
    padding: '1.5rem',
    display: 'grid',
    gap: '0.65rem'
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

function createProgressOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
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
  const location = useLocation();
  const navigate = useNavigate();
  const mode = getPolicyRouteFromSearch(location.search);
  const routePolicyId = mode.policyId;
  const routeKey = location.key + ':' + location.search;
  // Each navigation initializes its editor once; rerenders must preserve user edits.
  const currentRouteRef = useRef(routeKey);
  currentRouteRef.current = routeKey;
  const initializedEditorRef = useRef(null);
  const policyApiRef = useRef(createPolicyApi(integration));
  const historyApiRef = useRef(createHistoryAdapter({ integration, extractEnvelope: extractHistoryEnvelope }));
  const discoveryApiRef = useRef(createPolicyDiscoveryApi(integration));
  const repositoriesRef = useRef({
    organizationRepository: createAction1OrganizationRepository(discoveryApiRef.current),
    endpointGroupRepository: createAction1EndpointGroupRepository(discoveryApiRef.current)
  });
  const [draft, setDraft] = useState(null);
  const [validationResult, setValidationResult] = useState({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
  const [pendingAction, setPendingAction] = useState(null);
  const [busyOperation, setBusyOperation] = useState('');
  const [busySecondary, setBusySecondary] = useState('');
  const [progressOperation, setProgressOperation] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [pageError, setPageError] = useState('');
  const [routeResolution, setRouteResolution] = useState(routePolicyId ? 'loading' : 'ready');
  const [organizations, setOrganizations] = useState([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState('');
  const [endpointGroupsByOrganization, setEndpointGroupsByOrganization] = useState({});
  const [endpointGroupStateByOrganization, setEndpointGroupStateByOrganization] = useState({});
  const [allEndpointsAvailableByOrganization, setAllEndpointsAvailableByOrganization] = useState({});
  const [organizationBlockedByAllEndpointsByOrganization, setOrganizationBlockedByAllEndpointsByOrganization] = useState({});
  const [hasGroupReservationsByOrganization, setHasGroupReservationsByOrganization] = useState({});

  const selectedPolicy = mode.policyId ? policies.find((policy) => policy.policyId === mode.policyId) || null : null;

  useEffect(() => {
    if (!progressOperation || progressOperation.routeKey !== routeKey) return undefined;
    return createHistoryProgressPoller({
      historyAdapter: historyApiRef.current,
      actionId: progressOperation.actionId,
      operation: progressOperation.operation,
      operationId: progressOperation.operationId,
      onProgress: (checkpoint) => setBusySecondary(formatAutomationProgressCopy(progressOperation.operation, checkpoint)),
      onFinished: () => setProgressOperation(null),
      intervalMs: 2000
    });
  }, [progressOperation, routeKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCatalog(true);
    void policyApiRef.current.getControlPack().then((result) => {
      if (!cancelled) {
        setCatalog(buildControlPackCatalog(result));
        setCatalogError('');
      }
    }).catch((error) => {
      if (!cancelled) setCatalogError(error?.message || 'Unable to load the installed Control Pack.');
    }).finally(() => {
      if (!cancelled) setLoadingCatalog(false);
    });
    return () => { cancelled = true; };
  }, [integration]);

  useEffect(() => {
    initializedEditorRef.current = null;
    setDraft(null);
    setPendingAction(null);
    setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
    setPageError('');
    setOrganizationsLoading(false);
    setRouteResolution(routePolicyId ? 'loading' : 'ready');
    if (mode.kind === 'create') {
      const params = new URLSearchParams(location.search);
      if (params.has('policyId')) {
        params.delete('policyId');
        navigate('/apps/' + encodeURIComponent(integration) + '/policies?' + params, { replace: true });
        return;
      }
      const now = new Date();
      setDraft({ ...createPolicyDraft({
        currentDate: formatCurrentDate(now),
        currentTime: formatCurrentTimePlusThirtyMinutes(now),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }), baseName: mode.policyName });
      initializedEditorRef.current = routeKey;
      setEndpointGroupsByOrganization({});
      setEndpointGroupStateByOrganization({});
      setAllEndpointsAvailableByOrganization({});
      setOrganizationBlockedByAllEndpointsByOrganization({});
      setHasGroupReservationsByOrganization({});
    }
  }, [routeKey]);

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

  useEffect(() => {
    if (!routePolicyId || loadingPolicies || loadingCatalog || !catalog) {
      return;
    }

    function resolvePolicy(policy) {
      setRouteResolution('found');
      if (mode.kind === 'edit' && initializedEditorRef.current !== routeKey) {
        setDraft(createDraftFromPolicy(policy, catalog));
        initializedEditorRef.current = routeKey;
      }
    }
    const loadedPolicy = policies.find((policy) => policy.policyId === routePolicyId);
    if (loadedPolicy) {
      resolvePolicy(loadedPolicy);
      return;
    }

    let cancelled = false;
    setRouteResolution('loading');
    void (async () => {
      try {
        const policy = await policyApiRef.current.getPolicy(routePolicyId);
        if (cancelled || currentRouteRef.current !== routeKey) return;
        if (policy) {
          setPolicies((current) => current.some((entry) => entry.policyId === policy.policyId) ? current : [...current, attachPolicyMetrics(policy)]);
          resolvePolicy(policy);
        } else {
          setRouteResolution('not-found');
        }
      } catch (error) {
        if (!cancelled && currentRouteRef.current === routeKey) {
          setRouteResolution('not-found');
          setPageError(error?.message || 'Unable to load the requested Policy.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadingPolicies, loadingCatalog, catalog, policies, routeKey]);

  async function loadOrganizations() {
    setOrganizationsLoading(true);
    setOrganizationsError('');
    try {
      const nextOrganizations = await repositoriesRef.current.organizationRepository.listOrganizations();
      if (currentRouteRef.current !== routeKey) return;
      setOrganizations(nextOrganizations || []);
    } catch (error) {
      if (currentRouteRef.current !== routeKey) return;
      setOrganizations([]);
      setOrganizationsError(error?.message || 'Unable to load Action1 organizations.');
    } finally {
      if (currentRouteRef.current === routeKey) setOrganizationsLoading(false);
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
      if (currentRouteRef.current !== routeKey) return;
      setEndpointGroupsByOrganization((current) => ({
        ...current,
        [organizationId]: result.endpointGroups || []
      }));
      setAllEndpointsAvailableByOrganization((current) => ({
        ...current,
        [organizationId]: result.allEndpointsAvailable !== false
      }));
      setOrganizationBlockedByAllEndpointsByOrganization((current) => ({
        ...current,
        [organizationId]: result.organizationBlockedByAllEndpoints === true
      }));
      setHasGroupReservationsByOrganization((current) => ({
        ...current,
        [organizationId]: result.hasAnyGroupReservations === true
      }));
      setEndpointGroupStateByOrganization((current) => ({
        ...current,
        [organizationId]: { loading: false, error: '' }
      }));
    } catch (error) {
      if (currentRouteRef.current !== routeKey) return;
      setEndpointGroupsByOrganization((current) => ({
        ...current,
        [organizationId]: []
      }));
      setAllEndpointsAvailableByOrganization((current) => ({
        ...current,
        [organizationId]: false
      }));
      setOrganizationBlockedByAllEndpointsByOrganization((current) => ({
        ...current,
        [organizationId]: false
      }));
      setHasGroupReservationsByOrganization((current) => ({
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
    navigate(buildPolicyCreatePath(integration, location.search));
  }

  function openDetails(policyId, options) {
    navigate(buildPolicyDetailsPath(integration, policyId, location.search), options);
  }

  function openEdit(policyId) {
    navigate(buildPolicyEditPath(integration, policyId, location.search));
  }

  function returnToList(options) {
    navigate(buildPoliciesListPath(integration, location.search), options);
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
      const isCreate = nextDraft.mode !== 'edit';
      const progressOperationId = isCreate ? createProgressOperationId() : null;
      setBusyOperation(nextDraft.mode === 'edit' ? 'Applying Policy changes…' : 'Creating Policy...');
      setBusySecondary('');
      setProgressOperation(isCreate ? { operation: 'create', actionId: 'create-policy', operationId: progressOperationId, routeKey } : null);
      try {
        const savedPolicy = await policyApiRef.current.savePolicy(buildPolicyDraftPayload(nextDraft, catalog), progressOperationId);
        await refreshPolicies();
        if (currentRouteRef.current !== routeKey) return;
        if (nextDraft.mode === 'edit') {
          openDetails(savedPolicy.policyId, { replace: true });
        } else {
          returnToList({ replace: true });
        }
      } catch (error) {
        if (currentRouteRef.current === routeKey) setPageError(error?.message || 'Unable to save the Policy.');
      } finally {
        setBusyOperation('');
        setBusySecondary('');
        setProgressOperation(null);
      }
    })();

    return true;
  }

  function togglePolicyEnabled(policyId, enabled) {
    if (busyOperation) return;
    setBusyOperation(enabled ? 'Enabling Policy…' : 'Disabling Policy…');
    void (async () => {
      try {
        await policyApiRef.current.setPolicyEnabled(policyId, enabled);
        await refreshPolicies();
      } catch (error) {
        setPageError(error?.message || 'Unable to update the Policy status.');
      } finally {
        setBusyOperation('');
      }
    })();
  }

  function deletePolicy(policyId) {
    if (busyOperation) return;
    const progressOperationId = createProgressOperationId();
    setBusyOperation('Deleting Policy...');
    setBusySecondary('');
    setProgressOperation({ operation: 'delete', actionId: 'delete-policy', operationId: progressOperationId, routeKey });
    void (async () => {
      try {
        await policyApiRef.current.deletePolicy(policyId, progressOperationId);
        await refreshPolicies();
        if (currentRouteRef.current === routeKey) returnToList();
      } catch (error) {
        setPageError(error?.message || 'Unable to delete the Policy.');
      } finally {
        setBusyOperation('');
        setBusySecondary('');
        setProgressOperation(null);
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
  const organizationBlockedByAllEndpoints = currentOrganizationId ? organizationBlockedByAllEndpointsByOrganization[currentOrganizationId] === true : false;
  const hasAnyGroupReservations = currentOrganizationId ? hasGroupReservationsByOrganization[currentOrganizationId] === true : false;

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
      <OperationStatus primaryLabel={busyOperation} secondaryLabel={busySecondary} />
      {mode.kind === 'invalid' ? <div style={styles.errorNotice} role="alert">Policy id is required to edit a Policy.</div> : null}
      {(catalogError || pageError) ? <div style={styles.errorNotice}>{catalogError || pageError}</div> : null}
      {loadingPolicies || loadingCatalog ? <div style={styles.notice}>Loading Configuration Manager…</div> : !catalog ? null : (
        <>
      {(mode.kind === 'list' || mode.kind === 'invalid') ? (
            <PolicyListView
              integration={integration}
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
          onBack={() => returnToList()}
          onDelete={() => openLifecycleConfirmation('delete', selectedPolicy.policyId)}
          onDisable={() => openLifecycleConfirmation('disable', selectedPolicy.policyId)}
          onEdit={() => openEdit(selectedPolicy.policyId)}
          onEnable={() => openLifecycleConfirmation('enable', selectedPolicy.policyId)}
          busy={Boolean(busyOperation)}
        />
      ) : null}
      {(mode.kind === 'details' || mode.kind === 'edit') && !selectedPolicy && routeResolution === 'not-found' ? (
        <div style={styles.notFound} role="status">
          <h2 style={styles.dialogTitle}>Policy not found</h2>
          <p style={styles.dialogText}>The requested Policy may have been deleted or is no longer available.</p>
          <div>
            <button type="button" style={styles.button} onClick={() => returnToList()}>Back to Policies</button>
          </div>
        </div>
      ) : null}
      {(mode.kind === 'create' || mode.kind === 'edit') && draft && initializedEditorRef.current === routeKey ? (
        <PolicyEditorView
          key={routeKey}
          catalog={catalog}
          draft={draft}
          allEndpointsAvailable={allEndpointsAvailable}
          organizationBlockedByAllEndpoints={organizationBlockedByAllEndpoints}
          hasAnyGroupReservations={hasAnyGroupReservations}
          endpointGroups={endpointGroups}
          endpointGroupsError={endpointGroupState.error}
          endpointGroupsLoading={endpointGroupState.loading}
          isEditMode={mode.kind === 'edit'}
          onCancel={mode.kind === 'edit' ? () => openDetails(draft.policyId, { replace: true }) : () => returnToList({ replace: true })}
          onChange={setDraft}
          onSave={saveDraft}
          organizations={organizations}
          organizationsError={organizationsError}
          organizationsLoading={organizationsLoading}
          validationResult={validationResult}
          busy={Boolean(busyOperation)}
        />
      ) : null}
        </>
      )}
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
