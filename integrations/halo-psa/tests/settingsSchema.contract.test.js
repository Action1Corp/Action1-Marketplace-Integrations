const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const requiredKeys = [
    'HaloResourceServer',
    'HaloAuthorisationServer',
    'HaloClientId',
    'HaloClientSecret'
  ];

  for (const key of requiredKeys) {
    assert(byKey.has(key), `${key} should exist in HaloPSA settings schema`);
    assert.strictEqual(byKey.get(key).required, true, `${key} should be required`);
  }

  assert.strictEqual(byKey.get('HaloClientSecret').type, 'secret', 'HaloClientSecret should use type secret');
  assert.strictEqual(byKey.has('HaloTenant'), false, 'HaloTenant should not exist in HaloPSA settings schema');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'HaloPSA settings schema should not declare Action1 credential keys');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
