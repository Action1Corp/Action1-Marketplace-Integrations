import { useMemo, useRef, useState } from 'react';
import { loadReleasedControlCatalog, countSelectedControlFamilies, countExpectedAutomations } from '../catalog/controlPackCatalog.js';
import { createDemoPolicyRepository } from '../demo/demoPolicyRepository.js';
import { createDemoOrganizationRepository } from '../demo/demoOrganizationRepository.js';
import { createDemoEndpointGroupRepository } from '../demo/demoEndpointGroupRepository.js';
import { createPolicyDraft, createDraftFromPolicy } from './policyEditorState.js';
import { validatePolicyDraft } from './policyValidation.js';
import { deriveDisplayName } from './policyViewModel.js';
import PolicyListView from './PolicyListView.jsx';
import PolicyEditorView from './PolicyEditorView.jsx';
import PolicyDetailsView from './PolicyDetailsView.jsx';

const styles = {
  shell: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
    display: 'grid',
    gap: '0.5rem'
  },
  title: {
    margin: 0
  },
  description: {
    margin: 0,
    color: 'var(--text-secondary)'
  },
  banner: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
    borderRadius: 12,
    padding: '0.85rem 1rem',
    background: 'rgba(90, 148, 255, 0.08)',
    color: 'var(--text-secondary)'
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

  return {
    policyId: draft.policyId || `POL-${String(existingPolicyCount + 1).padStart(6, '0')}`,
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
}

function attachPolicyMetrics(policy) {
  return {
    ...policy,
    selectedFamilyCount: countSelectedControlFamilies(policy.selectedControls || []),
    expectedAutomationCount: countExpectedAutomations(policy.selectedControls || [])
  };
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
  const policies = useMemo(() => {
    return repositoriesRef.current.policyRepository.listPolicies().map(attachPolicyMetrics);
  }, [revision]);
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

  function cancelEditor() {
    setMode({ kind: 'list', policyId: null });
    setDraft(null);
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
    setMode({ kind: 'list', policyId: null });
    setDraft(null);
    return true;
  }

  return (
    <div style={styles.shell} data-integration={integration}>
      <h1 className="page-title" style={styles.title}>Policies</h1>
      <p style={styles.description}>
        Create and review Action1 configuration Policies using the released Windows Endpoint Configuration Control Pack.
      </p>
      <div style={styles.banner}>Demo state resets when the Marketplace page is refreshed.</div>
      {mode.kind === 'list' ? (
        <PolicyListView policies={policies} onCreate={openCreate} onOpen={openDetails} onEdit={openEdit} />
      ) : null}
      {mode.kind === 'details' && selectedPolicy ? (
        <PolicyDetailsView policy={selectedPolicy} onBack={cancelEditor} onEdit={() => openEdit(selectedPolicy.policyId)} />
      ) : null}
      {(mode.kind === 'create' || mode.kind === 'edit') && draft ? (
        <PolicyEditorView
          catalog={catalog}
          draft={draft}
          endpointGroups={endpointGroupsByOrganization[draft.organizationId] || []}
          isEditMode={mode.kind === 'edit'}
          onCancel={cancelEditor}
          onChange={setDraft}
          onSave={saveDraft}
          organizations={organizations}
          validationResult={validationResult}
        />
      ) : null}
    </div>
  );
}

export default PolicyPage;
