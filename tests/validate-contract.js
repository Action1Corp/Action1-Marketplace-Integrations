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
    if (manifest.capabilities.includes('validate')) {
      assert(fs.existsSync(path.join(integrationDir, 'validate.js')), `${manifest.id}: validate capability requires validate.js`);
      assert.strictEqual(typeof handler.validate, 'function', `${manifest.id}: validate capability requires validate()`);
      const result = await handler.validate({ settings: {}, logger: console });
      assert(result && typeof result === 'object', `${manifest.id}: validate() should return an object`);
      assert(Object.prototype.hasOwnProperty.call(result, manifest.id), `${manifest.id}: validate() should include vendor result key`);
    }

    if (manifest.capabilities.includes('sync')) {
      assert(fs.existsSync(path.join(integrationDir, 'sync.js')), `${manifest.id}: sync capability requires sync.js`);
      assert.strictEqual(typeof handler.sync, 'function', `${manifest.id}: sync capability requires sync()`);
    }

    if (fs.existsSync(displayPath)) {
      const display = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
      const migrationSql = fs.existsSync(migrationsDir)
        ? fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8')).join('\n')
        : '';
      const tablePrefix = manifest.id.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      assert(Array.isArray(display.navigation) && display.navigation.length > 0, `${manifest.id}: display.json should define navigation`);
      if (display.dashboard) {
        assert(display.dashboard && typeof display.dashboard === 'object', `${manifest.id}: display.json should define dashboard`);
        assert(display.dashboard.component, `${manifest.id}: dashboard definition should declare component`);
      }
      if (display.endpoints) {
        assert(display.endpoints && Array.isArray(display.endpoints.columns) && display.endpoints.columns.length > 0, `${manifest.id}: display.json should define endpoint columns`);
      }
      if (display.vulnerabilities) {
        assert(display.vulnerabilities && Array.isArray(display.vulnerabilities.columns) && display.vulnerabilities.columns.length > 0, `${manifest.id}: display.json should define vulnerability columns`);
      }
      if (display.history) {
        assert(display.history && Array.isArray(display.history.columns) && display.history.columns.length > 0, `${manifest.id}: display.json should define history columns`);
      }
      if (display.endpoints || display.dashboard?.component === 'metric-dashboard') {
        assert(migrationSql.includes(`${tablePrefix}_endpoints`), `${manifest.id}: standard endpoint/dashboard views require ${tablePrefix}_endpoints migration`);
      }
      if (display.vulnerabilities || display.dashboard?.component === 'metric-dashboard') {
        assert(migrationSql.includes(`${tablePrefix}_endpoint_cves`), `${manifest.id}: standard vulnerability/dashboard views require ${tablePrefix}_endpoint_cves migration`);
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
