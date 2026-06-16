const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Settings.jsx'), 'utf8').replace(/\r\n/g, '\n');

  const renamedDiscoveryKeys = [
    'HaloPsaTeamId',
    'HaloPsaTicketTypeId',
    'HaloPsaCategory1Id',
    'HaloPsaNewStatusId',
    'HaloPsaClosedStatusIds'
  ];

  for (const key of renamedDiscoveryKeys) {
    assert(source.includes(`'${key}'`), `Settings.jsx should continue using renamed discovery-backed key ${key}`);
  }

  const legacyDiscoveryKeys = [
    'HaloTeamId',
    'HaloTicketTypeId',
    'HaloCategory1Id',
    'HaloNewStatusId',
    'HaloClosedStatusIds'
  ];

  for (const key of legacyDiscoveryKeys) {
    assert(!source.includes(`'${key}'`), `Settings.jsx should not reference legacy discovery-backed key ${key}`);
  }

  assert(source.includes('Use HaloPSA default team'), 'Settings.jsx should offer the explicit Halo default team option');
  assert(source.includes('Use HaloPSA default status'), 'Settings.jsx should offer the explicit Halo default status option');
  assert(source.includes('Use HaloPSA default category'), 'Settings.jsx should offer the explicit Halo default category option');
  assert(source.includes('Select ticket type'), 'Settings.jsx should use a friendly required ticket type placeholder');
  assert(source.includes('CONNECTION_SETTING_KEYS'), 'Settings.jsx should define the required HaloPSA connection-setting keys');
  assert(source.includes('setConnectionExpanded(!CONNECTION_SETTING_KEYS.every'), 'Settings.jsx should expand the connection form by default when required connection settings are absent');
  assert(source.includes('HaloPSA connection configured'), 'Settings.jsx should render the standalone-style compact configured connection state');
  assert(source.includes('Resource Server: {connectionSummaryResourceServer}'), 'Settings.jsx should show a safe Resource Server summary in the collapsed connection state');
  assert(!source.includes('Client Secret:'), 'Settings.jsx should not expose Client Secret in the collapsed connection summary');
  assert(source.includes('Change Settings'), 'Settings.jsx should allow expanding the collapsed connection summary');
  assert(source.includes('cancelConnectionEdit'), 'Settings.jsx should provide a cancel flow for configured connections');
  assert(source.includes('Saved (leave unchanged)'), 'Settings.jsx should preserve masked secret placeholder behavior when editing a configured connection');
  assert(source.includes("if (key === 'HaloPsaClientSecret')"), 'Settings.jsx should treat stored HaloPSA client secret presence as part of configured-state detection');
  assert(source.includes("setSavedSettingsSnapshot(settings);"), 'Settings.jsx should preserve a saved settings snapshot for cancel/revert behavior');
  assert(source.includes("setSettings(savedSettingsSnapshot);"), 'Settings.jsx should restore the saved connection values when canceling edits');
  assert(source.includes("validating ? 'Testing connection...' : 'Test Connection'"), 'Settings.jsx should expose standalone-style connection re-validation controls');
  assert(source.includes('<h3>Ticket Routing &amp; Lifecycle</h3>'), 'Settings.jsx should render the combined Ticket Routing & Lifecycle section title');
  assert(source.includes('<h3>Signal Filters</h3>'), 'Settings.jsx should render one visible Signal Filters section');
  assert(source.includes("if (groupName === 'Lifecycle') {\n            return null;"), 'Settings.jsx should suppress a separate visible Lifecycle section card');
  assert(source.includes("if (groupName === 'Grouped Ticketing' || groupName === 'Operational Safeguards') {\n            return null;"), 'Settings.jsx should suppress separate Grouped Ticketing and Operational Safeguards top-level sections');
  assert(!source.includes('Team (optional)'), 'Settings.jsx should not expose optional wording in the Team label');
  assert(!source.includes('New PSA Ticket Status (optional)'), 'Settings.jsx should not expose optional wording in the New PSA Ticket Status label');
  assert(!source.includes('Category (optional)'), 'Settings.jsx should not expose optional wording in the Category label');
  assert(!source.includes('label: `${name} (${value})`'), 'Settings.jsx should not expose raw Halo IDs in normal discovered option labels');
  assert(source.includes('label: name'), 'Settings.jsx should display readable Halo names only for discovered options');
  assert(source.includes('getMissingValueLabel'), 'Settings.jsx should provide a safe fallback label for unavailable saved values');
  assert(source.includes("type=\"radio\""), 'Settings.jsx should render Existing Open Ticket Behavior as radio choices');
  assert(!source.includes('<select\n        multiple'), 'Settings.jsx should no longer render closed statuses as a native multi-select listbox');
  assert(source.includes('join(\',\')'), 'Settings.jsx should continue storing multi-selected closed statuses as CSV Halo IDs');
  assert(source.includes('parseCsvValues'), 'Settings.jsx should continue parsing stored closed-status CSV values');
  assert(source.includes('Refresh Discovery'), 'Settings.jsx should use the standalone-style refresh discovery label');
  assert(!source.includes('Refresh Halo Options'), 'Settings.jsx should not use the old refresh Halo options label');
  assert(!source.includes('Hold Ctrl or Cmd to select multiple statuses.'), 'Settings.jsx should not rely on native multi-select listbox instructions');
  assert(!source.includes('Close When Signal Clears'), 'Settings.jsx should not expose HaloPsaCloseWhenSignalClears as a visible operator control');
  assert(!source.includes('Create New When Linked Ticket Is Closed'), 'Settings.jsx should not expose HaloPsaCreateNewWhenLinkedClosed as a visible operator control');
  assert(source.includes('HaloPsaResourceServer'), 'Settings.jsx should continue using HaloPsaResourceServer for connection UX');
  assert(source.includes('HaloPsaAuthorisationServer'), 'Settings.jsx should continue using HaloPsaAuthorisationServer for connection UX');
  assert(source.includes('HaloPsaClientId'), 'Settings.jsx should continue using HaloPsaClientId for connection UX');
  assert(source.includes('HaloPsaClientSecret'), 'Settings.jsx should continue using HaloPsaClientSecret for connection UX');
  assert(source.includes('Select a HaloPSA ticket type for Action1-created tickets.'), 'Settings.jsx should include the standalone-style Ticket Routing guidance copy');
  assert(source.includes('INLINE_TOOLTIP_KEYS'), 'Settings.jsx should define the tooltip-backed help-field list for routing and lifecycle fields');
  assert(source.includes('halo-psa-info-tip'), 'Settings.jsx should render standalone-style info tooltip affordances');
  assert(source.includes('title={text}'), 'Settings.jsx should expose help text through hover/focus tooltip behavior');
  assert(!source.includes('Refreshes HaloPSA teams, ticket types, statuses, and categories without saving configuration changes.'), 'Settings.jsx should remove the extra inline discovery helper copy');
  assert(!source.includes('Choose one or more statuses that should be treated as complete or closed.'), 'Settings.jsx should not render always-visible inline closed-status helper copy');
  assert(!source.includes('Phase 3a'), 'Settings.jsx should not expose phase-oriented user-facing copy');
  assert(!source.includes('Phase 3b'), 'Settings.jsx should not expose phase-oriented user-facing copy');
  assert(source.includes('Choose which Action1 endpoint signals should create or maintain HaloPSA tickets.'), 'Settings.jsx should use the standalone-style Signal Filters section copy');
  assert(source.includes('Create ticket after endpoint is offline for at least (days)'), 'Settings.jsx should expose the standalone-style offline signal control label');
  assert(source.includes('Create ticket for reboot required endpoints'), 'Settings.jsx should expose the standalone-style reboot-required signal control label');
  assert(source.includes('Create ticket for automation failures'), 'Settings.jsx should expose the standalone-style automation-failed signal control label');
  assert(source.includes('<h4 style={{ margin: \'0 0 0.8rem\' }}>Vulnerabilities</h4>'), 'Settings.jsx should render the Vulnerabilities signal-filter column');
  assert(source.includes('<h4 style={{ margin: \'0 0 0.8rem\' }}>Missing Updates</h4>'), 'Settings.jsx should render the Missing Updates signal-filter column');
  assert(source.includes('Ticket creation mode'), 'Settings.jsx should render the shared ticket-creation-mode control inside Signal Filters');
  assert(source.includes('Create tickets per issue'), 'Settings.jsx should expose the grouped ticket-creation option inside Signal Filters');
  assert(source.includes('Create tickets per endpoint'), 'Settings.jsx should expose the endpoint ticket-creation option inside Signal Filters');
  assert(source.includes('HaloPsaMaxImpactedEndpointsInGroupedTicket'), 'Settings.jsx should render the grouped-ticket endpoint limit inside Signal Filters');
  assert(source.includes('HaloPsaMaxOpenTicketsPerOrganization'), 'Settings.jsx should render Max Open Tickets Per Organization inside Signal Filters');
  assert(source.includes('deriveSharedSignalTicketModel'), 'Settings.jsx should derive the shared ticket-creation mode from the three HaloPsa ticket-model settings');
  assert(source.includes('setSharedSignalTicketMode'), 'Settings.jsx should write the shared ticket-creation mode back into the three HaloPsa ticket-model settings');
  assert(source.includes('renderCheckboxGroup'), 'Settings.jsx should render standalone-style checkbox groups for severity and remediation filters');
  assert(source.includes('SIGNAL_FILTER_CARD_STYLE'), 'Settings.jsx should define a shared signal-filter card layout style');
  assert(source.includes("gridTemplateRows: 'auto auto 1fr auto auto'"), 'Settings.jsx should use a shared grid layout to vertically align signal-filter remediation headings');
  assert(source.includes("alignItems: 'stretch'"), 'Settings.jsx should stretch the signal-filter card row for consistent internal alignment');
  assert(source.includes('formatEnumLabel'), 'Settings.jsx should format enum-style signal-filter labels for user-facing display');
  assert(source.includes('split(\'_\')'), 'Settings.jsx should derive readable signal-filter labels from stored enum values');
  assert(source.includes('<span>{formatEnumLabel(option)}</span>'), 'Settings.jsx should display readable labels such as Due Soon in signal-filter checkbox groups');
  assert(source.includes("'DUE_SOON'"), 'Settings.jsx should keep the underlying remediation status value identifiers unchanged');
  assert(!source.includes('Automation Failed Lookback Hours'), 'Settings.jsx should not expose the internal automation-failed lookback setting');
  assert(!source.includes('Vulnerability Signal Enabled'), 'Settings.jsx should not expose the standalone-hidden vulnerability enabled toggle');
  assert(!source.includes('Update Signal Enabled'), 'Settings.jsx should not expose the standalone-hidden update enabled toggle');
  assert(source.includes('LIGHT_RADIO_CARD_STYLE'), 'Settings.jsx should share a lighter radio-card style across settings sections for visual consistency');
  assert(source.includes("border: currentValue === option.value ? '1px solid #CBD5E1' : '1px solid var(--border-color)'"), 'Settings.jsx should use the lighter selected-radio treatment for Existing Open Ticket Behavior');
  assert(!source.includes("background: currentValue === option.value ? '#EFF6FF' : '#fff'"), 'Settings.jsx should not use the older heavier selected-radio background treatment for Existing Open Ticket Behavior');
  assert(source.includes("width: '100%', maxWidth: 820, margin: '0 auto'"), 'Settings.jsx should use the same centered wrapper convention as Mapping');
  assert(source.includes('halo-psa-settings-bottom-spacer'), 'Settings.jsx should render an explicit bottom spacer before the shared Save Settings button');
  assert(source.includes("style={{ height: 32 }}"), 'Settings.jsx should give the explicit bottom spacer a visible fixed height');

  const teamIndex = source.indexOf("[teamField, ticketTypeField]");
  const statusIndex = source.indexOf("[newStatusField, categoryField]");
  const closedIndex = source.indexOf('closedStatusesField &&');
  const lifecycleIndex = source.indexOf('renderField(lifecycleSetting)');
  const refreshIndex = source.indexOf('Refresh Discovery');
  assert(teamIndex !== -1 && statusIndex !== -1 && closedIndex !== -1, 'Settings.jsx should define the standalone routing field rows');
  assert(teamIndex < statusIndex && statusIndex < closedIndex, 'Settings.jsx should order routing fields as Team/Ticket Type, then New Status/Category, then Complete / Closed Statuses');
  assert(lifecycleIndex !== -1 && closedIndex < lifecycleIndex, 'Settings.jsx should place Existing Open Ticket Behavior below the routing controls');
  assert(refreshIndex !== -1 && lifecycleIndex < refreshIndex, 'Settings.jsx should place Refresh Discovery below the lifecycle radio choices');

  const collapsedConnectionIndex = source.indexOf('HaloPSA connection configured');
  const changeSettingsIndex = source.indexOf('Change Settings');
  const collapsedSummaryEnd = source.indexOf('{validationResult &&', collapsedConnectionIndex);
  const collapsedSummarySlice = collapsedConnectionIndex === -1 ? '' : source.slice(collapsedConnectionIndex, collapsedSummaryEnd === -1 ? undefined : collapsedSummaryEnd);
  assert(collapsedConnectionIndex !== -1 && changeSettingsIndex !== -1, 'Settings.jsx should include the collapsed connection summary and change-settings control');
  assert(collapsedConnectionIndex < changeSettingsIndex, 'Settings.jsx should place Change Settings inside the collapsed connection summary');
  assert(collapsedSummarySlice.includes("validating ? 'Testing connection...' : 'Test Connection'"), 'Settings.jsx should keep connection re-validation available from the collapsed summary');

  const signalFiltersIndex = source.indexOf('<h3>Signal Filters</h3>');
  const ticketModeIndex = source.indexOf('Ticket creation mode');
  const signalFiltersBlockStart = source.indexOf('const renderSignalFiltersSection = (fields) => {');
  const signalFiltersBlockEnd = source.indexOf('const renderSettingControl = (setting) => {', signalFiltersBlockStart);
  const signalFiltersBlock = signalFiltersBlockStart === -1 ? '' : source.slice(signalFiltersBlockStart, signalFiltersBlockEnd === -1 ? undefined : signalFiltersBlockEnd);
  const bottomSpacerIndex = source.indexOf('halo-psa-settings-bottom-spacer');
  const finalSaveButtonIndex = source.lastIndexOf('<button className="btn-primary" type="submit">Save Settings</button>');
  assert(signalFiltersIndex !== -1 && ticketModeIndex !== -1, 'Settings.jsx should include Signal Filters and ticket mode together');
  assert(signalFiltersBlock.includes('Ticket creation mode'), 'Settings.jsx should place grouped ticket mode inside the Signal Filters section renderer');
  assert(signalFiltersBlock.includes('HaloPsaMaxOpenTicketsPerOrganization'), 'Settings.jsx should place max-open safeguards inside the Signal Filters section renderer');
  assert(bottomSpacerIndex !== -1 && finalSaveButtonIndex !== -1 && bottomSpacerIndex < finalSaveButtonIndex, 'Settings.jsx should place the explicit bottom spacer before the final Save Settings action');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
