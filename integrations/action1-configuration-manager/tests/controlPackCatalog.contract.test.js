const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const catalogModulePath = path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js');
  const {
    loadReleasedControlCatalog,
    buildDefaultParameters,
    countSelectedControlFamilies,
    countExpectedAutomations
  } = await import(pathToFileURL(catalogModulePath).href);

  const catalog = loadReleasedControlCatalog();

  assert.strictEqual(catalog.packId, 'windows-endpoint-configuration', 'catalog adapter should expose the released pack id');
  assert.strictEqual(catalog.packVersion, '0.1.0', 'catalog adapter should expose the released pack version');
  assert.strictEqual(Array.isArray(catalog.families), true, 'catalog adapter should expose released families');
  assert.strictEqual(Array.isArray(catalog.controlFamilies), true, 'catalog adapter should expose customer-facing control families');
  assert.strictEqual(Array.isArray(catalog.controls), true, 'catalog adapter should expose released controls');
  assert.strictEqual(catalog.families.length, 6, 'catalog adapter should expose all released families');
  assert.strictEqual(catalog.controlFamilies.length, 10, 'catalog adapter should expose all released control families');
  assert.strictEqual(catalog.controls.length, 51, 'catalog adapter should expose all released controls');

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
