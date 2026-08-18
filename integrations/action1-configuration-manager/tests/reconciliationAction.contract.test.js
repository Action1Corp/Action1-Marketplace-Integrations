const assert = require('assert');
const path = require('path');

const integrationDir = path.join(__dirname, '..');
const manifest = require(path.join(integrationDir, 'manifest.json'));
const entrypoint = require(path.join(integrationDir, manifest.entry || 'index.js'));
const { SCHEDULE_EXPRESSION, SCHEDULE_KEY, TIMEZONE_KEY } = require('../reconciliationSchedule');

const action = manifest.actions.find((item) => item.id === 'reconcile-policies');
assert(action, 'reconciliation action must be declared');
assert.strictEqual(action.kind, 'sync');
assert.strictEqual(action.history, true);
assert.strictEqual(action.retry, false);
assert.strictEqual(typeof entrypoint.actions['reconcile-policies'], 'function');
assert.strictEqual(SCHEDULE_KEY, 'CronSchedule_action1-configuration-manager');
assert.strictEqual(TIMEZONE_KEY, 'CronTimezone_action1-configuration-manager');
assert.strictEqual(SCHEDULE_EXPRESSION, '0 */6 * * *');
assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'settings'), false);
console.log('Configuration Manager reconciliation action contract passed.');
