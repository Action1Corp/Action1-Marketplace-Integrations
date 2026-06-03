const assert = require('assert');
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'integrations'),
  path.join(__dirname, '..', 'developer', 'examples')
];

async function run() {
  for (const root of roots) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const integrationDir = path.join(root, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(integrationDir, 'manifest.json'), 'utf8'));
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'capabilities'), `${manifest.id}: capabilities are inferred and should not be in manifest.json`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'marketplaceActions'), `${manifest.id}: marketplaceActions should not be in manifest.json`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'hostServices'), `${manifest.id}: hostServices should not be in manifest.json`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'settings'), `${manifest.id}: settings belong in ui/settingsSchema.json`);
    const displayPath = path.join(integrationDir, 'display.json');
    const handlerPath = path.join(integrationDir, manifest.entry || 'index.js');
    const migrationsDir = path.join(integrationDir, 'migrations');
    assert(fs.existsSync(handlerPath), `${manifest.id}: handler file should exist`);
    assert(fs.existsSync(path.join(integrationDir, 'README.md')), `${manifest.id}: README.md should exist`);
    if (fs.existsSync(migrationsDir)) {
      const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql'));
      for (const migration of migrations) {
        assert(/^\d{3,}_[a-z0-9_]+\.sql$/.test(migration), `${manifest.id}: migration ${migration} should use 001_description.sql naming`);
      }
    }

    const handlerSource = fs.readFileSync(handlerPath, 'utf8');
    assert(!handlerSource.includes("require('../database')"), `${manifest.id}: must not import Marketplace database`);
    assert(!handlerSource.includes("require('./nvdService')"), `${manifest.id}: must not import Marketplace NVD service`);
    assert(!handlerSource.includes('context.legacy'), `${manifest.id}: must not use legacy runtime bridge`);
    assert(!handlerSource.includes('context.db.tables'), `${manifest.id}: must own table names instead of using Marketplace table helpers`);

    const handler = require(handlerPath);
    if (Array.isArray(manifest.actions) && manifest.actions.length > 0) {
      assert(handler.actions && typeof handler.actions === 'object', `${manifest.id}: manifest actions require exported action handlers`);
      for (const action of manifest.actions) {
        assert.strictEqual(typeof handler.actions[action.id], 'function', `${manifest.id}: action ${action.id} requires a handler`);
      }
    }
    const validateAction = Array.isArray(manifest.actions) && manifest.actions.find(action => action.kind === 'validate');
    if (validateAction) {
      assert.strictEqual(typeof handler.actions[validateAction.id], 'function', `${manifest.id}: validate action ${validateAction.id} requires a handler`);
      const result = await handler.actions[validateAction.id]({
        integrationId: manifest.id,
        action1: {
          getCredentials: async () => ({ apiKey: '', apiSecret: '', organizationId: '' })
        },
        logger: console
      }, {
        settings: {},
        payload: {},
        run: null
      });
      assert(result && typeof result === 'object', `${manifest.id}: validate action should return an object`);
      assert(Object.prototype.hasOwnProperty.call(result, 'ok'), `${manifest.id}: validate action should return an ok field`);
    }

    const syncAction = Array.isArray(manifest.actions) && manifest.actions.find(action => action.kind === 'sync');
    if (syncAction) {
      assert.strictEqual(typeof handler.actions[syncAction.id], 'function', `${manifest.id}: sync action ${syncAction.id} requires a handler`);
    }

    if (fs.existsSync(displayPath)) {
      const display = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
      assert(Array.isArray(display.navigation) && display.navigation.length > 0, `${manifest.id}: display.json should define navigation`);
      for (const key of Object.keys(display)) {
        assert.strictEqual(key, 'navigation', `${manifest.id}: display.json should only define marketplace navigation; move screen UI metadata into React views`);
      }
    }
  }
  }

  console.log('Integration handler contract tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
