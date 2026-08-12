import { buildDefaultParameters, findBaselineById, getRecommendedParametersForBaselineControl } from '../catalog/controlPackCatalog.js';

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

export function createWizardState() {
  return {
    currentStep: 1,
    selectedBaselineId: '',
    appliedBaselineId: '',
    selectedOnly: false,
    inBaselineOnly: false,
    searchTerm: '',
    activeControlFamilyId: ''
  };
}

export function createInitialWizardState({ isEditMode = false } = {}) {
  return {
    ...createWizardState(),
    selectedOnly: Boolean(isEditMode)
  };
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

function createSelectedControlEntry(control, catalog, parameters) {
  const controlFamily = catalog.controlFamiliesById[control.automationGroupId] || {};

  return {
    controlId: control.controlId,
    controlVersion: control.version,
    automationGroupId: control.automationGroupId,
    automationGroupVersion: controlFamily.version || '',
    parameters
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

  nextDraft.selectedControls.push(createSelectedControlEntry(control, catalog, buildDefaultParameters(control)));
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

export function applyBaselineSelection(draft, catalog, baselines, baselineId) {
  const baseline = findBaselineById(baselines, baselineId);
  const nextDraft = clone(draft);

  if (!baseline) {
    return nextDraft;
  }

  for (const baselineControl of baseline.controls || []) {
    const control = catalog.controlsById?.[baselineControl.controlId];
    if (!control) {
      continue;
    }

    const recommendedParameters = getRecommendedParametersForBaselineControl(baselines, baselineId, control.controlId);
    const existingIndex = nextDraft.selectedControls.findIndex((entry) => entry.controlId === control.controlId);

    if (existingIndex === -1) {
      nextDraft.selectedControls.push(
        createSelectedControlEntry(control, catalog, recommendedParameters || buildDefaultParameters(control))
      );
      continue;
    }

    if (recommendedParameters) {
      nextDraft.selectedControls[existingIndex].parameters = recommendedParameters;
    }
  }

  return nextDraft;
}

export function clearAllSelectedControls(draft) {
  return {
    ...clone(draft),
    selectedControls: []
  };
}

export function getVisibleWizardControls(catalog, draft, wizardState) {
  const normalizedSearchTerm = String(wizardState?.searchTerm || '').trim().toLowerCase();
  const selectedControlIds = new Set((draft.selectedControls || []).map((entry) => entry.controlId));
  const baselineId = wizardState?.selectedBaselineId || '';
  const baselineMembershipLookup = catalog?.baselineMembershipByControlId || {};
  const visibleControls = [];

  for (const category of catalog?.families || []) {
    for (const controlFamily of catalog?.controlFamilies || []) {
      if (controlFamily.familyId !== category.familyId) {
        continue;
      }

      for (const control of catalog?.controls || []) {
        if (control.automationGroupId !== controlFamily.automationGroupId) {
          continue;
        }

        if (wizardState?.selectedOnly && !selectedControlIds.has(control.controlId)) {
          continue;
        }

        if (
          wizardState?.inBaselineOnly &&
          !((baselineMembershipLookup[control.controlId] || []).some((entry) => entry.baselineId === baselineId))
        ) {
          continue;
        }

        if (normalizedSearchTerm) {
          const haystack = [
            category.name,
            controlFamily.name,
            control.name,
            control.description
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!haystack.includes(normalizedSearchTerm)) {
            continue;
          }
        }

        visibleControls.push({
          category,
          controlFamily,
          control
        });
      }
    }
  }

  return visibleControls;
}
