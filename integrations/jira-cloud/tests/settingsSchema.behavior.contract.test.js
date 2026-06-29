const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));

  assert.strictEqual(byKey.get('JiraCloudVulnerabilityTicketModel').group, 'Ticket Model');
  assert.strictEqual(byKey.get('JiraCloudUpdateTicketModel').group, 'Ticket Model');
  assert.strictEqual(byKey.get('JiraCloudAutomationFailedTicketModel').group, 'Ticket Model');
  assert.strictEqual(byKey.get('JiraCloudMaxImpactedEndpointsInGroupedTicket').group, 'Ticket Model');
  assert.strictEqual(byKey.get('JiraCloudMaxOpenTicketsPerOrganization').group, 'Operational Safeguards');
  assert.strictEqual(byKey.get('JiraCloudDiagnosticLoggingEnabled').group, 'Diagnostics');

  assert.strictEqual(byKey.get('JiraCloudExistingOpenIssueBehavior').defaultValue, 'update_existing_open');
  assert.notStrictEqual(byKey.get('JiraCloudExistingOpenIssueBehavior').visible, false, 'existing open issue behavior should be operator-configurable');
  assert.strictEqual(byKey.get('JiraCloudCloseWhenSignalClears').defaultValue, 'false', 'Jira close behavior should stay disabled');
  assert.strictEqual(byKey.get('JiraCloudCreateNewWhenLinkedCompleted').defaultValue, 'true', 'completed linked issues should default to create-new semantics');

  const forbiddenWords = ['Project', 'Issue Type', 'Ticket Type', 'Team', 'Category', 'Status'];
  for (const key of ['JiraCloudExistingOpenIssueBehavior', 'JiraCloudMaxOpenTicketsPerOrganization', 'JiraCloudDiagnosticLoggingEnabled']) {
    const label = String(byKey.get(key)?.label || '');
    assert(forbiddenWords.every((word) => !label.includes(word) || word === 'Status' && key === 'JiraCloudExistingOpenIssueBehavior'), `${key} should not reintroduce Halo destination routing labels`);
  }
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
