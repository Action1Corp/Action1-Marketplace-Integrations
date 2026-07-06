const assert = require('assert');
const fs = require('fs');
const path = require('path');

const manifest = require('../manifest.json');
const display = require('../display.json');

function run() {
  const navigation = Array.isArray(display.navigation) ? display.navigation : [];
  const mappingRoute = navigation.find((row) => row.path === 'mapping');
  assert(mappingRoute, 'display.json should declare the mapping route');
  assert.strictEqual(mappingRoute.label, 'Project Mapping', 'display.json should expose the operator-facing Project Mapping label');
  assert.strictEqual(mappingRoute.requiresWrite, true, 'mapping route should require write access');

  const mappingActions = [
    'list-jira-org-project-mappings',
    'save-jira-org-project-mapping',
    'delete-jira-org-project-mapping',
    'discover-action1-mapping-options',
    'discover-jira-project-mapping-options',
    'discover-jira-issue-type-mapping-options'
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

  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Settings.jsx'), 'utf8');
  assert(!settingsSource.includes('JiraCloudProjectId'), 'Settings.jsx should not expose Jira Project settings');
  assert(!settingsSource.includes('JiraCloudIssueTypeId'), 'Settings.jsx should not expose Jira Issue Type settings');
  assert(!settingsSource.includes('Ticket Type'), 'Settings.jsx should not copy HaloPSA Ticket Type into Jira settings');
  assert(!settingsSource.includes('Team'), 'Settings.jsx should not copy HaloPSA Team settings into Jira settings');
  assert(!settingsSource.includes('Category'), 'Settings.jsx should not copy HaloPSA Category settings into Jira settings');
  assert(!settingsSource.includes('New Ticket Status'), 'Settings.jsx should not copy HaloPSA new-status settings into Jira settings');
  assert(!settingsSource.includes('Closed Status'), 'Settings.jsx should not copy HaloPSA closed-status selectors into Jira settings');

  const mappingSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Mapping.jsx'), 'utf8');
  assert(mappingSource.includes("list: 'list-jira-org-project-mappings'"), 'Mapping.jsx should define the mapping list action id');
  assert(mappingSource.includes("save: 'save-jira-org-project-mapping'"), 'Mapping.jsx should define the mapping save action id');
  assert(mappingSource.includes("remove: 'delete-jira-org-project-mapping'"), 'Mapping.jsx should define the mapping delete action id');
  assert(mappingSource.includes("discoverAction1: 'discover-action1-mapping-options'"), 'Mapping.jsx should define the Action1 organization discovery action id');
  assert(mappingSource.includes("discoverProjects: 'discover-jira-project-mapping-options'"), 'Mapping.jsx should define the Jira project discovery action id');
  assert(mappingSource.includes("discoverIssueTypes: 'discover-jira-issue-type-mapping-options'"), 'Mapping.jsx should define the Jira issue type discovery action id');
  assert(mappingSource.includes('Project Mapping'), 'Mapping.jsx should use Project Mapping wording');
  assert(mappingSource.includes('Map Action1 organizations to Jira projects and Jira issue types'), 'Mapping.jsx should render the page-level Project Mapping description');
  assert(mappingSource.includes('Organization Mapping'), 'Mapping.jsx should keep the mapping table section title');
  assert(mappingSource.includes('Choose the Jira project and Jira issue type for each Action1 organization.'), 'Mapping.jsx should use the Jira-specific mapping subtitle');
  assert(mappingSource.includes("display: 'grid',\n    gap: '0.5rem'"), 'Mapping.jsx should use the shared page-shell grid spacing convention');
  assert(mappingSource.includes("cardTitle: {\n    margin: 0,\n    fontSize: '1.125rem'"), 'Mapping.jsx should define the shared section-heading typography baseline');
  assert(mappingSource.includes('<h1 className="page-title" style={styles.title}>Project Mapping</h1>'), 'Mapping.jsx should render a page-level Project Mapping title');
  assert(mappingSource.includes('Refresh Discovery'), 'Mapping.jsx should expose one shared discovery refresh action');
  assert(mappingSource.includes('Add Mapping Row'), 'Mapping.jsx should expose the Halo-style add-row action');
  assert(mappingSource.includes('Save Mappings'), 'Mapping.jsx should expose the Halo-style save action');
  assert(mappingSource.includes('Action1 Organization'), 'Mapping.jsx should expose the Action1 organization dropdown');
  assert(mappingSource.includes('Jira Project'), 'Mapping.jsx should expose the Jira project dropdown');
  assert(mappingSource.includes('Jira Issue Type'), 'Mapping.jsx should expose the Jira issue type dropdown');
  assert(mappingSource.includes('Action</th>') || mappingSource.includes('>Action<'), 'Mapping.jsx should expose the Action column header');
  assert(mappingSource.includes('No mappings added yet.'), 'Mapping.jsx should render the empty mapping table state');
  assert(mappingSource.includes('Technical details'), 'Mapping.jsx should expose a temporary technical details section');
  assert(mappingSource.includes('JSON.stringify(diagnostics, null, 2)'), 'Mapping.jsx should render formatted diagnostics JSON');
  assert(mappingSource.includes('action1Diagnostics ? <DiagnosticDetails diagnostics={action1Diagnostics} /> : null'), 'Mapping.jsx should render Action1 diagnostics only when present');
  assert(mappingSource.includes('jiraProjectDiagnostics ? <DiagnosticDetails diagnostics={jiraProjectDiagnostics} /> : null'), 'Mapping.jsx should render Jira project diagnostics only when present');
  assert(mappingSource.includes('Saved Mappings'), 'Mapping.jsx should keep the saved mappings summary visible');
  assert(mappingSource.includes('data-map-org'), 'Mapping.jsx should render row-based Action1 organization selectors');
  assert(mappingSource.includes('data-map-project'), 'Mapping.jsx should render row-based Jira project selectors');
  assert(mappingSource.includes('data-map-issuetype'), 'Mapping.jsx should render row-based Jira issue type selectors');
  assert(mappingSource.includes('data-map-remove'), 'Mapping.jsx should render row removal actions');
  assert(mappingSource.includes("const [saveMessage, setSaveMessage] = useState('');"), 'Mapping.jsx should track save success feedback separately from global page errors');
  assert(mappingSource.includes("const [saveError, setSaveError] = useState('');"), 'Mapping.jsx should track save errors separately from global discovery errors');
  assert(mappingSource.includes('data-save-feedback'), 'Mapping.jsx should render save feedback near the mapping table controls');
  assert(mappingSource.includes("maxWidth: 820"), 'Mapping.jsx should use the same max-width convention as Settings');
  assert(mappingSource.includes("margin: '0 auto'"), 'Mapping.jsx should center the mapping page like Settings');
  assert(mappingSource.includes("verticalAlign: 'middle'"), 'Mapping.jsx should keep table rows vertically aligned for compact scanning');
  assert(mappingSource.includes('const rowsToDelete = savedMappings.filter'), 'Mapping.jsx should remove deleted rows during save');
  assert(mappingSource.includes('const rowsToCreate = persistRows.filter'), 'Mapping.jsx should persist changed/new rows during save');
  assert(mappingSource.includes('enabled: true'), 'Mapping.jsx should keep DB compatibility by saving mappings as enabled');
  assert(mappingSource.includes("const [action1Diagnostics, setAction1Diagnostics] = useState(null);"), 'Mapping.jsx should track Action1 discovery diagnostics separately');
  assert(mappingSource.includes("const [jiraProjectDiagnostics, setJiraProjectDiagnostics] = useState(null);"), 'Mapping.jsx should track Jira project discovery diagnostics separately');
  assert(mappingSource.includes('Select project first'), 'Mapping.jsx should block issue type selection until a Jira project is selected');
  assert(mappingSource.includes('jiraIssueTypeId: \'\''), 'changing Jira Project should clear the selected Jira Issue Type');
  assert(mappingSource.includes('loadIssueTypesForProject(nextId);'), 'changing Jira Project should load project-scoped issue types');
  assert(mappingSource.includes('issueTypesByProjectId'), 'Mapping.jsx should treat Jira issue type options as project-scoped');
  assert(mappingSource.includes('issueTypeErrorsByProjectId'), 'Mapping.jsx should keep issue type discovery failures row-visible');
  assert(mappingSource.includes('issueTypeDiagnosticsByProjectId'), 'Mapping.jsx should keep issue type diagnostics per project');
  assert(mappingSource.includes('aria-label={`Action1 Organization row ${rowIndex + 1}`}'), 'Mapping.jsx should keep row selectors accessible without repeated visible labels');
  assert(mappingSource.includes('aria-label={`Jira Project row ${rowIndex + 1}`}'), 'Mapping.jsx should keep Jira project selectors accessible without repeated visible labels');
  assert(mappingSource.includes('aria-label={`Jira Issue Type row ${rowIndex + 1}`}'), 'Mapping.jsx should keep Jira issue type selectors accessible without repeated visible labels');
  assert(!mappingSource.includes('Action1 Organization ID'), 'Mapping.jsx should not expose manual Action1 organization ID entry');
  assert(!mappingSource.includes('Jira Project ID'), 'Mapping.jsx should not expose manual Jira project ID entry');
  assert(!mappingSource.includes('Jira Issue Type ID'), 'Mapping.jsx should not expose manual Jira issue type ID entry');
  assert(!mappingSource.includes('Action1ApiKey'), 'Mapping.jsx should not expose Action1 credential fields');
  assert(!mappingSource.includes('Action1ApiSecret'), 'Mapping.jsx should not expose Action1 credential fields');
  assert(!mappingSource.includes('Refresh Action1 Organizations'), 'Mapping.jsx should not expose a separate Action1 refresh button');
  assert(!mappingSource.includes('Refresh Jira Projects'), 'Mapping.jsx should not expose a separate Jira project refresh button');
  assert(!mappingSource.includes('Refresh Jira Issue Types'), 'Mapping.jsx should not expose a separate Jira issue type refresh button');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
