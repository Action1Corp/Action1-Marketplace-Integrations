const assert = require('assert');
const fs = require('fs');
const path = require('path');

const manifest = require('../manifest.json');
const display = require('../display.json');

function run() {
  const navigation = Array.isArray(display.navigation) ? display.navigation : [];
  const mappingRoute = navigation.find((row) => row.path === 'mapping');
  assert(mappingRoute, 'display.json should declare the mapping route');
  assert.strictEqual(mappingRoute.requiresWrite, true, 'mapping route should require write access');

  const mappingActions = [
    'list-halo-org-client-mappings',
    'save-halo-org-client-mapping',
    'delete-halo-org-client-mapping',
    'discover-halo-mapping-options'
  ];

  for (const actionId of mappingActions) {
    const action = manifest.actions.find((row) => row.id === actionId);
    assert(action, `${actionId} should be declared in manifest.json`);
    assert.strictEqual(action.placement, 'mapping', `${actionId} should target the mapping screen`);
    assert.strictEqual(action.history, false, `${actionId} should disable history for UI-style mapping operations`);
  }

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.jsx'), 'utf8');
  assert(indexSource.includes("import Mapping from './Mapping.jsx';"), 'ui/index.jsx should import Mapping.jsx');
  assert(indexSource.includes('mapping: Mapping'), 'ui/index.jsx should export the mapping view');

  const mappingSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Mapping.jsx'), 'utf8');
  assert(mappingSource.includes("list: 'list-halo-org-client-mappings'"), 'Mapping.jsx should define the mapping list action id');
  assert(mappingSource.includes("save: 'save-halo-org-client-mapping'"), 'Mapping.jsx should define the mapping save action id');
  assert(mappingSource.includes("remove: 'delete-halo-org-client-mapping'"), 'Mapping.jsx should define the mapping delete action id');
  assert(mappingSource.includes("discover: 'discover-halo-mapping-options'"), 'Mapping.jsx should define the Halo client discovery action id');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
