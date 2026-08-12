const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function buildCatalog() {
  const { loadReleasedControlCatalog } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js')).href
  );
  return loadReleasedControlCatalog();
}

async function buildStateModule() {
  return import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyEditorState.js')).href);
}

async function run() {
  const catalog = await buildCatalog();
  const {
    createPolicyDraft,
    applyControlSelection,
    applyBaselineSelection,
    clearAllSelectedControls
  } = await buildStateModule();
  const {
    getInitialOpenCategories,
    buildControlsTreeViewModel,
    buildReviewViewModel
  } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyWizardViewModel.js')).href);

  const createDraft = createPolicyDraft({
    currentDate: '2026-08-01',
    currentTime: '09:30',
    timezone: 'America/Los_Angeles'
  });

  const initialOpenCategories = getInitialOpenCategories(catalog);
  assert.strictEqual(
    initialOpenCategories['identity-and-sign-in'],
    false,
    'wizard categories should start collapsed before search or filtering expands them'
  );

  const treeModel = buildControlsTreeViewModel({
    catalog,
    draft: createDraft,
    wizardState: {
      selectedBaselineId: '',
      appliedBaselineId: '',
      selectedOnly: false,
      inBaselineOnly: false,
      searchTerm: '',
      activeControlFamilyId: '',
      openCategories: initialOpenCategories
    },
    openControlFamilies: {}
  });

  assert.strictEqual(treeModel.categories.length > 0, true, 'tree view-model should expose visible categories');
  assert.strictEqual(
    treeModel.categories.find((category) => category.categoryId === 'identity-and-sign-in').isExpanded,
    false,
    'tree view-model should preserve collapsed categories on initial load'
  );
  assert.strictEqual(
    treeModel.activeFamily,
    null,
    'tree view-model should keep the detail pane empty until the operator explicitly selects a Control Family'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(treeModel.categories[0].families[0], 'isExpanded'),
    false,
    'tree view-model should not treat Control Families as collapsible tree nodes'
  );

  const expandedSearchModel = buildControlsTreeViewModel({
    catalog,
    draft: createDraft,
    wizardState: {
      selectedBaselineId: '',
      appliedBaselineId: '',
      selectedOnly: false,
      inBaselineOnly: false,
      searchTerm: 'password',
      activeControlFamilyId: '',
      openCategories: initialOpenCategories
    },
    openControlFamilies: {}
  });

  const identityCategory = expandedSearchModel.categories.find((category) => category.categoryId === 'identity-and-sign-in');
  assert(identityCategory, 'search should retain matching categories in the tree');
  assert.strictEqual(
    identityCategory.isExpanded,
    true,
    'search should auto-expand matching categories so the operator can navigate the results'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(identityCategory.families[0], 'isExpanded'),
    false,
    'search should expand the matching Category without introducing per-family expansion state'
  );

  const manualControl = catalog.controlsById['identity.sign-in.require-secure-attention'];
  const baselineControl = catalog.controlsById['identity.password.minimum-length'];
  const manuallySelectedDraft = applyControlSelection(createDraft, manualControl, true, catalog);
  const mixedDraft = applyBaselineSelection(manuallySelectedDraft, catalog, catalog.baselines, 'microsoft-windows-11-25h2');

  const selectedOnlyModel = buildControlsTreeViewModel({
    catalog,
    draft: mixedDraft,
    wizardState: {
      selectedBaselineId: 'microsoft-windows-11-25h2',
      appliedBaselineId: 'microsoft-windows-11-25h2',
      selectedOnly: true,
      inBaselineOnly: false,
      searchTerm: '',
      activeControlFamilyId: '',
      openCategories: getInitialOpenCategories(catalog)
    },
    openControlFamilies: {}
  });

  assert.strictEqual(
    selectedOnlyModel.detailMode,
    'selectedOnly',
    'Selected only should switch the detail pane into the aggregate selected-controls lens'
  );
  assert(
    selectedOnlyModel.selectedGroups.some((group) =>
      group.controls.some((control) => control.controlId === manualControl.controlId)
    ),
    'Selected only should still include manual controls that are outside the applied baseline'
  );
  assert(
    selectedOnlyModel.selectedGroups.some((group) =>
      group.controls.some((control) => control.controlId === baselineControl.controlId)
    ),
    'Selected only should include controls that were added through the applied baseline'
  );

  const clearedDraft = clearAllSelectedControls(mixedDraft);
  assert.deepStrictEqual(
    clearedDraft.selectedControls,
    [],
    'Clear all should remove every selected Control without mutating unrelated draft fields'
  );

  const reviewModel = buildReviewViewModel({
    catalog,
    draft: mixedDraft,
    displayName: 'Workstation Security \u2014 Finance Workstations',
    appliedBaselineId: 'microsoft-windows-11-25h2'
  });

  assert.deepStrictEqual(
    reviewModel.editLinks,
    [
      { label: 'Edit', step: 1 },
      { label: 'Edit', step: 2 },
      { label: 'Edit', step: 3 }
    ],
    'review view-model should expose step-specific Edit links for the wizard summary rows'
  );
  assert(
    reviewModel.controlFamilyGroups.every((group) => typeof group.selectedCount === 'number' && group.selectedCount > 0),
    'review view-model should expose compact family counts for the selected Controls summary'
  );
  assert(
    reviewModel.controlFamilyGroups.some((group) =>
      group.controls.some((control) => Array.isArray(control.chips))
    ),
    'review view-model should expose compact review chips instead of only long-form rows'
  );
}

try {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
