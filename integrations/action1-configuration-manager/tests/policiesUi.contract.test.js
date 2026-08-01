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
  assert(policyPageSource.includes('Create and manage Windows configuration policies that assess and remediate'), 'PolicyPage should use the Blueprint-approved product description');
  assert(policyPageSource.includes('Demo state resets when the Marketplace page is refreshed.'), 'PolicyPage should render the refresh-reset demo notice once at page level');
  assert(policyPageSource.includes('openCreate'), 'PolicyPage should own the Create Policy shell transition');
  assert(policyPageSource.includes('openDetails'), 'PolicyPage should own the Policy Details shell transition');
  assert(policyPageSource.includes('openEdit'), 'PolicyPage should own the Edit Policy shell transition');
  assert(policyPageSource.includes('saveDraft'), 'PolicyPage should own the save flow');
  assert(policyPageSource.includes('togglePolicyEnabled'), 'PolicyPage should own the enable/disable lifecycle transition');
  assert(policyPageSource.includes('deletePolicy'), 'PolicyPage should own the delete lifecycle transition');
  assert(!policyPageSource.includes('Ã¢â‚¬â€'), 'PolicyPage should not preserve mojibake em-dash literals');

  const listViewSource = readSource('ui/policies/PolicyListView.jsx');
  assert(listViewSource.includes('Create Policy'), 'PolicyListView should expose the Create Policy action');
  assert(listViewSource.includes('Status'), 'PolicyListView should render the Status column');
  assert(listViewSource.includes('Target'), 'PolicyListView should render the Target column');
  assert(listViewSource.includes('Actions'), 'PolicyListView should render the Actions column');
  assert(!listViewSource.includes('Open Policies'), 'PolicyListView should not render the stale Open Policies heading');
  assert(!listViewSource.includes('Tuesday Marketplace walkthrough'), 'PolicyListView should not render stale demo walkthrough copy');
  assert(!listViewSource.includes('Organization</th>'), 'PolicyListView should not render a separate Organization column');
  assert(!listViewSource.includes('Scope</th>'), 'PolicyListView should not render a separate Scope column');
  assert(!listViewSource.includes('Controls</th>'), 'PolicyListView should not render a separate Controls column');
  assert(!listViewSource.includes('Automations</th>'), 'PolicyListView should not render a separate Automations column');
  assert(!listViewSource.includes("overflowX: 'auto'"), 'PolicyListView should not default to horizontal overflow for the primary list');
  assert(listViewSource.includes('Open details'), 'PolicyListView should expose Open details from the overflow action pattern');
  assert(listViewSource.includes('Enable'), 'PolicyListView should expose Enable from the overflow action pattern');
  assert(listViewSource.includes('Disable'), 'PolicyListView should expose Disable from the overflow action pattern');
  assert(listViewSource.includes('Delete'), 'PolicyListView should expose Delete from the overflow action pattern');
  assert(listViewSource.includes('No policies'), 'PolicyListView should render the compact Blueprint empty-state heading');
  assert(!listViewSource.includes('<details'), 'PolicyListView should not rely on the clipped details/summary menu pattern');
  assert(listViewSource.includes('Policy actions'), 'PolicyListView should provide an accessible label for the row ellipsis menu');
  assert(listViewSource.includes('\u2026') || listViewSource.includes('...'), 'PolicyListView should render a compact ellipsis-style menu trigger');

  const editorViewSource = readSource('ui/policies/PolicyEditorView.jsx');
  assert(editorViewSource.includes('getInitialOpenControlFamilies'), 'PolicyEditorView should derive initial Control Family expansion from the shared helper');
  assert(editorViewSource.includes('updateRunEveryHours'), 'PolicyEditorView should use the shared Run every synchronization helper');
  assert(editorViewSource.includes('updateCompletionDeadline'), 'PolicyEditorView should use the shared deadline override helper');
  assert(editorViewSource.includes('Save and apply'), 'PolicyEditorView should use Save and apply as the primary action label');
  assert(!editorViewSource.includes('Save changes'), 'PolicyEditorView should not use the stale Save changes label');
  assert(editorViewSource.includes('Save and apply Policy'), 'PolicyEditorView should render a final Save and apply confirmation');
  assert(editorViewSource.includes('Confirm remediation'), 'PolicyEditorView should keep the separate remediation confirmation');
  assert(editorViewSource.includes('Automation completion deadline'), 'PolicyEditorView should render the completion deadline field');
  assert(editorViewSource.includes('Run every'), 'PolicyEditorView should render the Run every field');
  assert(editorViewSource.includes('Timezone'), 'PolicyEditorView should render the timezone field');
  assert(editorViewSource.includes('Start date'), 'PolicyEditorView should render the start date field');
  assert(editorViewSource.includes('Start time'), 'PolicyEditorView should render the start time field');
  assert(editorViewSource.includes('Action1 automations'), 'PolicyEditorView summary should preserve the Action1 automation count');
  assert(editorViewSource.includes('Control Family'), 'PolicyEditorView should use Control Family terminology');
  assert(editorViewSource.includes('Category'), 'PolicyEditorView should use Category terminology in the controls hierarchy');
  assert(!editorViewSource.includes('Family:'), 'PolicyEditorView should not prefix hierarchy rows with stale Family: labels');
  assert(!editorViewSource.includes('Control Family:'), 'PolicyEditorView should not prefix hierarchy rows with stale Control Family: labels');
  assert(!editorViewSource.includes('Control:'), 'PolicyEditorView should not prefix hierarchy rows with stale Control: labels');
  assert(!editorViewSource.includes('rgba(15,23,42,0.36)'), 'PolicyEditorView should not use the stale dark per-section card background');
  assert(!editorViewSource.includes('rgb(15, 23, 42)'), 'PolicyEditorView dialogs should not use a dark modal surface');
  assert(!editorViewSource.includes('summaryGrid'), 'PolicyEditorView should not render the summary as bordered tiles');
  assert(editorViewSource.includes('editorSurface'), 'PolicyEditorView should use one shared primary editor surface');
  assert(editorViewSource.includes('sectionDivider'), 'PolicyEditorView should render subtle dividers between editor sections');
  assert(editorViewSource.includes('Open details'), 'PolicyEditorView should preserve the final confirmation action wording');
  assert(editorViewSource.includes('Assess only'), 'PolicyEditorView should render the Assess only option');
  assert(editorViewSource.includes('Assess and remediate'), 'PolicyEditorView should render the Assess and remediate option');
  assert(editorViewSource.includes('readOnly={isEditMode}'), 'PolicyEditorView should keep immutable edit fields visibly read-only');
  assert(editorViewSource.includes('disabled={isEditMode}'), 'PolicyEditorView should keep immutable edit selectors disabled');
  assert(!editorViewSource.includes('expected demo automation record(s)'), 'PolicyEditorView should not surface implementation-oriented automation count copy');
  assert.doesNotMatch(editorViewSource, />\s*Next\s*</, 'PolicyEditorView should not introduce wizard Next copy');
  assert.doesNotMatch(editorViewSource, />\s*Back\s*</, 'PolicyEditorView should not introduce wizard Back copy');
  assert.doesNotMatch(editorViewSource, />\s*Step\s+\d+/i, 'PolicyEditorView should not introduce step copy');
  assert(!editorViewSource.includes('localStorage'), 'PolicyEditorView should not read localStorage');
  assert(!editorViewSource.includes('/api/'), 'PolicyEditorView should not call Marketplace backend routes');

  const detailsViewSource = readSource('ui/policies/PolicyDetailsView.jsx');
  assert(detailsViewSource.includes('Policy Details'), 'PolicyDetailsView should render the Policy Details heading');
  assert(detailsViewSource.includes('Open automation in Action1'), 'PolicyDetailsView should expose deterministic Action1 automation links');
  assert(detailsViewSource.includes('Enable'), 'PolicyDetailsView should expose the Enable lifecycle action');
  assert(detailsViewSource.includes('Disable'), 'PolicyDetailsView should expose the Disable lifecycle action');
  assert(detailsViewSource.includes('Delete'), 'PolicyDetailsView should expose the Delete lifecycle action');
  assert(detailsViewSource.includes('Back to Policies'), 'PolicyDetailsView should use a text-style Back to Policies navigation link');
  assert(!detailsViewSource.includes('rgba(15,23,42,0.36)'), 'PolicyDetailsView should not use the stale dark card background');
  assert(detailsViewSource.includes('Controls and Action1 automations'), 'PolicyDetailsView should merge Controls and automation links into one customer-facing section');
  assert(!detailsViewSource.includes('Selected Controls'), 'PolicyDetailsView should not render the stale technical Selected Controls section');
  assert(!detailsViewSource.includes('JSON.stringify'), 'PolicyDetailsView should not stringify raw parameter JSON into the customer-facing Details view');
  assert(detailsViewSource.includes('Policy actions'), 'PolicyDetailsView should provide an accessible label for the heading action menu');

  const actionMenuSource = readSource('ui/policies/PolicyActionMenu.jsx');
  assert(actionMenuSource.includes('createPortal'), 'PolicyActionMenu should render through a portal so menus are not clipped by table surfaces');
  assert(actionMenuSource.includes('Escape'), 'PolicyActionMenu should close on Escape');
  assert(actionMenuSource.includes('mousedown'), 'PolicyActionMenu should close on outside click');
  assert(actionMenuSource.includes('fixed'), 'PolicyActionMenu should use fixed positioning for reliable viewport anchoring');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
