const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function buildDraft(overrides = {}) {
  return {
    mode: 'create',
    policyId: null,
    baseName: 'Workstation Security',
    organizationId: 'org-acme',
    organizationName: 'Acme Corp',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-finance-workstations',
    endpointGroupName: 'Finance Workstations',
    policyMode: 'ASSESS_ONLY',
    runSchedule: {
      runEveryHours: 24,
      startDate: '2026-08-01',
      startTime: '09:30',
      timezone: 'America/Los_Angeles'
    },
    completionDeadlineMinutes: 1440,
    selectedControls: [],
    unsupportedParameterTypes: [],
    ...overrides
  };
}

async function buildCatalog() {
  const { loadReleasedControlCatalog } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js')).href
  );
  return loadReleasedControlCatalog();
}

async function buildRepositories() {
  const { createDemoPolicyRepository } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'demo', 'demoPolicyRepository.js')).href
  );
  return {
    policyRepository: createDemoPolicyRepository()
  };
}

function expectFieldError(result, fieldName) {
  assert.strictEqual(typeof result.fieldErrors[fieldName], 'string', `expected a field error for ${fieldName}`);
}

async function run() {
  const { validatePolicyDraft } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyValidation.js')).href
  );
  const catalog = await buildCatalog();

  expectFieldError(validatePolicyDraft(buildDraft({ baseName: '   ' }), catalog, await buildRepositories()), 'baseName');
  expectFieldError(validatePolicyDraft(buildDraft({ organizationId: '', organizationName: '' }), catalog, await buildRepositories()), 'organizationId');
  expectFieldError(validatePolicyDraft(buildDraft({ scopeType: '' }), catalog, await buildRepositories()), 'scopeType');
  expectFieldError(validatePolicyDraft(buildDraft({ endpointGroupId: '', endpointGroupName: '' }), catalog, await buildRepositories()), 'endpointGroupId');
  expectFieldError(validatePolicyDraft(buildDraft({ runSchedule: { runEveryHours: '', startDate: '2026-08-01', startTime: '09:30', timezone: 'America/Los_Angeles' } }), catalog, await buildRepositories()), 'runEveryHours');
  expectFieldError(validatePolicyDraft(buildDraft({ runSchedule: { runEveryHours: 24, startDate: '', startTime: '09:30', timezone: 'America/Los_Angeles' } }), catalog, await buildRepositories()), 'startDate');
  expectFieldError(validatePolicyDraft(buildDraft({ runSchedule: { runEveryHours: 24, startDate: '2026-08-01', startTime: '', timezone: 'America/Los_Angeles' } }), catalog, await buildRepositories()), 'startTime');
  expectFieldError(validatePolicyDraft(buildDraft({ runSchedule: { runEveryHours: 24, startDate: '2026-08-01', startTime: '09:30', timezone: '' } }), catalog, await buildRepositories()), 'timezone');
  expectFieldError(validatePolicyDraft(buildDraft({ completionDeadlineMinutes: '' }), catalog, await buildRepositories()), 'completionDeadlineMinutes');
  expectFieldError(validatePolicyDraft(buildDraft({ selectedControls: [] }), catalog, await buildRepositories()), 'selectedControls');

  const duplicateRepositories = await buildRepositories();
  duplicateRepositories.policyRepository.createPolicy({
    policyId: 'POL-000001',
    baseName: 'Workstation Security',
    displayName: 'Workstation Security \u2014 Finance Workstations',
    enabled: true,
    organizationId: 'org-acme',
    organizationNameSnapshot: 'Acme Corp',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-finance-workstations',
    endpointGroupNameSnapshot: 'Finance Workstations',
    policyMode: 'ASSESS_ONLY',
    runSchedule: {
      runEveryHours: 24,
      startDate: '2026-08-01',
      startTime: '09:30',
      timezone: 'America/Los_Angeles'
    },
    completionDeadlineMinutes: 1440,
    controlPackId: 'windows-endpoint-configuration',
    controlPackVersion: '0.1.0',
    selectedControls: []
  });
  const duplicateDisplayNameResult = validatePolicyDraft(buildDraft(), catalog, duplicateRepositories);
  assert.strictEqual(
    duplicateDisplayNameResult.fieldErrors.baseName,
    undefined,
    'validation should not reject draft save solely because another demo Policy currently has the same display name'
  );

  const booleanControl = catalog.controlsById['defender.protection.real-time'];
  const integerControl = catalog.controlsById['identity.lockout.threshold'];
  const enumControl = catalog.controlsById['defender.scan.type'];
  const stringControl = catalog.controlsById['identity.sign-in.legal-notice-caption'];
  const multilineControl = catalog.controlsById['identity.sign-in.legal-notice-text'];
  const timeControl = catalog.controlsById['defender.scan.time'];

  const invalidTypesDraft = buildDraft({
    selectedControls: [
      {
        controlId: booleanControl.controlId,
        automationGroupId: booleanControl.automationGroupId,
        parameters: { enabled: 'yes' }
      },
      {
        controlId: integerControl.controlId,
        automationGroupId: integerControl.automationGroupId,
        parameters: { failedAttempts: 0 }
      },
      {
        controlId: enumControl.controlId,
        automationGroupId: enumControl.automationGroupId,
        parameters: { scanType: 'WeeklyScan' }
      },
      {
        controlId: stringControl.controlId,
        automationGroupId: stringControl.automationGroupId,
        parameters: { caption: '' }
      },
      {
        controlId: multilineControl.controlId,
        automationGroupId: multilineControl.automationGroupId,
        parameters: { noticeText: '' }
      },
      {
        controlId: timeControl.controlId,
        automationGroupId: timeControl.automationGroupId,
        parameters: { localTime: '25:90' }
      }
    ]
  });
  const invalidTypesResult = validatePolicyDraft(invalidTypesDraft, catalog, await buildRepositories());

  expectFieldError(invalidTypesResult, `${booleanControl.controlId}.enabled`);
  expectFieldError(invalidTypesResult, `${integerControl.controlId}.failedAttempts`);
  expectFieldError(invalidTypesResult, `${enumControl.controlId}.scanType`);
  expectFieldError(invalidTypesResult, `${stringControl.controlId}.caption`);
  expectFieldError(invalidTypesResult, `${multilineControl.controlId}.noticeText`);
  expectFieldError(invalidTypesResult, `${timeControl.controlId}.localTime`);

  const unsupportedResult = validatePolicyDraft(
    buildDraft({
      selectedControls: [
        {
          controlId: booleanControl.controlId,
          automationGroupId: booleanControl.automationGroupId,
          parameters: { enabled: true }
        }
      ],
      unsupportedParameterTypes: [{ controlId: 'custom.control', parameterId: 'mystery', type: 'json' }]
    }),
    catalog,
    await buildRepositories()
  );
  assert.strictEqual(typeof unsupportedResult.blockingMessage, 'string', 'unsupported parameter types should produce a blocking message');
  assert.strictEqual(
    invalidTypesResult.sectionErrors.includes('Resolve the highlighted Policy fields before saving.'),
    true,
    'validation should still surface a shared section-level save blocker when field errors exist'
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
