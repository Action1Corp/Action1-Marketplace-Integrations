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
    updateControlParameter
  } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyEditorState.js')).href);
  const { deriveDisplayName } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyViewModel.js')).href
  );
  const catalog = await buildCatalog();

  const createDraft = createPolicyDraft({
    currentDate: '2026-07-31',
    currentTime: '09:30',
    timezone: 'America/Los_Angeles'
  });

  assert.strictEqual(createDraft.mode, 'create', 'createPolicyDraft should initialize create mode');
  assert.strictEqual(createDraft.policyMode, 'ASSESS_ONLY', 'createPolicyDraft should default to Assess only');
  assert.strictEqual(createDraft.runSchedule.runEveryHours, 24, 'createPolicyDraft should default Run every to 24 hours');
  assert.strictEqual(createDraft.runSchedule.startDate, '2026-07-31', 'createPolicyDraft should use the provided current date');
  assert.strictEqual(createDraft.runSchedule.startTime, '09:30', 'createPolicyDraft should use the provided current time');
  assert.strictEqual(createDraft.runSchedule.timezone, 'America/Los_Angeles', 'createPolicyDraft should keep the current Marketplace timezone');
  assert.strictEqual(createDraft.completionDeadlineMinutes, 360, 'createPolicyDraft should initialize the approved completion deadline default');

  assert.strictEqual(
    deriveDisplayName('Workstation Security', 'Finance Workstations'),
    'Workstation Security — Finance Workstations',
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

  const existingPolicy = {
    policyId: 'POL-000001',
    baseName: 'Workstation Security',
    displayName: 'Workstation Security — Finance Workstations',
    organizationId: 'org-acme',
    organizationNameSnapshot: 'Acme Corp',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-finance-workstations',
    endpointGroupNameSnapshot: 'Finance Workstations',
    policyMode: 'ASSESS_AND_REMEDIATE',
    runSchedule: {
      runEveryHours: 6,
      startDate: '2026-07-31',
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
    ]
  };

  const editDraft = createDraftFromPolicy(existingPolicy, catalog);
  assert.strictEqual(editDraft.mode, 'edit', 'createDraftFromPolicy should initialize edit mode');
  assert.strictEqual(editDraft.organizationId, 'org-acme', 'edit draft should keep the saved organization');
  assert.strictEqual(editDraft.endpointGroupId, 'group-finance-workstations', 'edit draft should keep the saved scope');
  assert.strictEqual(editDraft.organizationLocked, true, 'organization should be immutable in edit mode');
  assert.strictEqual(editDraft.scopeLocked, true, 'scope should be immutable in edit mode');
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
