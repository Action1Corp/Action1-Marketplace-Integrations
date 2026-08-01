import { buildDefaultParameters } from '../catalog/controlPackCatalog.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePositiveInteger(value, fallbackValue) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallbackValue;
  }
  return Math.trunc(normalized);
}

function deriveCompletionDeadlineMinutes(runEveryHours) {
  return normalizePositiveInteger(runEveryHours, 24) * 60;
}

export function createPolicyDraft(input = {}) {
  const runEveryHours = 24;

  return {
    mode: 'create',
    policyId: null,
    enabled: true,
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
      runEveryHours,
      startDate: input.currentDate || '',
      startTime: input.currentTime || '',
      timezone: input.timezone || ''
    },
    completionDeadlineMinutes: deriveCompletionDeadlineMinutes(runEveryHours),
    selectedControls: [],
    unsupportedParameterTypes: []
  };
}

export function createDraftFromPolicy(policy) {
  return {
    mode: 'edit',
    policyId: policy.policyId,
    enabled: policy.enabled !== false,
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

export function updateRunEveryHours(draft, value) {
  const nextRunEveryHours = normalizePositiveInteger(value, 24);

  return {
    ...clone(draft),
    runSchedule: {
      ...clone(draft.runSchedule),
      runEveryHours: nextRunEveryHours
    },
    completionDeadlineMinutes: deriveCompletionDeadlineMinutes(nextRunEveryHours)
  };
}

export function updateCompletionDeadline(draft, value) {
  return {
    ...clone(draft),
    completionDeadlineMinutes: normalizePositiveInteger(value, deriveCompletionDeadlineMinutes(draft.runSchedule?.runEveryHours))
  };
}

export function getInitialOpenControlFamilies(draft, catalog) {
  const nextState = {};
  const selectedAutomationGroupIds = new Set((draft.selectedControls || []).map((entry) => entry.automationGroupId));

  for (const controlFamily of catalog.controlFamilies || []) {
    nextState[controlFamily.automationGroupId] = selectedAutomationGroupIds.has(controlFamily.automationGroupId);
  }

  return nextState;
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
