const assert = require('assert');
const fs = require('fs');
const path = require('path');

const manifest = require('../manifest.json');
const display = require('../display.json');

function run() {
  const navigation = Array.isArray(display.navigation) ? display.navigation : [];
  const mappingRoute = navigation.find((row) => row.path === 'mapping');
  assert(mappingRoute, 'display.json should declare the mapping route');
  assert.strictEqual(mappingRoute.label, 'Organization Mapping', 'display.json should expose the operator-facing Organization Mapping label');
  assert.strictEqual(mappingRoute.requiresWrite, true, 'mapping route should require write access');

  const mappingActions = [
    'list-entra-org-mappings',
    'save-entra-org-mapping',
    'delete-entra-org-mapping',
    'discover-action1-mapping-options'
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
  assert(mappingSource.includes("list: 'list-entra-org-mappings'"), 'Mapping.jsx should define the mapping list action id');
  assert(mappingSource.includes("save: 'save-entra-org-mapping'"), 'Mapping.jsx should define the mapping save action id');
  assert(mappingSource.includes("remove: 'delete-entra-org-mapping'"), 'Mapping.jsx should define the mapping delete action id');
  assert(mappingSource.includes("discoverAction1: 'discover-action1-mapping-options'"), 'Mapping.jsx should define the Action1 organization discovery action id');
  assert(mappingSource.includes('Organization Mapping'), 'Mapping.jsx should use Organization Mapping wording');
  assert(mappingSource.includes('Map the configured Microsoft Entra tenant to one or more Action1 organizations.'), 'Mapping.jsx should render the page-level mapping description');
  assert(mappingSource.includes('Action1 Organizations'), 'Mapping.jsx should render the mapping table section title');
  assert(mappingSource.includes('Add one row per Action1 organization that later sync slices are allowed to process.'), 'Mapping.jsx should use the Action1 org mapping subtitle');
  assert(mappingSource.includes("display: 'grid',\n    gap: '0.5rem'"), 'Mapping.jsx should use the shared page-shell grid spacing convention');
  assert(mappingSource.includes("cardTitle: {\n    margin: 0,\n    fontSize: '1.125rem'"), 'Mapping.jsx should define the shared section-heading typography baseline');
  assert(mappingSource.includes('<h1 className="page-title" style={styles.title}>Organization Mapping</h1>'), 'Mapping.jsx should render a page-level Organization Mapping title');
  assert(mappingSource.includes('Refresh Action1 Organizations'), 'Mapping.jsx should expose the Action1 discovery refresh action');
  assert(mappingSource.includes('Add Mapping Row'), 'Mapping.jsx should expose the add-row action');
  assert(mappingSource.includes('Save Mappings'), 'Mapping.jsx should expose the save action');
  assert(mappingSource.includes('Action1 Organization'), 'Mapping.jsx should expose the Action1 organization dropdown');
  assert(mappingSource.includes('Action</th>') || mappingSource.includes('>Action<'), 'Mapping.jsx should expose the Action column header');
  assert(mappingSource.includes('No mappings added yet.'), 'Mapping.jsx should render the empty mapping table state');
  assert(mappingSource.includes('Technical details'), 'Mapping.jsx should expose a technical details section');
  assert(mappingSource.includes('JSON.stringify(diagnostics, null, 2)'), 'Mapping.jsx should render formatted diagnostics JSON');
  assert(mappingSource.includes('action1Diagnostics ? <DiagnosticDetails diagnostics={action1Diagnostics} /> : null'), 'Mapping.jsx should render Action1 diagnostics only when present');
  assert(mappingSource.includes('loadingMappings'), 'Mapping.jsx should model the loading mappings state explicitly');
  assert(mappingSource.includes('loadingAction1Options'), 'Mapping.jsx should model the loading Action1 org options state explicitly');
  assert(mappingSource.includes('emptyMappings'), 'Mapping.jsx should model the empty mappings state explicitly');
  assert(mappingSource.includes('rowAdded'), 'Mapping.jsx should model the row added state explicitly');
  assert(mappingSource.includes('duplicateSelectionError'), 'Mapping.jsx should model duplicate org selection explicitly');
  assert(mappingSource.includes('saveError'), 'Mapping.jsx should model save errors explicitly');
  assert(mappingSource.includes('discoveryError'), 'Mapping.jsx should model discovery errors explicitly');
  assert(mappingSource.includes('data-map-org'), 'Mapping.jsx should render row-based Action1 organization selectors');
  assert(mappingSource.includes('data-map-remove'), 'Mapping.jsx should render row removal actions');
  assert(mappingSource.includes("const [saveMessage, setSaveMessage] = useState('');"), 'Mapping.jsx should track save success feedback separately from page errors');
  assert(mappingSource.includes("const [saveError, setSaveError] = useState('');"), 'Mapping.jsx should track save errors separately');
  assert(mappingSource.includes('data-save-feedback'), 'Mapping.jsx should render save feedback near the mapping table controls');
  assert(mappingSource.includes("maxWidth: 820"), 'Mapping.jsx should use the same max-width convention as Settings');
  assert(mappingSource.includes("margin: '0 auto'"), 'Mapping.jsx should center the mapping page like Settings');
  assert(mappingSource.includes("verticalAlign: 'middle'"), 'Mapping.jsx should keep table rows vertically aligned for compact scanning');
  assert(mappingSource.includes('const rowsToDelete = savedMappings.filter'), 'Mapping.jsx should remove deleted rows during save');
  assert(mappingSource.includes('const rowsToSave = persistRows.filter'), 'Mapping.jsx should persist changed/new rows during save');
  assert(mappingSource.includes('Loading mappings...'), 'Mapping.jsx should render the loading mappings state');
  assert(mappingSource.includes('Loading Action1 organizations...'), 'Mapping.jsx should render the loading Action1 org options state');
  assert(mappingSource.includes('Empty Mappings'), 'Mapping.jsx should render the empty mappings state summary');
  assert(mappingSource.includes('Row Added'), 'Mapping.jsx should render the row added state summary');
  assert(mappingSource.includes('Duplicate Org Selected'), 'Mapping.jsx should surface duplicate org selected feedback');
  assert(mappingSource.includes('discovery error') || mappingSource.includes('discoveryError'), 'Mapping.jsx should retain explicit discovery error state');
  assert(mappingSource.includes('save error') || mappingSource.includes('saveError'), 'Mapping.jsx should retain explicit save error state');
  assert(mappingSource.includes('aria-label={`Action1 Organization row ${rowIndex + 1}`}'), 'Mapping.jsx should keep row selectors accessible without repeated visible labels');
  assert(!mappingSource.includes('Tenant'), 'Mapping.jsx should not expose tenant selectors or tenant columns');
  assert(!mappingSource.includes('custom attribute'), 'Mapping.jsx should not expose per-org custom attribute controls');
  assert(!mappingSource.includes('enabled'), 'Mapping.jsx should not expose enabled/disabled state for delete-only MVP behavior');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
