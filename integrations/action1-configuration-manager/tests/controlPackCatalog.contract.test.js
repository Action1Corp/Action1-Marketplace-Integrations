const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const catalogModulePath = path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js');
  const {
    loadReleasedControlCatalog,
    loadReleasedBaselines,
    findBaselineById,
    getBaselineOptions,
    getBaselineMembershipByControlId,
    getRecommendedParametersForBaselineControl,
    buildDefaultParameters,
    countSelectedControlFamilies,
    countExpectedAutomations
  } = await import(pathToFileURL(catalogModulePath).href);

  const catalog = loadReleasedControlCatalog();
  const baselines = loadReleasedBaselines();
  const baselineOptions = getBaselineOptions(baselines);
  const baselineLookup = getBaselineMembershipByControlId(baselines);

  assert.strictEqual(catalog.packId, 'windows-endpoint-configuration', 'catalog adapter should expose the released pack id');
  assert.strictEqual(catalog.packVersion, '0.5.0', 'catalog adapter should expose the released pack version');
  assert.strictEqual(Array.isArray(catalog.families), true, 'catalog adapter should expose released families');
  assert.strictEqual(Array.isArray(catalog.controlFamilies), true, 'catalog adapter should expose customer-facing control families');
  assert.strictEqual(Array.isArray(catalog.controls), true, 'catalog adapter should expose released controls');
  assert(catalog.families.length > 0, 'catalog adapter should expose released families from the current pack');
  assert(catalog.controlFamilies.length > 0, 'catalog adapter should expose released control families from the current pack');
  assert(catalog.controls.length > 0, 'catalog adapter should expose released controls from the current pack');

  assert.strictEqual(Array.isArray(baselines), true, 'catalog adapter should expose released baselines');
  assert.strictEqual(baselines.length, 1, 'catalog adapter should expose the current released baselines');
  assert.deepStrictEqual(
    baselineOptions,
    [
      {
        id: 'microsoft-windows-11-25h2',
        name: 'Microsoft Security Baseline - Windows 11 25H2',
        provider: 'Microsoft',
        version: '25H2',
        tag: 'MS Baseline'
      }
    ],
    'catalog adapter should derive baseline dropdown options from baselines.json'
  );

  assert.strictEqual(
    findBaselineById(baselines, 'microsoft-windows-11-25h2')?.tag,
    'MS Baseline',
    'catalog adapter should support baseline lookup by id'
  );

  assert(
    Array.isArray(baselineLookup['identity.password.minimum-length']) &&
      baselineLookup['identity.password.minimum-length'].some((entry) => entry.baselineId === 'microsoft-windows-11-25h2'),
    'catalog adapter should expose baseline membership by control id'
  );

  assert.deepStrictEqual(
    getRecommendedParametersForBaselineControl(baselines, 'microsoft-windows-11-25h2', 'identity.password.minimum-length'),
    { minimumLength: 14 },
    'catalog adapter should expose recommended parameter values for a baseline-mapped control'
  );

  const familyOrders = catalog.families.map((family) => family.displayOrder);
  const sortedFamilyOrders = [...familyOrders].sort((left, right) => left - right);
  assert.deepStrictEqual(familyOrders, sortedFamilyOrders, 'catalog families should be sorted by displayOrder');

  const controlFamilyOrders = catalog.controlFamilies.map((family) => family.displayOrder);
  const sortedControlFamilyOrders = [...controlFamilyOrders].sort((left, right) => left - right);
  assert.deepStrictEqual(controlFamilyOrders, sortedControlFamilyOrders, 'control families should be sorted by displayOrder');

  assert.strictEqual(typeof catalog.controlsById['identity.password.minimum-length'], 'object', 'catalog adapter should expose control lookup by id');
  assert.strictEqual(typeof catalog.controlFamiliesById['identity.password-policy'], 'object', 'catalog adapter should expose control-family lookup by automationGroupId');

  const minimumPasswordLength = catalog.controlsById['identity.password.minimum-length'];
  assert.strictEqual(minimumPasswordLength.name, 'Minimum password length', 'catalog lookup should preserve released control metadata');
  assert.deepStrictEqual(
    buildDefaultParameters(minimumPasswordLength),
    { minimumLength: 14 },
    'default parameter builder should materialize released default values'
  );

  const secureAttention = catalog.controlsById['identity.sign-in.require-secure-attention'];
  assert.deepStrictEqual(
    buildDefaultParameters(secureAttention),
    {},
    'controls without parameters should materialize an empty default parameter object'
  );

  const selectedControls = [
    {
      controlId: 'identity.password.minimum-length',
      automationGroupId: 'identity.password-policy'
    },
    {
      controlId: 'identity.password.maximum-age',
      automationGroupId: 'identity.password-policy'
    },
    {
      controlId: 'identity.sign-in.require-secure-attention',
      automationGroupId: 'identity.interactive-sign-in'
    }
  ];

  assert.strictEqual(
    countSelectedControlFamilies(selectedControls),
    2,
    'selected-family count should collapse controls sharing the same automationGroupId'
  );
  assert.strictEqual(
    countExpectedAutomations(selectedControls),
    2,
    'expected automation count should match the count of selected non-empty control families'
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
