import { buildDefaultParameters } from '../catalog/controlPackCatalog.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createPolicyDraft(input = {}) {
  return {
    mode: 'create',
    policyId: null,
    baseName: '',
    description: '',
    organizationId: '',
    organizationName: '',
    organizationLocked: false,
    scopeType: 'ALL_ENDPOINTS',
    endpointGroupId: '',
    endpointGroupName: '',
    scopeLocked: false,
    policyMode: 'ASSESS_ONLY',
    runSchedule: {
      runEveryHours: 24,
      startDate: input.currentDate || '',
      startTime: input.currentTime || '',
      timezone: input.timezone || ''
    },
    completionDeadlineMinutes: 360,
    selectedControls: [],
    unsupportedParameterTypes: []
  };
}

export function createDraftFromPolicy(policy) {
  return {
    mode: 'edit',
    policyId: policy.policyId,
    baseName: policy.baseName,
    description: policy.description || '',
    organizationId: policy.organizationId,
    organizationName: policy.organizationNameSnapshot,
    organizationLocked: true,
    scopeType: policy.scopeType,
    endpointGroupId: policy.endpointGroupId || '',
    endpointGroupName: policy.endpointGroupNameSnapshot || '',
    scopeLocked: true,
    policyMode: policy.policyMode,
    runSchedule: clone(policy.runSchedule),
    completionDeadlineMinutes: policy.completionDeadlineMinutes,
    selectedControls: clone(policy.selectedControls || []),
    unsupportedParameterTypes: []
  };
}

export function applyControlSelection(draft, control, selected, catalog) {
  const nextDraft = clone(draft);
  const existingIndex = nextDraft.selectedControls.findIndex((entry) => entry.controlId === control.controlId);

  if (!selected) {
    if (existingIndex !== -1) {
      nextDraft.selectedControls.splice(existingIndex, 1);
    }
    return nextDraft;
  }

  if (existingIndex !== -1) {
    return nextDraft;
  }

  const controlFamily = catalog.controlFamiliesById[control.automationGroupId] || {};
  nextDraft.selectedControls.push({
    controlId: control.controlId,
    controlVersion: control.version,
    automationGroupId: control.automationGroupId,
    automationGroupVersion: controlFamily.version || '',
    parameters: buildDefaultParameters(control)
  });
  return nextDraft;
}

export function updateControlParameter(draft, controlId, parameterId, value) {
  const nextDraft = clone(draft);
  const selectedControl = nextDraft.selectedControls.find((entry) => entry.controlId === controlId);

  if (!selectedControl) {
    return nextDraft;
  }

  selectedControl.parameters = selectedControl.parameters || {};
  selectedControl.parameters[parameterId] = value;
  return nextDraft;
}
