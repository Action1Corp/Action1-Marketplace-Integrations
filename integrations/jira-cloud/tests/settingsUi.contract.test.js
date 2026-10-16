const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Settings.jsx'), 'utf8').replace(/\r\n/g, '\n');

  assert(source.includes('const pageStyles = {'), 'Settings.jsx should define a shared page-shell style object');
  assert(source.includes("width: '100%'"), 'Settings.jsx should use the shared full-width page shell');
  assert(source.includes("maxWidth: 820"), 'Settings.jsx should use the shared centered max-width page shell');
  assert(source.includes("margin: '0 auto'"), 'Settings.jsx should center the page shell like HaloPSA pages');
  assert(source.includes("display: 'grid',\n    gap: '0.5rem'"), 'Settings.jsx should use the shared page-shell grid spacing convention');
  assert(source.includes("form: {\n    display: 'grid',\n    gap: '0.5rem'\n  }"), 'Settings.jsx should keep the Halo-style top-level form shell');
  assert(source.includes("cardTitle: {\n    margin: 0,\n    fontSize: '1.125rem'"), 'Settings.jsx should define the shared section-heading typography baseline');

  assert(source.includes('<h1 className="page-title" style={pageStyles.title}>Settings</h1>'), 'Settings.jsx should render a page-level Settings title');
  assert(source.includes('Configure the Jira Cloud API connection, Action1 signal behavior, ticket model, operational safeguards, and diagnostics used by this integration.'), 'Settings.jsx should keep the Jira settings intro copy');
  assert(source.includes('Jira Cloud API Configuration'), 'Settings.jsx should render the Jira API configuration card');
  assert(source.includes('Action1 Signals'), 'Settings.jsx should render the Action1 Signals card');
  assert(source.includes('Ticket Model'), 'Settings.jsx should render the Ticket Model card');
  assert(source.includes('Issue Handling'), 'Settings.jsx should render the Issue Handling card');
  assert(!source.includes('>Operational Safeguards<'), 'Settings.jsx should not render the old Operational Safeguards title');
  assert(source.includes('Diagnostics'), 'Settings.jsx should render the Diagnostics card');

  assert(source.includes('Jira Cloud connection configured'), 'Settings.jsx should render the compact configured connection state');
  assert(source.includes('Jira Site URL: {connectionSummarySiteUrl}'), 'Settings.jsx should show a safe Jira Site URL summary in the collapsed connection state');
  assert(!source.includes('API Token:'), 'Settings.jsx should not expose the API token in the collapsed connection summary');
  assert(source.includes('Saved (leave unchanged)'), 'Settings.jsx should preserve masked secret placeholder behavior when editing a configured connection');
  assert(source.includes("if (key === 'JiraCloudApiToken')"), 'Settings.jsx should treat stored Jira API token presence as part of configured-state detection');
  assert(source.includes('setSavedSettingsSnapshot(settings);'), 'Settings.jsx should preserve a saved settings snapshot for cancel/revert behavior');
  assert(source.includes('setSettings(savedSettingsSnapshot);'), 'Settings.jsx should restore the saved connection values when canceling edits');

  assert(source.includes('JiraCloudSiteUrl'), 'Settings.jsx should render the Jira Site URL field');
  assert(source.includes('JiraCloudUserEmail'), 'Settings.jsx should render the Atlassian account email field');
  assert(source.includes('JiraCloudApiToken'), 'Settings.jsx should render the Atlassian API token field');
  assert(source.includes('JiraCloudOfflineEnabled'), 'Settings.jsx should render offline signal controls');
  assert(source.includes('Create issue after endpoint is offline for at least (days)'), 'Settings.jsx should render the compact offline checkbox label');
  assert(!source.includes('>{offlineThresholdSetting.label}<'), 'Settings.jsx should not render a standalone Offline Threshold Days label');
  assert(source.includes('JiraCloudRebootRequiredEnabled'), 'Settings.jsx should render reboot-required signal controls');
  assert(source.includes('JiraCloudVulnerabilitySeverities'), 'Settings.jsx should render vulnerability filter controls');
  assert(source.includes('JiraCloudUpdateSeverities'), 'Settings.jsx should render update filter controls');
  assert(source.includes('JiraCloudVulnerabilitySeveritiesExplicit'), 'Settings.jsx should record explicit vulnerability severity selection');
  assert(source.includes('JiraCloudVulnerabilityRemediationStatusesExplicit'), 'Settings.jsx should record explicit vulnerability remediation selection');
  assert(source.includes('JiraCloudUpdateSeveritiesExplicit'), 'Settings.jsx should record explicit update severity selection');
  assert(source.includes('JiraCloudUpdateRemediationStatusesExplicit'), 'Settings.jsx should record explicit update remediation selection');
  assert(source.includes("nextSettings[emptySelectionMarkerKey] = 'true';"), 'Settings.jsx should preserve explicit empty multi-select intent');
  assert(source.includes('JiraCloudVulnerabilityTicketModel'), 'Settings.jsx should render vulnerability ticket model controls');
  assert(source.includes('JiraCloudUpdateTicketModel'), 'Settings.jsx should render update ticket model controls');
  assert(source.includes('JiraCloudAutomationFailedTicketModel'), 'Settings.jsx should render automation failed ticket model controls');
  assert(source.includes('JiraCloudMaxImpactedEndpointsInGroupedTicket'), 'Settings.jsx should render grouped impacted endpoint limit controls');
  assert(source.includes('JiraCloudExistingOpenIssueBehavior'), 'Settings.jsx should render existing open issue behavior controls');
  assert(source.includes('JiraCloudMaxOpenTicketsPerOrganization'), 'Settings.jsx should render max open issues per organization controls');
  assert(source.includes('Choose how linked Jira issues are maintained and limit how many open issues Action1 may keep per mapped organization.'), 'Settings.jsx should render the cleaner Issue Handling description');
  assert(source.includes("style={{ width: 120, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6 }}"), 'Settings.jsx should render the max open issues input with the compact numeric-input width');
  assert(source.includes('JiraCloudDiagnosticLoggingEnabled'), 'Settings.jsx should render diagnostic logging controls');
  assert(source.includes('<span>{setting.label}</span>'), 'Settings.jsx should render the diagnostics checkbox label from the Jira settings schema');
  assert(source.includes("fontWeight: 500"), 'Settings.jsx should use normal checkbox-label weight for inline controls');
  assert(source.includes('halo-psa-info-tip'), 'Settings.jsx should reuse the Halo-style info tooltip affordance');
  assert(source.includes('title={text}'), 'Settings.jsx should expose help text through hover/focus tooltip behavior');
  assert(source.includes('Save Settings'), 'Settings.jsx should keep the shared Save Settings action');
  assert(source.includes("validating ? 'Testing connection...' : 'Test Connection'"), 'Settings.jsx should expose Halo-style connection validation controls');

  assert(!source.includes('JiraCloudProjectId'), 'Settings.jsx should not expose Jira Project settings');
  assert(!source.includes('JiraCloudProjectKey'), 'Settings.jsx should not expose Jira Project settings');
  assert(!source.includes('JiraCloudIssueTypeId'), 'Settings.jsx should not expose Jira Issue Type settings');
  assert(!source.includes('JiraCloudIssueTypeName'), 'Settings.jsx should not expose Jira Issue Type settings');
  assert(!source.includes('Action1ApiKey'), 'Settings.jsx should not expose Action1 credentials');
  assert(!source.includes('Action1ApiSecret'), 'Settings.jsx should not expose Action1 credentials');
  assert(!source.includes('Ticket Type'), 'Settings.jsx should not copy HaloPSA Ticket Type into Jira settings');
  assert(!source.includes('Team'), 'Settings.jsx should not copy HaloPSA Team into Jira settings');
  assert(!source.includes('Category'), 'Settings.jsx should not copy HaloPSA Category into Jira settings');
  assert(!source.includes('New Ticket Status'), 'Settings.jsx should not copy HaloPSA status-routing settings into Jira settings');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
