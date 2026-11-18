const assert = require('assert');
const manifest = require('../manifest.json');
const { actions } = require('../actions');

async function run() {
  const discoveryAction = manifest.actions.find((action) => action.id === 'discover-ticketing-settings-options');
  assert(discoveryAction, 'discover-ticketing-settings-options should be declared in manifest.json');
  assert.strictEqual(discoveryAction.history, false, 'discover-ticketing-settings-options should disable history for settings UI lookups');
  assert.strictEqual(discoveryAction.placement, 'settings', 'discover-ticketing-settings-options should be a settings action');

  assert.strictEqual(typeof actions['discover-ticketing-settings-options'], 'function', 'discover-ticketing-settings-options handler should exist');
  assert.strictEqual(typeof actions['validate-configuration'], 'function', 'validate-configuration handler should exist');
  assert.strictEqual(typeof actions.sync, 'function', 'sync handler should exist');

  const discoveryResult = await actions['discover-ticketing-settings-options']({
    settings: {
      async get() {
        return '';
      }
    }
  }, { settings: {}, run: null });
  assert(discoveryResult && typeof discoveryResult === 'object', 'discover-ticketing-settings-options should return an object');
  assert(Object.prototype.hasOwnProperty.call(discoveryResult, 'ok'), 'discover-ticketing-settings-options result should include ok');

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
  const activation = manifest.actions.find((action) => action.id === 'activate-provider');
  assert(activation, 'activate-provider should be declared');
  assert.notStrictEqual(activation.history, false, 'provider activation should be tracked');
  assert.strictEqual(activation.preventConcurrent, undefined, 'activation should retain documented default concurrency prevention');
  assert.strictEqual(syncAction.preventConcurrent, undefined, 'sync should retain documented default concurrency prevention');
  assert.strictEqual(typeof actions['activate-provider'], 'function', 'activation handler should exist');
  const saveSettings = manifest.actions.find((action) => action.id === 'save-provider-settings');
  assert(saveSettings, 'provider-aware settings save should use the integration ownership handler');
  assert.strictEqual(saveSettings.history, false, 'ordinary settings saves should remain untracked');
  assert.strictEqual(typeof actions['save-provider-settings'], 'function');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
