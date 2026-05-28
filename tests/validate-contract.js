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
    const hostServices = manifest.hostServices || [];
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'capabilities'), `${manifest.id}: use hostServices instead of capabilities`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'marketplaceActions'), `${manifest.id}: use hostServices instead of marketplaceActions`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'settings'), `${manifest.id}: settings belong in ui/settingsSchema.json`);
    assert(Array.isArray(hostServices), `${manifest.id}: hostServices should be an array`);
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

    const handler = require(handlerPath);
    if (Array.isArray(manifest.actions) && manifest.actions.length > 0) {
      assert(handler.actions && typeof handler.actions === 'object', `${manifest.id}: manifest actions require exported action handlers`);
      for (const action of manifest.actions) {
        assert.strictEqual(typeof handler.actions[action.id], 'function', `${manifest.id}: action ${action.id} requires a handler`);
      }
    }
    if (hostServices.includes('validate')) {
      assert(fs.existsSync(path.join(integrationDir, 'validate.js')), `${manifest.id}: validate hostService requires validate.js`);
      assert.strictEqual(typeof handler.validate, 'function', `${manifest.id}: validate hostService requires validate()`);
      const result = await handler.validate({ settings: {}, logger: console });
      assert(result && typeof result === 'object', `${manifest.id}: validate() should return an object`);
      assert(Object.prototype.hasOwnProperty.call(result, manifest.id), `${manifest.id}: validate() should include vendor result key`);
    }

    if (hostServices.includes('sync')) {
      assert(fs.existsSync(path.join(integrationDir, 'sync.js')), `${manifest.id}: sync hostService requires sync.js`);
      assert.strictEqual(typeof handler.sync, 'function', `${manifest.id}: sync hostService requires sync()`);
    }

    if (fs.existsSync(displayPath)) {
      const display = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
      assert(Array.isArray(display.navigation) && display.navigation.length > 0, `${manifest.id}: display.json should define navigation`);
      if (display.dashboard) assert(display.dashboard && typeof display.dashboard === 'object', `${manifest.id}: display.json should define dashboard`);
      if (display.endpoints) {
        assert(display.endpoints && Array.isArray(display.endpoints.columns) && display.endpoints.columns.length > 0, `${manifest.id}: display.json should define endpoint columns`);
      }
      if (display.vulnerabilities) {
        assert(display.vulnerabilities && Array.isArray(display.vulnerabilities.columns) && display.vulnerabilities.columns.length > 0, `${manifest.id}: display.json should define vulnerability columns`);
      }
      if (display.history) {
        assert(display.history && Array.isArray(display.history.columns) && display.history.columns.length > 0, `${manifest.id}: display.json should define history columns`);
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
