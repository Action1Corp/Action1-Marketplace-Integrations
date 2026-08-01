const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function run() {
  const policiesSource = readSource('ui/Policies.jsx');
  assert(policiesSource.includes("import PolicyPage from './policies/PolicyPage.jsx';"), 'Policies.jsx should delegate to the PolicyPage shell');
  assert(policiesSource.includes('<PolicyPage integration={integration} />'), 'Policies.jsx should render the policy shell with the integration prop');

  const policyPageSource = readSource('ui/policies/PolicyPage.jsx');
  assert(policyPageSource.includes('<h1 className="page-title" style={styles.title}>Policies</h1>'), 'PolicyPage should render the Policies page title');
  assert(policyPageSource.includes("maxWidth: 820"), 'PolicyPage should use the shared centered max-width shell');
  assert(policyPageSource.includes("margin: '0 auto'"), 'PolicyPage should center the Policies shell');
  assert(policyPageSource.includes('Demo state resets when the Marketplace page is refreshed.'), 'PolicyPage should render the refresh-reset demo notice once at page level');
  assert(policyPageSource.includes('openCreate'), 'PolicyPage should own the Create Policy shell transition');
  assert(policyPageSource.includes('openDetails'), 'PolicyPage should own the Policy Details shell transition');
  assert(policyPageSource.includes('openEdit'), 'PolicyPage should own the Edit Policy shell transition');
  assert(policyPageSource.includes('saveDraft'), 'PolicyPage should own the save flow');

  const listViewSource = readSource('ui/policies/PolicyListView.jsx');
  assert(listViewSource.includes('Create Policy'), 'PolicyListView should expose the Create Policy action');
  assert(listViewSource.includes('Open'), 'PolicyListView should expose the Open row action');
  assert(listViewSource.includes('Edit'), 'PolicyListView should expose the Edit row action');

  const editorViewSource = readSource('ui/policies/PolicyEditorView.jsx');
  assert(editorViewSource.includes('Policy details'), 'PolicyEditorView should use the Blueprint Policy details section heading');
  assert(editorViewSource.includes('Scope'), 'PolicyEditorView should render the Scope section');
  assert(editorViewSource.includes('Policy mode'), 'PolicyEditorView should render the Policy mode section');
  assert(editorViewSource.includes('Run schedule'), 'PolicyEditorView should render the Run schedule section');
  assert(editorViewSource.includes('Controls'), 'PolicyEditorView should render the Controls section');
  assert(editorViewSource.includes('Summary'), 'PolicyEditorView should render the Summary section');
  assert(editorViewSource.includes('Control Family'), 'PolicyEditorView should use Control Family terminology');
  assert(editorViewSource.includes('Control'), 'PolicyEditorView should use Control terminology');
  assert(editorViewSource.includes('Assess only'), 'PolicyEditorView should render the Assess only option');
  assert(editorViewSource.includes('Assess and remediate'), 'PolicyEditorView should render the Assess and remediate option');
  assert(editorViewSource.includes('setPendingPolicyMode'), 'PolicyEditorView should gate Assess and remediate behind confirmation before state changes');
  assert(editorViewSource.includes('Returning to Assess only does not require confirmation'), 'PolicyEditorView should keep the Assess-only return path unconfirmed');
  assert(editorViewSource.includes('readOnly={isEditMode}'), 'PolicyEditorView should keep immutable edit fields visibly read-only');
  assert(editorViewSource.includes('disabled={isEditMode}'), 'PolicyEditorView should keep immutable edit selectors disabled');
  assert.doesNotMatch(editorViewSource, />\s*Next\s*</, 'PolicyEditorView should not introduce wizard Next copy');
  assert.doesNotMatch(editorViewSource, />\s*Back\s*</, 'PolicyEditorView should not introduce wizard Back copy');
  assert.doesNotMatch(editorViewSource, />\s*Step\s+\d+/i, 'PolicyEditorView should not introduce step copy');
  assert.doesNotMatch(editorViewSource, /progress indicator|wizard progress/i, 'PolicyEditorView should not introduce progress-indicator copy');
  assert(!editorViewSource.includes('localStorage'), 'PolicyEditorView should not read localStorage');
  assert(!editorViewSource.includes('/api/'), 'PolicyEditorView should not call Marketplace backend routes');

  const detailsViewSource = readSource('ui/policies/PolicyDetailsView.jsx');
  assert(detailsViewSource.includes('Policy Details'), 'PolicyDetailsView should render the Policy Details heading');
  assert(detailsViewSource.includes('Edit Policy'), 'PolicyDetailsView should expose the Edit Policy action');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
