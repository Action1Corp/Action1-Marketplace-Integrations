const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function buildCatalog() {
  const { loadReleasedControlCatalog } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js')).href
  );
  return loadReleasedControlCatalog();
}

async function run() {
  const {
    createPolicyDraft,
    createDraftFromPolicy,
    applyControlSelection,
    updateControlParameter,
    updateRunEveryHours,
    updateCompletionDeadline,
    getInitialOpenControlFamilies
  } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyEditorState.js')).href);
  const { deriveDisplayName } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyViewModel.js')).href
  );
  const catalog = await buildCatalog();

  const createDraft = createPolicyDraft({
    currentDate: '2026-08-01',
    currentTime: '09:30',
    timezone: 'America/Los_Angeles'
  });

  assert.strictEqual(createDraft.mode, 'create', 'createPolicyDraft should initialize create mode');
  assert.strictEqual(createDraft.policyMode, 'ASSESS_ONLY', 'createPolicyDraft should default to Assess only');
  assert.strictEqual(createDraft.runSchedule.runEveryHours, 24, 'createPolicyDraft should default Run every to 24 hours');
  assert.strictEqual(createDraft.runSchedule.startDate, '2026-08-01', 'createPolicyDraft should use the provided current date');
  assert.strictEqual(createDraft.runSchedule.startTime, '09:30', 'createPolicyDraft should use the provided current time');
  assert.strictEqual(createDraft.runSchedule.timezone, 'America/Los_Angeles', 'createPolicyDraft should keep the current Marketplace timezone');
  assert.strictEqual(createDraft.completionDeadlineMinutes, 1440, 'createPolicyDraft should initialize the completion deadline from Run every × 60');

  const resyncedDraft = updateRunEveryHours(createDraft, 6);
  assert.strictEqual(resyncedDraft.runSchedule.runEveryHours, 6, 'changing Run every should update the run interval');
  assert.strictEqual(resyncedDraft.completionDeadlineMinutes, 360, 'changing Run every should automatically resynchronize the completion deadline');

  const manuallyEditedDeadlineDraft = updateCompletionDeadline(resyncedDraft, 420);
  assert.strictEqual(
    manuallyEditedDeadlineDraft.completionDeadlineMinutes,
    420,
    'manually editing the completion deadline should preserve the operator override'
  );

  const resyncedAfterManualEditDraft = updateRunEveryHours(manuallyEditedDeadlineDraft, 12);
  assert.strictEqual(
    resyncedAfterManualEditDraft.completionDeadlineMinutes,
    720,
    'changing Run every after a manual deadline edit should re-synchronize the deadline from the new interval'
  );

  assert.strictEqual(
    deriveDisplayName('Workstation Security', 'Finance Workstations'),
    'Workstation Security \u2014 Finance Workstations',
    'deriveDisplayName should append the scope name with an em dash'
  );

  const control = catalog.controlsById['identity.password.minimum-length'];
  const selectedDraft = applyControlSelection(createDraft, control, true, catalog);
  assert.strictEqual(selectedDraft.selectedControls.length, 1, 'selecting a control should add it to the draft');
  assert.deepStrictEqual(
    selectedDraft.selectedControls[0].parameters,
    { minimumLength: 14 },
    'selecting a control should inject default catalog parameters'
  );

  const updatedDraft = updateControlParameter(selectedDraft, control.controlId, 'minimumLength', 20);
  assert.strictEqual(
    updatedDraft.selectedControls[0].parameters.minimumLength,
    20,
    'updating a control parameter should persist the edited value'
  );

  const deselectedDraft = applyControlSelection(updatedDraft, control, false, catalog);
  assert.strictEqual(deselectedDraft.selectedControls.length, 0, 'deselecting a control should remove it from the draft');

  const initialOpenFamilies = getInitialOpenControlFamilies(createDraft, catalog);
  assert.strictEqual(
    initialOpenFamilies['identity.password-policy'],
    false,
    'Control Families should start collapsed on initial create'
  );

  const existingPolicy = {
    policyId: 'POL-000001',
    baseName: 'Workstation Security',
    displayName: 'Workstation Security \u2014 Finance Workstations',
    enabled: true,
    organizationId: 'org-acme',
    organizationNameSnapshot: 'Acme Corp',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-finance-workstations',
    endpointGroupNameSnapshot: 'Finance Workstations',
    policyMode: 'ASSESS_AND_REMEDIATE',
    runSchedule: {
      runEveryHours: 6,
      startDate: '2026-08-01',
      startTime: '09:30',
      timezone: 'America/Los_Angeles'
    },
    completionDeadlineMinutes: 360,
    controlPackId: 'windows-endpoint-configuration',
    controlPackVersion: '0.1.0',
    selectedControls: [
      {
        controlId: control.controlId,
        controlVersion: control.version,
        automationGroupId: control.automationGroupId,
        automationGroupVersion: catalog.controlFamiliesById[control.automationGroupId].version,
        parameters: { minimumLength: 14 }
      }
    ],
    action1Automations: []
  };

  const editDraft = createDraftFromPolicy(existingPolicy, catalog);
  assert.strictEqual(editDraft.mode, 'edit', 'createDraftFromPolicy should initialize edit mode');
  assert.strictEqual(editDraft.organizationId, 'org-acme', 'edit draft should keep the saved organization');
  assert.strictEqual(editDraft.endpointGroupId, 'group-finance-workstations', 'edit draft should keep the saved scope');
  assert.strictEqual(editDraft.organizationLocked, true, 'organization should be immutable in edit mode');
  assert.strictEqual(editDraft.scopeLocked, true, 'scope should be immutable in edit mode');

  const editOpenFamilies = getInitialOpenControlFamilies(editDraft, catalog);
  assert.strictEqual(
    editOpenFamilies['identity.password-policy'],
    true,
    'selected Control Families should start expanded when reopening an existing Policy'
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
