const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'ui', 'settingsSchema.json');
assert(fs.existsSync(schemaPath), 'Configuration Manager must declare its persisted settings schema');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const debugSetting = schema.find((setting) => setting.key === 'DebugLogging_action1-configuration-manager');
assert(debugSetting, 'debug logging key must be registered in settingsSchema.json');
assert.strictEqual(debugSetting.type, 'checkbox', 'debug logging must use the Marketplace checkbox contract');
assert.strictEqual(debugSetting.defaultValue, 'false', 'debug logging must default to the canonical disabled value');

const persistedKeys = new Set([
  ...schema.map((setting) => setting.key),
  'CronSchedule_action1-configuration-manager',
  'CronTimezone_action1-configuration-manager'
]);
const payload = {
  _integration: 'action1-configuration-manager',
  'CronSchedule_action1-configuration-manager': '0 */6 * * *',
  'CronTimezone_action1-configuration-manager': 'UTC',
  'DebugLogging_action1-configuration-manager': 'true'
};
const accepted = Object.fromEntries(Object.entries(payload).filter(([key]) => persistedKeys.has(key)));
assert.strictEqual(accepted['DebugLogging_action1-configuration-manager'], 'true', 'host-style allowed-key filtering must retain debug logging');

const { normalizeDebugLoggingEnabled } = require('../debugLogging');
for (const value of [true, 'true', 1, '1']) assert.strictEqual(normalizeDebugLoggingEnabled(value), true, `enabled value should normalize: ${String(value)}`);
for (const value of [false, 'false', 0, '0', null, undefined, '']) assert.strictEqual(normalizeDebugLoggingEnabled(value), false, `disabled value should normalize: ${String(value)}`);
assert.strictEqual(normalizeDebugLoggingEnabled('yes'), false, 'arbitrary non-empty strings must remain disabled');

for (const [submitted, expected] of [['true', true], ['false', false]]) {
  const roundTripPayload = { 'DebugLogging_action1-configuration-manager': submitted };
  const persisted = Object.fromEntries(Object.entries(roundTripPayload).filter(([key]) => persistedKeys.has(key)));
  assert.strictEqual(normalizeDebugLoggingEnabled(persisted['DebugLogging_action1-configuration-manager']), expected, `settings round trip should restore ${submitted}`);
}

console.log('debug logging settings contract tests passed');
