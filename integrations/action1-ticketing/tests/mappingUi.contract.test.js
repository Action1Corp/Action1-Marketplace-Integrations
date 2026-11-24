const assert = require('assert');
const fs = require('fs');
const path = require('path');

const manifest = require('../manifest.json');
const display = require('../display.json');

function run() {
  const navigation = Array.isArray(display.navigation) ? display.navigation : [];
  const mappingRoute = navigation.find((row) => row.path === 'mapping');
  assert(mappingRoute, 'display.json should declare the mapping route');
  assert.strictEqual(mappingRoute.label, 'Mapping', 'display.json should expose the provider-neutral Mapping label');
  assert.strictEqual(mappingRoute.requiresWrite, true, 'mapping route should require write access');

  const mappingActions = [
    'list-ticketing-org-destination-mappings',
    'save-ticketing-org-destination-mapping',
    'delete-ticketing-org-destination-mapping',
    'discover-action1-mapping-options',
    'discover-ticketing-mapping-options'
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

  const mappingSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Mapping.jsx'), 'utf8').replace(/\r\n/g, '\n');
  assert(mappingSource.includes("list: 'list-ticketing-org-destination-mappings'"), 'Mapping.jsx should define the mapping list action id');
  assert(mappingSource.includes("save: 'save-ticketing-org-destination-mapping'"), 'Mapping.jsx should define the mapping save action id');
  assert(mappingSource.includes("remove: 'delete-ticketing-org-destination-mapping'"), 'Mapping.jsx should define the mapping delete action id');
  assert(mappingSource.includes("discoverAction1: 'discover-action1-mapping-options'"), 'Mapping.jsx should define the Action1 organization discovery action id');
  assert(mappingSource.includes("discover: 'discover-ticketing-mapping-options'"), 'Mapping.jsx should define the destination discovery action id');
  assert(mappingSource.includes('Active ticketing system:'), 'Mapping.jsx should identify the server-selected active provider');
  assert(mappingSource.includes('Map Action1 organizations to the active ticketing system'), 'Mapping.jsx should use active-provider-neutral copy');
  assert(mappingSource.includes('Organization Mapping'), 'Mapping.jsx should keep the mapping table section title');
  assert(mappingSource.includes('Choose a destination customer for each Action1 organization.'), 'Mapping.jsx should explain the shared source-to-destination mapping');
  assert(mappingSource.includes("display: 'grid',\n    gap: '0.5rem'"), 'Mapping.jsx should use the shared page-shell grid spacing convention');
  assert(mappingSource.includes("cardTitle: {\n    margin: 0,\n    fontSize: '1.125rem'"), 'Mapping.jsx should define the shared section-heading typography baseline');
  assert(mappingSource.includes('<h1 className="page-title" style={styles.title}>Mapping</h1>'), 'Mapping.jsx should render a provider-neutral Mapping title');
  assert(mappingSource.includes('Refresh Discovery'), 'Mapping.jsx should expose one shared discovery refresh action');
  assert(mappingSource.includes('+ Add Mapping'), 'Mapping.jsx should expose Add Mapping in the toolbar');
  assert(mappingSource.includes('Auto Match') && mappingSource.includes('onClick={openAutoMatchPreview}'), 'Mapping.jsx should open the Auto Match review flow');
  assert(mappingSource.includes('aria-modal="true"') && mappingSource.includes('Apply Matches ('), 'Mapping.jsx should render the mandatory review dialog and explicit Apply action');
  assert(mappingSource.includes('Save Changes'), 'Mapping.jsx should expose the approved save action below the table');
  assert(mappingSource.includes('Search organizations...'), 'Mapping.jsx should expose organization search');
  assert(mappingSource.includes('aria-label="Mapping filter"'), 'Mapping.jsx should expose the All/Mapped/Unmapped filter');
  assert(mappingSource.includes('Showing ${page.start}–${page.end} of ${page.total}'), 'Mapping.jsx should expose the visible range and filtered total');
  assert(mappingSource.includes('paginateMappingRows(projectedRows, mappingPage, 25)'), 'Mapping.jsx should cap rendered mapping rows at 25');
  assert(mappingSource.includes('Action1 Organization'), 'Mapping.jsx should expose the Action1 organization dropdown');
  assert(mappingSource.includes('Action</th>') || mappingSource.includes('>Action<'), 'Mapping.jsx should expose the Action column header');
  assert(mappingSource.includes('No Action1 organizations are available.'), 'Mapping.jsx should render an in-context empty organization state');
  assert(mappingSource.includes('Technical details'), 'Mapping.jsx should expose a temporary technical details section');
  assert(mappingSource.includes('<details'), 'Mapping.jsx should render technical details in a collapsible section');
  assert(mappingSource.includes('JSON.stringify(diagnostics, null, 2)'), 'Mapping.jsx should render formatted diagnostics JSON');
  assert(mappingSource.includes('action1Diagnostics ? <DiagnosticDetails diagnostics={action1Diagnostics} /> : null'), 'Mapping.jsx should render Action1 diagnostics only when present');
  assert(mappingSource.includes('destinationDiagnostics ? <DiagnosticDetails diagnostics={destinationDiagnostics} /> : null'), 'Mapping.jsx should render destination diagnostics only when present');
  assert(mappingSource.includes('Saved Mappings'), 'Mapping.jsx should keep the saved mappings summary visible');
  assert(mappingSource.includes('mappingOptionsForRow'), 'Mapping.jsx should filter already selected options for each row');
  assert(mappingSource.includes('data-map-org'), 'Mapping.jsx should render row-based Action1 organization selectors');
  assert(mappingSource.includes('destinationId'), 'Mapping.jsx should store a neutral destination identifier');
  assert(mappingSource.includes('data-map-remove'), 'Mapping.jsx should render row removal actions');
  assert(mappingSource.includes("const [saveMessage, setSaveMessage] = useState('');"), 'Mapping.jsx should track save success feedback separately from global page errors');
  assert(mappingSource.includes("const [saveError, setSaveError] = useState('');"), 'Mapping.jsx should track save errors separately from global discovery errors');
  assert(mappingSource.includes('data-save-feedback'), 'Mapping.jsx should render save feedback near the mapping table controls');
  assert(mappingSource.includes("maxWidth: 820"), 'Mapping.jsx should use the same max-width convention as Settings');
  assert(mappingSource.includes("margin: '0 auto'"), 'Mapping.jsx should center the mapping page like Settings');
  assert(mappingSource.includes("verticalAlign: 'middle'"), 'Mapping.jsx should keep table rows vertically aligned for compact scanning');
  assert(mappingSource.includes('buildMappingSavePlan'), 'Mapping.jsx should use identity-aware save planning');
  assert(mappingSource.includes('executeMappingSavePlan'), 'Mapping.jsx should keep saves sequential');
  assert(mappingSource.includes('const [action1Diagnostics, setAction1Diagnostics] = useState(null);'), 'Mapping.jsx should track Action1 discovery diagnostics separately');
  assert(mappingSource.includes('const [destinationDiagnostics, setDestinationDiagnostics] = useState(null);'), 'Mapping.jsx should track destination diagnostics separately');
  assert(mappingSource.includes('label={`Action1 Organization row ${visibleIndex + 1}`}'), 'Mapping.jsx should keep row selectors accessible without repeated visible labels');
  assert(mappingSource.includes('type="search"') && mappingSource.includes('role="combobox"'), 'Mapping.jsx should expose the locally searchable Action1 combobox');
  assert(mappingSource.includes('onLoadMore={loadMoreDestinationOptions}') && mappingSource.includes('onSearch={searchDestinationOptions}'), 'Mapping.jsx should pass server search and explicit page loading to provider-owned selectors');
  assert(mappingSource.includes('selectedOption={selectedDestinationOption}'), 'Mapping.jsx should retain selected destinations outside the active result page');
  assert(!mappingSource.includes('Action1 Organization ID'), 'Mapping.jsx should not expose manual Action1 organization ID entry');
  assert(!mappingSource.includes('Action1 Organization Name'), 'Mapping.jsx should not expose manual Action1 organization name entry');
  assert(!mappingSource.includes('Action1 Ticketing Client ID'), 'Mapping.jsx should not expose Halo-specific destination fields');
  assert(!mappingSource.includes('Action1 Ticketing Client Name'), 'Mapping.jsx should not expose Halo-specific destination fields');
  assert(!mappingSource.includes('<label style={styles.label} htmlFor={`map-org-${rowIndex}`}>Action1 Organization</label>'), 'Mapping.jsx should not repeat the Action1 label inside every row');
  assert(!mappingSource.includes('Refresh Action1 Organizations'), 'Mapping.jsx should not expose a separate Action1 refresh button');
  assert(!mappingSource.includes('Refresh Action1 Ticketing Clients'), 'Mapping.jsx should not expose Halo-specific refresh copy');
  assert(!mappingSource.includes('Enabled</p>'), 'Mapping.jsx should not show an Enabled summary card');
  assert(!mappingSource.includes('Mapping enabled'), 'Mapping.jsx should not expose an enabled checkbox');
  assert(!mappingSource.includes('Enabled</th>'), 'Mapping.jsx should not show an Enabled table column');
  assert(!mappingSource.includes('Edit Mapping'), 'Mapping.jsx should not expose a separate edit mode');
  assert(!mappingSource.includes('Create Mapping'), 'Mapping.jsx should not expose a separate create form');
  assert(!mappingSource.includes('Edit'), 'Mapping.jsx should not expose edit row actions');
  assert(!mappingSource.includes('Manual entry is expected for the Action1 side'), 'Mapping.jsx should not mention manual Action1 entry');
  assert(!mappingSource.includes('Advanced'), 'Mapping.jsx should not add an advanced manual fallback section');
  assert(!mappingSource.includes("from '../haloApi'"), 'Mapping.jsx must not call the Halo API directly');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
