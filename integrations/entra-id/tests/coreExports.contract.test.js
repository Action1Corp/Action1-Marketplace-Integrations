const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function importModule(...segments) {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', ...segments)).href;
  return import(moduleUrl);
}

async function run() {
  const action1Client = await importModule('core', 'action1', 'action1Client.mjs');
  const entraClient = await importModule('core', 'entra', 'entraClient.mjs');
  const syncEngine = await importModule('core', 'sync', 'syncEngine.mjs');

  assert.strictEqual(typeof action1Client.getAccessToken, 'function');
  assert.strictEqual(typeof action1Client.listManagedEndpoints, 'function');
  assert.strictEqual(typeof action1Client.patchManagedEndpoint, 'function');

  assert.strictEqual(typeof entraClient.getAccessToken, 'function');
  assert.strictEqual(typeof entraClient.listDevices, 'function');
  assert.strictEqual(typeof entraClient.listDeviceGroups, 'function');
  assert.strictEqual(typeof entraClient.listDevicesWithGroups, 'function');
  assert.strictEqual(typeof entraClient.validateGraphConnection, 'function');

  assert.strictEqual(typeof syncEngine.runSync, 'function');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
