import { countExpectedAutomations, countSelectedControlFamilies, findBaselineById } from '../catalog/controlPackCatalog.js';
import { getVisibleWizardControls } from './policyEditorState.js';
import { buildCompactControlFamilyGroups, formatParameterValue, formatPolicyMode } from './policyViewModel.js';

const EM_DASH = '\u2014';

function getSelectedControlMap(draft) {
  return new Map((draft.selectedControls || []).map((entry) => [entry.controlId, entry]));
}

function buildControlTags(catalog, controlId) {
  return (catalog.baselineMembershipByControlId?.[controlId] || []).map((entry) => entry.tag).filter(Boolean);
}

function buildControlEntry({ catalog, selectedControlMap, control }) {
  const selectedControl = selectedControlMap.get(control.controlId) || null;

  return {
    controlId: control.controlId,
    controlName: control.name,
    controlDescription: control.description,
    selected: Boolean(selectedControl),
    tags: buildControlTags(catalog, control.controlId),
    parameters: (control.parameters || []).map((parameter) => ({
      ...parameter,
      value: selectedControl?.parameters?.[parameter.id]
    }))
  };
}

function shouldAutoExpandTree(wizardState) {
  return Boolean(
    String(wizardState?.searchTerm || '').trim() ||
      wizardState?.inBaselineOnly
  );
}

function groupVisibleEntries(catalog, draft, wizardState) {
  const selectedControlMap = getSelectedControlMap(draft);
  const categoriesById = new Map();
  const visibleEntries = getVisibleWizardControls(catalog, draft, wizardState);

  for (const entry of visibleEntries) {
    if (!categoriesById.has(entry.category.familyId)) {
      categoriesById.set(entry.category.familyId, {
        categoryId: entry.category.familyId,
        categoryName: entry.category.name,
        families: new Map()
      });
    }

    const categoryEntry = categoriesById.get(entry.category.familyId);
    if (!categoryEntry.families.has(entry.controlFamily.automationGroupId)) {
      categoryEntry.families.set(entry.controlFamily.automationGroupId, {
        automationGroupId: entry.controlFamily.automationGroupId,
        familyName: entry.controlFamily.name,
        categoryId: entry.category.familyId,
        categoryName: entry.category.name,
        controls: []
      });
    }

    categoryEntry.families.get(entry.controlFamily.automationGroupId).controls.push(
      buildControlEntry({
        catalog,
        selectedControlMap,
        control: entry.control
      })
    );
  }

  return {
    selectedControlMap,
    categories: Array.from(categoriesById.values()).map((categoryEntry) => {
      const families = Array.from(categoryEntry.families.values()).map((family) => ({
        ...family,
        selectedCount: family.controls.filter((control) => control.selected).length,
        availableCount: family.controls.length
      }));

      return {
        categoryId: categoryEntry.categoryId,
        categoryName: categoryEntry.categoryName,
        families,
        selectedCount: families.reduce((sum, family) => sum + family.selectedCount, 0),
        availableCount: families.reduce((sum, family) => sum + family.availableCount, 0)
      };
    })
  };
}

function buildSelectedGroups(categories) {
  return categories
    .flatMap((category) =>
      category.families
        .map((family) => ({
          automationGroupId: family.automationGroupId,
          familyName: family.familyName,
          categoryName: category.categoryName,
          selectedCount: family.selectedCount,
          controls: family.controls.filter((control) => control.selected)
        }))
        .filter((family) => family.controls.length > 0)
    );
}

export function getInitialOpenCategories(catalog) {
  return (catalog?.families || []).reduce((state, category) => {
    state[category.familyId] = false;
    return state;
  }, {});
}

export function buildControlsTreeViewModel({ catalog, draft, wizardState, openControlFamilies }) {
  const grouped = groupVisibleEntries(catalog, draft, wizardState);
  const autoExpandTree = shouldAutoExpandTree(wizardState);

  const categories = grouped.categories.map((category) => ({
    ...category,
    isExpanded: autoExpandTree || Boolean(wizardState?.openCategories?.[category.categoryId]),
    families: category.families.map((family) => ({
      ...family
    }))
  }));

  const visibleFamilies = categories.flatMap((category) => category.families);
  const activeControlFamilyId = visibleFamilies.some(
    (family) => family.automationGroupId === wizardState?.activeControlFamilyId
  )
    ? wizardState.activeControlFamilyId
    : '';

  const activeFamily = visibleFamilies.find((family) => family.automationGroupId === activeControlFamilyId) || null;
  const selectedGroups = buildSelectedGroups(categories);

  return {
    categories,
    totalVisibleControls: categories.reduce((sum, category) => sum + category.availableCount, 0),
    totalSelectedControls: selectedGroups.reduce((sum, group) => sum + group.controls.length, 0),
    detailMode: wizardState?.selectedOnly ? 'selectedOnly' : 'family',
    activeControlFamilyId,
    activeFamily,
    selectedGroups,
    selectedBaseline: findBaselineById(catalog.baselines, wizardState?.selectedBaselineId || ''),
    appliedBaseline: findBaselineById(catalog.baselines, wizardState?.appliedBaselineId || '')
  };
}

export function buildReviewViewModel({ catalog, draft, displayName, appliedBaselineId }) {
  const appliedBaseline = findBaselineById(catalog.baselines, appliedBaselineId);
  let manualSelectionsCount = 0;

  for (const selectedControl of draft.selectedControls || []) {
    if (
      appliedBaseline &&
      !(catalog.baselineMembershipByControlId?.[selectedControl.controlId] || []).some(
        (entry) => entry.baselineId === appliedBaseline.id
      )
    ) {
      manualSelectionsCount += 1;
    }
  }

  return {
    editLinks: [
      { label: 'Edit', step: 1 },
      { label: 'Edit', step: 2 },
      { label: 'Edit', step: 3 }
    ],
    summaryRows: [
      { label: 'Policy', value: displayName || 'Unnamed Policy', step: 1, emphasized: true },
      { label: 'Organization', value: draft.organizationName || 'Not selected', step: null },
      {
        label: 'Target',
        value: draft.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : draft.endpointGroupName || 'Not selected',
        step: null
      },
      { label: 'Mode', value: formatPolicyMode(draft.policyMode), step: 2 },
      { label: 'Run schedule', value: `Every ${draft.runSchedule.runEveryHours} hour(s)`, step: null },
      {
        label: 'Baseline',
        value: appliedBaseline
          ? `${appliedBaseline.name}${manualSelectionsCount > 0 ? ' + manual selections' : ''}`
          : `None ${EM_DASH} manual selection`,
        step: null
      },
      {
        label: 'Controls',
        value: `${draft.selectedControls.length} selected Controls`,
        step: 3
      },
      {
        label: 'Control Families',
        value: `${countSelectedControlFamilies(draft.selectedControls || [])} Control Families`,
        step: null
      },
      {
        label: 'Action1 automations',
        value: `${countExpectedAutomations(draft.selectedControls || [])} Action1 automations will be created`,
        step: null
      }
    ],
    controlFamilyGroups: buildCompactControlFamilyGroups({
      selectedControls: draft.selectedControls || [],
      catalog
    })
  };
}
