const assert = require('assert');
const manifest = require('../manifest.json');
const { actions } = require('../actions');

async function run() {
  const discoveryAction = manifest.actions.find((action) => action.id === 'discover-halo-settings-options');
  assert(discoveryAction, 'discover-halo-settings-options should be declared in manifest.json');
  assert.strictEqual(discoveryAction.history, false, 'discover-halo-settings-options should disable history for settings UI lookups');
  assert.strictEqual(discoveryAction.placement, 'settings', 'discover-halo-settings-options should be a settings action');

  assert.strictEqual(typeof actions['discover-halo-settings-options'], 'function', 'discover-halo-settings-options handler should exist');
  assert.strictEqual(typeof actions['validate-configuration'], 'function', 'validate-configuration handler should exist');
  assert.strictEqual(typeof actions.sync, 'function', 'sync handler should exist');

  const discoveryResult = await actions['discover-halo-settings-options']({
    settings: {
      async get() {
        return '';
      }
    }
  }, { settings: {}, run: null });
  assert(discoveryResult && typeof discoveryResult === 'object', 'discover-halo-settings-options should return an object');
  assert(Object.prototype.hasOwnProperty.call(discoveryResult, 'ok'), 'discover-halo-settings-options result should include ok');

  const validateResult = await actions['validate-configuration']({
    settings: {
      async get() {
        return '';
      }
    }
  }, { settings: {}, run: null });
  assert(validateResult && typeof validateResult === 'object', 'validate-configuration should return an object');
  assert(Object.prototype.hasOwnProperty.call(validateResult, 'ok'), 'validate-configuration result should include ok');

  const logs = [];
  let processedCount = null;
  const syncResult = await actions.sync({}, {
    run: {
      appendLog: async (message) => {
        logs.push(message);
      },
      setAssetsProcessed: async (count) => {
        processedCount = count;
      }
    }
  });

  assert(syncResult && typeof syncResult === 'object', 'sync should return an object');
  assert.strictEqual(syncResult.ok, false, 'sync should remain a safe not-implemented stub');
  assert.strictEqual(processedCount, 0, 'sync should report zero processed assets');
  assert(logs.some(message => message.includes('not implemented yet')), 'sync should append a safe stub log message');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
