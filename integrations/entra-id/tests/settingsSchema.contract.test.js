const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const groups = new Set(settingsSchema.map((row) => row.group));

  const requiredKeys = [
    'EntraTenantId',
    'EntraClientId',
    'EntraClientSecret',
    'EntraGroupsCustomAttributeName',
    'EntraDeviceOwnershipCustomAttributeName'
  ];

  for (const key of requiredKeys) {
    assert(byKey.has(key), `${key} should exist in the Entra settings schema`);
    assert.strictEqual(byKey.get(key).required, true, `${key} should be required`);
  }

  assert(groups.has('Entra Configuration'), 'Entra Configuration group should exist');
  assert(groups.has('Action1 Custom Attributes'), 'Action1 Custom Attributes group should exist');
  assert.strictEqual(groups.has('Diagnostics'), false, 'Diagnostics should not be added in this MVP settings slice');

  assert.strictEqual(byKey.get('EntraTenantId').label, 'Entra Tenant ID');
  assert.strictEqual(byKey.get('EntraClientId').label, 'Entra Client ID');
  assert.strictEqual(byKey.get('EntraClientSecret').label, 'Entra Client Secret');
  assert.strictEqual(byKey.get('EntraClientSecret').type, 'secret');
  assert.strictEqual(
    byKey.get('EntraClientSecret').helpText,
    'Microsoft Entra application client secret. The saved value remains masked.'
  );

  assert.strictEqual(
    byKey.get('EntraGroupsCustomAttributeName').defaultValue,
    'Entra Groups',
    'EntraGroupsCustomAttributeName should preserve the copied local default'
  );
  assert.strictEqual(
    byKey.get('EntraDeviceOwnershipCustomAttributeName').defaultValue,
    'Entra Device Ownership',
    'EntraDeviceOwnershipCustomAttributeName should preserve the copied local default'
  );

  assert.strictEqual(
    byKey.get('EntraGroupsCustomAttributeName').helpText,
    'Stores Microsoft Entra group membership.'
  );
  assert.strictEqual(
    byKey.get('EntraDeviceOwnershipCustomAttributeName').helpText,
    'Stores Microsoft Entra device ownership.'
  );

  assert(settingsSchema.every((row) => String(row.key || '').startsWith('Entra')), 'every Entra durable settings key should start with Entra');

  for (const forbiddenKey of [
    'EntraIdApiUrl',
    'EntraIdApiToken',
    'Action1ApiKey',
    'Action1ApiSecret',
    'Action1ClientId',
    'Action1ClientSecret'
  ]) {
    assert.strictEqual(byKey.has(forbiddenKey), false, `${forbiddenKey} should not exist in the Entra settings schema`);
  }
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
