const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Settings.jsx'), 'utf8').replace(/\r\n/g, '\n');

  assert(source.includes('const pageStyles = {'), 'Settings.jsx should define a shared page-shell style object');
  assert(source.includes('<h1 className="page-title" style={pageStyles.title}>Settings</h1>'), 'Settings.jsx should render a page-level Settings title');
  assert(source.includes('Set up Microsoft Entra credentials and choose the Action1 custom attributes used for synced device data.'), 'Settings.jsx should render the exact approved page subtitle');

  assert(source.includes('Entra Connection'), 'Settings.jsx should render the Entra Connection section');
  assert(source.includes('Action1 Custom Attributes'), 'Settings.jsx should render the Action1 Custom Attributes section');
  assert(!source.includes('Diagnostics'), 'Settings.jsx should not render a Diagnostics section in this MVP slice');
  assert(source.includes('Enter the Microsoft Entra directory and application credentials used to read device and group membership data.'), 'Settings.jsx should render the exact approved Entra Configuration intro');
  assert(source.includes('Create these custom attributes in every mapped Action1 organization before running sync. Names are case-sensitive.'), 'Settings.jsx should render the exact approved Action1 Custom Attributes intro');

  assert(source.includes('connectionEditing'), 'Settings.jsx should manage Entra connection edit/collapse state');
  assert(source.includes('connectionConfigured'), 'Settings.jsx should track whether Entra settings are already configured');
  assert(source.includes('settingsLoaded'), 'Settings.jsx should gate rendering on effective settings load completion');
  assert(source.includes('Loading settings...'), 'Settings.jsx should render a loading placeholder before effective settings resolve');
  assert(source.includes('Save Connection Settings'), 'Settings.jsx should render the scoped Save Connection Settings action');
  assert(source.includes('Save Attribute Settings'), 'Settings.jsx should render the scoped Save Attribute Settings action');
  assert(source.includes('Edit'), 'Settings.jsx should render an Edit action for configured Entra settings');
  assert(source.includes('Cancel'), 'Settings.jsx should render Cancel only for editing an already-configured Entra connection');
  assert(source.includes('getConnectionSummary(connectionSettings)'), 'Settings.jsx should render the configured summary from the shared settings resolver');

  assert(source.includes('Saved (leave unchanged)'), 'Settings.jsx should preserve masked secret placeholder behavior when editing a configured connection');
  assert(source.includes("from '../settingsResolver.mjs'"), 'Settings.jsx should import the shared settings resolver module through the ESM runtime path');
  assert(source.includes('validate-configuration'), 'Settings.jsx should call the Marketplace validate action for Test Connection');
  assert(source.includes('supportsValidation'), 'Settings.jsx should wire Marketplace validate metadata');
  assert(source.includes('validatingConnection'), 'Settings.jsx should track a validate-in-progress state');
  assert(source.includes('Test Connection'), 'Settings.jsx should render the Entra Test Connection action');
  assert(source.includes('buildValidationRequestSettings'), 'Settings.jsx should build a validate payload without persisting settings');
  assert(source.includes('testConnection(savedConnectionSettings)'), 'collapsed-state Test Connection should validate the saved snapshot');
  assert(source.includes('testConnection(connectionSettings)'), 'editing-state Test Connection should validate the current unsaved form values');
  assert(!source.includes('Save Settings</button>'), 'Settings.jsx should not keep the old global Save Settings action');
  assert(!source.includes('Validate Configuration'), 'Settings.jsx should not keep the old global Validate Configuration label');
  assert(!source.includes('Change Settings'), 'Settings.jsx should not render a separate Change Settings action');

  assert(source.includes('setting.helpText'), 'Settings.jsx should render field helper text from the schema contract');
  assert(!source.includes('These custom attributes must already exist in Action1 before sync.'), 'Settings.jsx should not keep the older repeated prerequisite copy');
  assert(!source.includes('They must exist in every mapped Action1 organization.'), 'Settings.jsx should not keep the older repeated prerequisite copy');
  assert(!source.includes('If you already use different Action1 custom attribute names, update the values here.'), 'Settings.jsx should remove the older verbose override copy');

  assert(source.includes('Save Connection Settings'), 'Settings.jsx should expose Save Connection Settings inside the Entra card');
  assert(source.includes('Save Attribute Settings'), 'Settings.jsx should expose Save Attribute Settings inside the Action1 card');
  assert(source.includes('{connectionConfigured && connectionEditing ? ('), 'Cancel should only appear while editing an already-configured connection');
  assert(source.includes("groupedSettings['Action1 Custom Attributes']"), 'Settings.jsx should keep the Action1 attribute fields in a separate card');
  assert(!source.includes('Entra Tenant ID:'), 'Settings.jsx should use the concise configured-summary tenant label through the shared resolver');
  assert(!source.includes('Entra Client ID:'), 'Settings.jsx should not show client ID in the configured summary');
  assert(!source.includes('Entra Client Secret: Saved (masked)'), 'Settings.jsx should not show client secret text in the configured summary');
  assert(source.includes('className="btn-primary" type="button" onClick={() => {'), 'collapsed Edit should use the primary button styling');
  assert(source.includes('}}>Edit</button>'), 'collapsed summary should still render an Edit action');
  assert(source.includes('setConnectionValidationResult({'), 'Settings.jsx should keep connection save validation local to the card');
  assert(source.includes('Save Connection Settings</button>'), 'editing mode should keep Save Connection Settings first');
  assert(source.includes("{validatingConnection ? 'Testing connection...' : 'Test Connection'}"), 'Test Connection should show a running label while validation is in progress');
  assert(source.includes("setConnectionValidationResult(null);"), 'editing connection values should clear stale validation feedback');
  assert(source.includes('setConnectionSettings(savedConnectionSettings);'), 'reopening the collapsed connection summary should restore the saved settings snapshot before editing');
  assert(source.includes(') : renderConnectionSummary()}'), 'Settings.jsx should keep a compact collapsed summary branch');
  assert(source.includes('{connectionValidationResult ? ('), 'validation feedback should render regardless of whether the card is collapsed or expanded');
  assert(source.includes('finally {'), 'connection validation should always exit the loading state in a finally block');

  assert(!source.includes('Action1ApiKey'), 'Settings.jsx should not render Action1 credential controls');
  assert(!source.includes('Action1ApiSecret'), 'Settings.jsx should not render Action1 credential controls');
  assert(!source.includes('EntraIdApiUrl'), 'Settings.jsx should not retain the placeholder API URL field');
  assert(!source.includes('EntraIdApiToken'), 'Settings.jsx should not retain the placeholder API token field');
  assert(!source.includes('custom:<name>'), 'Settings.jsx should not render the deferred custom attribute runtime preview');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
