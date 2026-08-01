import { useMemo, useRef, useState } from 'react';
import { loadReleasedControlCatalog, countExpectedAutomations, countSelectedControlFamilies } from '../catalog/controlPackCatalog.js';
import { createDemoEndpointGroupRepository } from '../demo/demoEndpointGroupRepository.js';
import { createDemoOrganizationRepository } from '../demo/demoOrganizationRepository.js';
import { createDemoPolicyRepository } from '../demo/demoPolicyRepository.js';
import PolicyDetailsView from './PolicyDetailsView.jsx';
import PolicyEditorView from './PolicyEditorView.jsx';
import PolicyListView from './PolicyListView.jsx';
import {
  destructivePrimaryButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle
} from './policyUiStyles.js';
import { createDraftFromPolicy, createPolicyDraft } from './policyEditorState.js';
import { validatePolicyDraft } from './policyValidation.js';
import { deriveDisplayName } from './policyViewModel.js';

const styles = {
  shell: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
    display: 'grid',
    gap: '0.75rem'
  },
  title: {
    margin: 0
  },
  description: {
    margin: 0,
    color: 'var(--text-secondary)'
  },
  banner: {
    border: '1px solid var(--border-color, #d7dee8)',
    borderRadius: 12,
    padding: '0.85rem 1rem',
    background: '#f5f9ff',
    color: '#38506a'
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
    width: '100%',
    maxWidth: 520,
    border: '1px solid var(--border-color, #d7dee8)',
    borderRadius: 14,
    background: '#ffffff',
    padding: '1rem',
    display: 'grid',
    gap: '0.75rem',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.12)'
  },
  dialogTitle: {
    margin: 0,
    fontSize: '1.08rem',
    color: '#16314a'
  },
  dialogText: {
    margin: 0,
    color: '#4a627d',
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

function buildPolicyRecord(draft, catalog, existingPolicyCount) {
  const scopeLabel = draft.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : draft.endpointGroupName;
  const displayName = deriveDisplayName(draft.baseName, scopeLabel);
  const policyRecord = {
    policyId: draft.policyId || `POL-${String(existingPolicyCount + 1).padStart(6, '0')}`,
    enabled: draft.enabled !== false,
    baseName: String(draft.baseName || '').trim(),
    description: String(draft.description || '').trim(),
    displayName,
    organizationId: draft.organizationId,
    organizationNameSnapshot: draft.organizationName,
    scopeType: draft.scopeType,
    endpointGroupId: draft.scopeType === 'ENDPOINT_GROUP' ? draft.endpointGroupId : null,
    endpointGroupNameSnapshot: draft.scopeType === 'ENDPOINT_GROUP' ? draft.endpointGroupName : null,
    policyMode: draft.policyMode,
    runSchedule: {
      runEveryHours: Number(draft.runSchedule.runEveryHours),
      startDate: draft.runSchedule.startDate,
      startTime: draft.runSchedule.startTime,
      timezone: draft.runSchedule.timezone
    },
    completionDeadlineMinutes: Number(draft.completionDeadlineMinutes),
    controlPackId: catalog.packId,
    controlPackVersion: catalog.packVersion,
    selectedControls: (draft.selectedControls || []).map((selectedControl) => {
      const control = catalog.controlsById[selectedControl.controlId];
      const parameters = {};

      for (const parameter of control.parameters || []) {
        const rawValue = selectedControl.parameters?.[parameter.id];
        parameters[parameter.id] = parameter.type === 'integer' ? Number(rawValue) : rawValue;
      }

      return {
        controlId: selectedControl.controlId,
        controlVersion: selectedControl.controlVersion,
        automationGroupId: selectedControl.automationGroupId,
        automationGroupVersion: selectedControl.automationGroupVersion,
        parameters
      };
    })
  };

  policyRecord.action1Automations = policyRecord.enabled ? buildAction1Automations(policyRecord, catalog) : [];
  return policyRecord;
}

function buildAction1Automations(policy, catalog) {
  const seenAutomationGroups = new Set();
  const automationRows = [];

  for (const selectedControl of policy.selectedControls || []) {
    if (seenAutomationGroups.has(selectedControl.automationGroupId)) {
      continue;
    }
    seenAutomationGroups.add(selectedControl.automationGroupId);

    const controlFamily = catalog.controlFamiliesById[selectedControl.automationGroupId];
    if (!controlFamily) {
      continue;
    }

    const automationId = `${policy.policyId}-${selectedControl.automationGroupId}`;
    automationRows.push({
      automationId,
      automationGroupId: selectedControl.automationGroupId,
      controlFamilyName: controlFamily.name,
      automationName: `A1CM \u2014 ${policy.displayName} \u2014 ${controlFamily.name}`,
      action1Url: `https://action1.example.test/automations/${encodeURIComponent(automationId)}`
    });
  }

  return automationRows;
}

function attachPolicyMetrics(policy) {
  return {
    ...policy,
    selectedFamilyCount: countSelectedControlFamilies(policy.selectedControls || []),
    expectedAutomationCount: countExpectedAutomations(policy.selectedControls || [])
  };
}

function formatLifecycleMessage(kind, policy) {
  if (kind === 'enable') {
    return `Restore the demo Action1 automations for ${policy.displayName}.`;
  }

  if (kind === 'disable') {
    return `Disable ${policy.displayName}. The Policy remains available, and its demo Action1 automations are removed.`;
  }

  return `Delete ${policy.displayName}. This removes the Policy and its demo Action1 automations.`;
}

function PolicyPage({ integration }) {
  const catalogRef = useRef(loadReleasedControlCatalog());
  const repositoriesRef = useRef({
    policyRepository: createDemoPolicyRepository(),
    organizationRepository: createDemoOrganizationRepository(),
    endpointGroupRepository: createDemoEndpointGroupRepository()
  });
  const [mode, setMode] = useState({ kind: 'list', policyId: null });
  const [draft, setDraft] = useState(null);
  const [validationResult, setValidationResult] = useState({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
  const [pendingAction, setPendingAction] = useState(null);
  const [revision, setRevision] = useState(0);

  const catalog = catalogRef.current;
  const organizations = useMemo(
    () => repositoriesRef.current.organizationRepository.listOrganizations(),
    [revision]
  );
  const endpointGroupsByOrganization = useMemo(() => {
    const lookup = {};
    for (const organization of organizations) {
      lookup[organization.organizationId] = repositoriesRef.current.endpointGroupRepository.listEndpointGroups(organization.organizationId);
    }
    return lookup;
  }, [organizations, revision]);
  const policies = useMemo(() => repositoriesRef.current.policyRepository.listPolicies().map(attachPolicyMetrics), [revision]);
  const selectedPolicy = mode.policyId ? policies.find((policy) => policy.policyId === mode.policyId) || null : null;

  function refreshPolicies() {
    setRevision((value) => value + 1);
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
  }

  function openDetails(policyId) {
    setMode({ kind: 'details', policyId });
    setDraft(null);
    setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
  }

  function openEdit(policyId) {
    const policy = repositoriesRef.current.policyRepository.getPolicy(policyId);
    if (!policy) {
      return;
    }

    setMode({ kind: 'edit', policyId });
    setDraft(createDraftFromPolicy(policy, catalog));
    setValidationResult({ fieldErrors: {}, sectionErrors: [], blockingMessage: '' });
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

    if (nextValidationResult.blockingMessage || Object.keys(nextValidationResult.fieldErrors).length > 0) {
      return false;
    }

    const policyRecord = buildPolicyRecord(nextDraft, catalog, repositoriesRef.current.policyRepository.listPolicies().length);

    if (nextDraft.mode === 'edit') {
      repositoriesRef.current.policyRepository.updatePolicy(nextDraft.policyId, policyRecord);
    } else {
      repositoriesRef.current.policyRepository.createPolicy(policyRecord);
    }

    refreshPolicies();
    returnToList();
    return true;
  }

  function togglePolicyEnabled(policyId, enabled) {
    const existingPolicy = repositoriesRef.current.policyRepository.getPolicy(policyId);
    if (!existingPolicy) {
      return;
    }

    const nextPolicy = {
      ...existingPolicy,
      enabled,
      action1Automations: enabled ? buildAction1Automations(existingPolicy, catalog) : []
    };
    repositoriesRef.current.policyRepository.updatePolicy(policyId, nextPolicy);
    refreshPolicies();
    if (mode.kind === 'details') {
      setMode({ kind: 'details', policyId });
    }
  }

  function deletePolicy(policyId) {
    repositoriesRef.current.policyRepository.deletePolicy(policyId);
    refreshPolicies();
    returnToList();
  }

  function openLifecycleConfirmation(kind, policyId) {
    setPendingAction({ kind, policyId });
  }

  function confirmPendingAction() {
    if (!pendingAction) {
      return;
    }

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

  return (
    <div style={styles.shell} data-integration={integration}>
      <h1 className="page-title" style={styles.title}>Policies</h1>
      <p style={styles.description}>
        Create and manage Windows configuration policies that assess and remediate endpoints through scheduled Action1 automations.
      </p>
      <div style={styles.banner}>Demo state resets when the Marketplace page is refreshed.</div>
      {mode.kind === 'list' ? (
        <PolicyListView
          policies={policies}
          onCreate={openCreate}
          onDelete={(policyId) => openLifecycleConfirmation('delete', policyId)}
          onDisable={(policyId) => openLifecycleConfirmation('disable', policyId)}
          onEnable={(policyId) => openLifecycleConfirmation('enable', policyId)}
          onOpen={openDetails}
          onEdit={openEdit}
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
        />
      ) : null}
      {(mode.kind === 'create' || mode.kind === 'edit') && draft ? (
        <PolicyEditorView
          catalog={catalog}
          draft={draft}
          endpointGroups={endpointGroupsByOrganization[draft.organizationId] || []}
          isEditMode={mode.kind === 'edit'}
          onCancel={mode.kind === 'edit' ? () => openDetails(draft.policyId) : returnToList}
          onChange={setDraft}
          onSave={saveDraft}
          organizations={organizations}
          validationResult={validationResult}
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
