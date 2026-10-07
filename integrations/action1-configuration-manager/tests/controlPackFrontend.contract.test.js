const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js'), 'utf8');
  assert(!source.includes('control-packs/windows-endpoint-configuration/'));
  assert(!source.includes('control-packs\\windows-endpoint-configuration\\'));
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'policies', 'PolicyPage.jsx'), 'utf8');
  assert(pageSource.includes('getControlPack'));

  const module = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js')).href);
  const response = {
    ok: true,
    packId: 'windows-endpoint-configuration',
    packVersion: '0.6.0',
    catalog: {
      families: [{ familyId: 'identity', displayOrder: 1 }],
      automationGroups: [{ automationGroupId: 'identity.password-policy', version: '1.0.0', displayOrder: 1 }],
      controls: [{ controlId: 'identity.password.minimum-length', version: '1.0.0', automationGroupId: 'identity.password-policy', parameters: [] }]
    },
    baselines: [{ id: 'baseline-1', name: 'Baseline 1', controls: [] }]
  };
  const catalog = module.buildControlPackCatalog(response);
  assert.strictEqual(catalog.packId, response.packId);
  assert.strictEqual(catalog.packVersion, response.packVersion);
  assert.deepStrictEqual(catalog.baselines, response.baselines);
  assert.strictEqual(catalog.controlsById['identity.password.minimum-length'].version, '1.0.0');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
