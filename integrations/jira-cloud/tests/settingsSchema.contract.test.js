const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const groups = new Set(settingsSchema.map((row) => row.group));

  const connectionKeys = [
    'JiraCloudSiteUrl',
    'JiraCloudUserEmail',
    'JiraCloudApiToken'
  ];
  const behaviorKeys = [
    'JiraCloudExistingOpenIssueBehavior',
    'JiraCloudCloseWhenSignalClears',
    'JiraCloudCreateNewWhenLinkedCompleted',
    'JiraCloudOfflineEnabled',
    'JiraCloudOfflineThresholdDays',
    'JiraCloudRebootRequiredEnabled',
    'JiraCloudAutomationFailedEnabled',
    'JiraCloudAutomationFailedLookbackHours',
    'JiraCloudVulnerabilityEnabled',
    'JiraCloudVulnerabilitySeverities',
    'JiraCloudVulnerabilityRemediationStatuses',
    'JiraCloudUpdateEnabled',
    'JiraCloudUpdateSeverities',
    'JiraCloudUpdateRemediationStatuses',
    'JiraCloudVulnerabilityTicketModel',
    'JiraCloudUpdateTicketModel',
    'JiraCloudAutomationFailedTicketModel',
    'JiraCloudMaxImpactedEndpointsInGroupedTicket',
    'JiraCloudMaxOpenTicketsPerOrganization',
    'JiraCloudDiagnosticLoggingEnabled'
  ];

  for (const key of connectionKeys) {
    assert(byKey.has(key), `${key} should exist in Jira settings schema`);
    assert.strictEqual(byKey.get(key).required, true, `${key} should be required`);
  }

  for (const key of behaviorKeys) {
    assert(byKey.has(key), `${key} should exist in Jira settings schema`);
  }

  for (const groupName of ['Jira Cloud Configuration', 'Action1 Signals', 'Ticket Model', 'Operational Safeguards', 'Diagnostics']) {
    assert(groups.has(groupName), `${groupName} should be represented in the Jira settings schema`);
  }

  assert.strictEqual(byKey.get('JiraCloudSiteUrl').label, 'Jira Site URL');
  assert.strictEqual(byKey.get('JiraCloudUserEmail').label, 'Atlassian Account Email');
  assert.strictEqual(byKey.get('JiraCloudApiToken').label, 'Atlassian API Token');
  assert.strictEqual(byKey.get('JiraCloudApiToken').type, 'secret');
  assert.strictEqual(byKey.get('JiraCloudExistingOpenIssueBehavior').defaultValue, 'update_existing_open');
  assert.strictEqual(byKey.get('JiraCloudCloseWhenSignalClears').defaultValue, 'false');
  assert.strictEqual(byKey.get('JiraCloudCreateNewWhenLinkedCompleted').defaultValue, 'true');
  assert.strictEqual(byKey.get('JiraCloudOfflineEnabled').defaultValue, 'true');
  assert.strictEqual(byKey.get('JiraCloudOfflineThresholdDays').defaultValue, '7');
  assert.strictEqual(byKey.get('JiraCloudRebootRequiredEnabled').defaultValue, 'true');
  assert.strictEqual(byKey.get('JiraCloudAutomationFailedEnabled').defaultValue, 'true');
  assert.strictEqual(byKey.get('JiraCloudAutomationFailedLookbackHours').defaultValue, '24');
  assert.strictEqual(byKey.get('JiraCloudVulnerabilitySeverities').defaultValue, 'CRITICAL,HIGH');
  assert.strictEqual(byKey.get('JiraCloudVulnerabilityRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON');
  assert.strictEqual(byKey.get('JiraCloudUpdateSeverities').defaultValue, 'CRITICAL,IMPORTANT');
  assert.strictEqual(byKey.get('JiraCloudUpdateRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON');
  assert.strictEqual(byKey.get('JiraCloudVulnerabilityTicketModel').defaultValue, 'grouped');
  assert.strictEqual(byKey.get('JiraCloudUpdateTicketModel').defaultValue, 'grouped');
  assert.strictEqual(byKey.get('JiraCloudAutomationFailedTicketModel').defaultValue, 'grouped');
  assert.strictEqual(byKey.get('JiraCloudMaxImpactedEndpointsInGroupedTicket').defaultValue, '25');
  assert.strictEqual(byKey.get('JiraCloudMaxImpactedEndpointsInGroupedTicket').min, 1);
  assert.strictEqual(byKey.get('JiraCloudMaxImpactedEndpointsInGroupedTicket').max, 100);
  assert.strictEqual(byKey.get('JiraCloudMaxOpenTicketsPerOrganization').defaultValue, '30');
  assert.strictEqual(byKey.get('JiraCloudDiagnosticLoggingEnabled').defaultValue, 'false');

  assert.strictEqual(byKey.get('JiraCloudCloseWhenSignalClears').visible, false, 'closeWhenSignalClears should remain hidden');
  assert.strictEqual(byKey.get('JiraCloudCreateNewWhenLinkedCompleted').visible, false, 'createNewWhenLinkedCompleted should remain hidden');
  assert.strictEqual(byKey.get('JiraCloudAutomationFailedLookbackHours').visible, false, 'automation failed lookback should remain hidden');
  assert.strictEqual(byKey.get('JiraCloudVulnerabilityEnabled').visible, false, 'vulnerability enabled should remain hidden');
  assert.strictEqual(byKey.get('JiraCloudUpdateEnabled').visible, false, 'update enabled should remain hidden');

  assert(settingsSchema.every((row) => String(row.key || '').startsWith('JiraCloud')), 'every Jira durable settings key should start with JiraCloud');
  assert.strictEqual(settingsSchema.some((row) => /^Action1/i.test(String(row.key || ''))), false, 'Jira settings schema should not declare Action1 credential keys');

  for (const forbiddenKey of [
    'JiraCloudProjectId',
    'JiraCloudProjectKey',
    'JiraCloudIssueTypeId',
    'JiraCloudIssueTypeName',
    'HaloPsaTicketTypeId',
    'HaloPsaTeamId',
    'HaloPsaNewStatusId',
    'HaloPsaCategory1Id',
    'Action1ApiKey',
    'Action1ApiSecret'
  ]) {
    assert.strictEqual(byKey.has(forbiddenKey), false, `${forbiddenKey} should not exist in Jira settings schema`);
  }

  const labels = [
    byKey.get('JiraCloudExistingOpenIssueBehavior').label,
    byKey.get('JiraCloudMaxOpenTicketsPerOrganization').label
  ];
  assert(labels.every((label) => !/\bID\b/.test(label)), 'Jira settings labels should stay operator-facing');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
