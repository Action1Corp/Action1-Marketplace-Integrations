const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'integrations');

async function run() {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const integrationDir = path.join(root, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(integrationDir, 'manifest.json'), 'utf8'));
    const displayPath = path.join(integrationDir, 'display.json');
    const handlerPath = path.join(integrationDir, manifest.entry || 'index.js');
    assert(fs.existsSync(handlerPath), `${manifest.id}: handler file should exist`);
    assert(fs.existsSync(path.join(integrationDir, 'README.md')), `${manifest.id}: README.md should exist`);

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

    if (manifest.capabilities.includes('dashboard')) {
      assert(fs.existsSync(displayPath), `${manifest.id}: dashboard capability requires display.json`);
      const display = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
      assert(display.dashboard && typeof display.dashboard === 'object', `${manifest.id}: display.json should define dashboard`);
      assert(display.dashboard.component, `${manifest.id}: dashboard definition should declare component`);
    }
  }

  console.log('Integration handler contract tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
