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

  const syncAction = manifest.actions.find((action) => action.id === 'sync');
  assert(syncAction, 'sync should be declared in manifest.json');
  assert.strictEqual(syncAction.kind, 'sync', 'sync should remain manifest-declared as kind sync');
  assert.notStrictEqual(syncAction.history, false, 'sync should remain tracked by Marketplace history');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
