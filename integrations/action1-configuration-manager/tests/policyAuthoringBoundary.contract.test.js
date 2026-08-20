const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const { loadPolicyCatalogContract, validateBaselineRecommendation } = require(path.join(__dirname, '..', 'policyCatalogContract.js'));
const { normalizeAndValidatePolicyInput } = require(path.join(__dirname, '..', 'policyStore.js'));
const { savePolicyAction } = require(path.join(__dirname, '..', 'policyActions.js'));

function validInput(overrides = {}) {
  return {
    mode: 'create', enabled: true, baseName: 'Boundary', organizationId: 'org-boundary', organizationName: 'Boundary Org',
    scopeType: 'ENDPOINT_GROUP', endpointGroupId: 'group-boundary', endpointGroupName: 'Boundary Group',
    policyMode: 'ASSESS_ONLY', runSchedule: { runEveryHours: 24, startDate: '2026-08-13', startTime: '09:30', timezone: 'America/Los_Angeles' },
    completionDeadlineMinutes: 1440, selectedControls: [{
      controlId: 'identity.password.minimum-length', controlVersion: '0.1.0', automationGroupId: 'identity.password-policy',
      automationGroupVersion: '0.1.0', parameters: { minimumLength: 14 }
    }], ...overrides
  };
}

function selectionFor(control, parameters) {
  const family = control.automationGroupId;
  return {
    controlId: control.controlId,
    controlVersion: control.version,
    automationGroupId: family,
    automationGroupVersion: control._familyVersion || '0.1.0',
    parameters
  };
}

function createNoMutationContext() {
  const calls = [];
  return {
    calls,
    db: { run: async (...args) => { calls.push(args); throw new Error('database should not be reached'); } },
    logger: { info() {}, warn() {}, error() {} }
  };
}

async function run() {
  const catalog = loadPolicyCatalogContract();
  const minimumLength = catalog.controlsById['identity.password.minimum-length'];

  const normalized = normalizeAndValidatePolicyInput(validInput(), catalog);
  assert.deepStrictEqual(normalized.selectedControls[0].parameters, { minimumLength: 14 });

  const controls = Object.values(catalog.controlsById);
  const enumControl = controls.find((control) => (control.parameters || []).some((parameter) => parameter.type === 'enum'));
  const stringControl = controls.find((control) => (control.parameters || []).some((parameter) => parameter.type === 'string'));
  const timeControl = controls.find((control) => (control.parameters || []).some((parameter) => parameter.type === 'time'));
  const enumParameter = enumControl.parameters.find((parameter) => parameter.type === 'enum');
  const stringParameter = stringControl.parameters.find((parameter) => parameter.type === 'string');
  const timeParameter = timeControl.parameters.find((parameter) => parameter.type === 'time');
  const familyVersion = (control) => catalog.controlFamiliesById[control.automationGroupId].version;
  assert.throws(() => normalizeAndValidatePolicyInput(validInput({ selectedControls: [{ ...selectionFor(enumControl, { [enumParameter.id]: 'not-released' }), automationGroupVersion: familyVersion(enumControl) }] }), catalog), /enum|released/i);
  assert.throws(() => normalizeAndValidatePolicyInput(validInput({ selectedControls: [{ ...selectionFor(stringControl, { [stringParameter.id]: 'x'.repeat((stringParameter.maximumLength || 1) + 1) }), automationGroupVersion: familyVersion(stringControl) }] }), catalog), /short|long|length/i);
  assert.throws(() => normalizeAndValidatePolicyInput(validInput({ selectedControls: [{ ...selectionFor(timeControl, { [timeParameter.id]: '25:90' }), automationGroupVersion: familyVersion(timeControl) }] }), catalog), /HH:mm|time/i);

  for (const invalid of [
    { parameters: { minimumLength: 15 } },
    { parameters: { minimumLength: 13.5 } },
    { parameters: { minimumLength: 14, unexpected: true } }
  ]) {
    assert.throws(() => normalizeAndValidatePolicyInput(validInput({ selectedControls: [{ ...validInput().selectedControls[0], ...invalid }] }), catalog));
  }

  const steppedCatalog = {
    ...catalog,
    controlsById: {
      ...catalog.controlsById,
      [minimumLength.controlId]: {
        ...minimumLength,
        parameters: [{ ...minimumLength.parameters[0], minimum: 0, maximum: 20, step: 2 }]
      }
    }
  };
  assert.throws(
    () => normalizeAndValidatePolicyInput(validInput({ selectedControls: [{ ...validInput().selectedControls[0], parameters: { minimumLength: 13 } }] }), steppedCatalog),
    /step/i
  );

  const materialized = normalizeAndValidatePolicyInput(
    validInput({ selectedControls: [{ ...validInput().selectedControls[0], parameters: {} }] }),
    catalog
  );
  assert.deepStrictEqual(materialized.selectedControls[0].parameters, { minimumLength: 14 });

  const missingDefaultCatalog = {
    ...catalog,
    controlsById: {
      ...catalog.controlsById,
      [minimumLength.controlId]: {
        ...minimumLength,
        parameters: [{ ...minimumLength.parameters[0], defaultValue: undefined }]
      }
    }
  };
  assert.throws(
    () => normalizeAndValidatePolicyInput(validInput({ selectedControls: [{ ...validInput().selectedControls[0], parameters: {} }] }), missingDefaultCatalog),
    /required|effective/i
  );

  const baseline = catalog.baselines[0];
  const recommendation = baseline.controls.find((entry) => entry.controlId === minimumLength.controlId);
  assert.deepStrictEqual(
    validateBaselineRecommendation(catalog, baseline.id, minimumLength.controlId, recommendation.parameters),
    { minimumLength: 14 },
    'valid released baseline recommendations should normalize through the catalog contract'
  );
  assert.throws(
    () => validateBaselineRecommendation(catalog, baseline.id, minimumLength.controlId, { minimumLength: 999 }),
    /Control Pack contract error/i
  );
  assert.throws(
    () => validateBaselineRecommendation(catalog, baseline.id, minimumLength.controlId, { unexpected: 14 }),
    /Control Pack contract error/i
  );

  const { validatePolicyDraft } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyValidation.js')).href);
  const unsupportedCatalog = {
    ...catalog,
    controlsById: {
      ...catalog.controlsById,
      'test.unsupported': {
        controlId: 'test.unsupported',
        version: '0.1.0',
        automationGroupId: 'identity.password-policy',
        parameters: [{ id: 'value', type: 'json', label: 'Value', description: 'Unsupported', required: true, defaultValue: {} }]
      }
    }
  };
  const unsupportedValidation = validatePolicyDraft(validInput({ selectedControls: [selectionFor(unsupportedCatalog.controlsById['test.unsupported'], { value: {} })] }), unsupportedCatalog);
  assert.match(unsupportedValidation.blockingMessage, /Unsupported parameter type/i);

  const context = createNoMutationContext();
  const result = await savePolicyAction(context, { payload: { draft: validInput({ selectedControls: [{ ...validInput().selectedControls[0], parameters: { minimumLength: 999 } }] }) } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(context.calls.length, 0, 'invalid save-policy input must not reach durable writes');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
