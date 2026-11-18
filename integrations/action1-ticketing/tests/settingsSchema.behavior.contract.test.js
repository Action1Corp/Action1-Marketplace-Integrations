const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const providerOwnedLegacyKeys = [
    'TicketingResourceServer',
    'TicketingAuthorisationServer',
    'TicketingClientId', 'TicketingClientSecret', 'TicketingTeamId', 'TicketingTicketTypeId',
    'TicketingCategory1Id', 'TicketingNewStatusId', 'TicketingClosedStatusIds'
  ];
  const groups = new Set(settingsSchema.map((row) => row.group));
  const behaviorKeys = [
    'TicketingExistingOpenTicketBehavior',
    'TicketingCloseWhenSignalClears',
    'TicketingCreateNewWhenLinkedClosed',
    'TicketingOfflineEnabled',
    'TicketingOfflineThresholdDays',
    'TicketingRebootRequiredEnabled',
    'TicketingRebootRequiredAgeThresholdEnabled',
    'TicketingRebootRequiredAgeThresholdDays',
    'TicketingAutomationFailedEnabled',
    'TicketingAutomationFailedLookbackHours',
    'TicketingVulnerabilityEnabled',
    'TicketingVulnerabilitySeverities',
    'TicketingVulnerabilityRemediationStatuses',
    'TicketingUpdateEnabled',
    'TicketingUpdateSeverities',
    'TicketingUpdateRemediationStatuses',
    'TicketingVulnerabilityTicketModel',
    'TicketingUpdateTicketModel',
    'TicketingAutomationFailedTicketModel',
    'TicketingMaxImpactedEndpointsInGroupedTicket',
    'TicketingMaxOpenTicketsPerOrganization',
    'TicketingDiagnosticLoggingEnabled'
  ];

  for (const key of providerOwnedLegacyKeys) assert.strictEqual(byKey.has(key), false, `${key} must not remain in common settings`);
  assert.strictEqual(byKey.get('TicketingActiveProvider').type, 'text', 'active provider selection is declared as a non-secret setting');

  for (const key of behaviorKeys) {
    assert(byKey.has(key), `${key} should exist in Action1 Ticketing behavior settings schema`);
  }

  for (const groupName of ['Lifecycle', 'Signal Filters', 'Diagnostics']) {
    assert(groups.has(groupName), `${groupName} should be represented in the Action1 Ticketing settings schema`);
  }
  assert.strictEqual(groups.has('Grouped Ticketing'), false, 'Grouped Ticketing should no longer be a separate settings schema group');
  assert.strictEqual(groups.has('Operational Safeguards'), false, 'Operational Safeguards should no longer be a separate settings schema group');

  assert.strictEqual(byKey.get('TicketingExistingOpenTicketBehavior').defaultValue, 'update_existing_open', 'TicketingExistingOpenTicketBehavior should default to update_existing_open');
  assert.strictEqual(byKey.get('TicketingCloseWhenSignalClears').defaultValue, 'true', 'TicketingCloseWhenSignalClears should default to true');
  assert.strictEqual(byKey.get('TicketingCreateNewWhenLinkedClosed').defaultValue, 'true', 'TicketingCreateNewWhenLinkedClosed should default to true');
  assert.strictEqual(byKey.get('TicketingOfflineEnabled').defaultValue, 'true', 'TicketingOfflineEnabled should default to true');
  assert.strictEqual(byKey.get('TicketingOfflineThresholdDays').defaultValue, '7', 'TicketingOfflineThresholdDays should default to 7');
  assert.strictEqual(byKey.get('TicketingRebootRequiredEnabled').defaultValue, 'true', 'TicketingRebootRequiredEnabled should default to true');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdEnabled').defaultValue, 'false', 'TicketingRebootRequiredAgeThresholdEnabled should default to disabled');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdDays').defaultValue, '30', 'TicketingRebootRequiredAgeThresholdDays should default to 30');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdDays').min, 1, 'TicketingRebootRequiredAgeThresholdDays should represent a minimum of 1');
  assert.strictEqual(byKey.get('TicketingAutomationFailedEnabled').defaultValue, 'true', 'TicketingAutomationFailedEnabled should default to true');
  assert.strictEqual(byKey.get('TicketingAutomationFailedLookbackHours').defaultValue, '24', 'TicketingAutomationFailedLookbackHours should default to 24');
  assert.strictEqual(byKey.get('TicketingVulnerabilityEnabled').defaultValue, 'true', 'TicketingVulnerabilityEnabled should default to true');
  assert.strictEqual(byKey.get('TicketingVulnerabilitySeverities').defaultValue, 'CRITICAL,HIGH', 'TicketingVulnerabilitySeverities should use the Phase 3a text default');
  assert.strictEqual(byKey.get('TicketingVulnerabilityRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON', 'TicketingVulnerabilityRemediationStatuses should use the Phase 3a text default');
  assert.strictEqual(byKey.get('TicketingUpdateEnabled').defaultValue, 'true', 'TicketingUpdateEnabled should default to true');
  assert.strictEqual(byKey.get('TicketingUpdateSeverities').defaultValue, 'CRITICAL,IMPORTANT', 'TicketingUpdateSeverities should use the Phase 3a text default');
  assert.strictEqual(byKey.get('TicketingUpdateRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON', 'TicketingUpdateRemediationStatuses should use the Phase 3a text default');
  assert.strictEqual(byKey.get('TicketingVulnerabilityTicketModel').defaultValue, 'grouped', 'TicketingVulnerabilityTicketModel should default to grouped');
  assert.strictEqual(byKey.get('TicketingUpdateTicketModel').defaultValue, 'grouped', 'TicketingUpdateTicketModel should default to grouped');
  assert.strictEqual(byKey.get('TicketingAutomationFailedTicketModel').defaultValue, 'grouped', 'TicketingAutomationFailedTicketModel should default to grouped');
  assert.strictEqual(byKey.get('TicketingMaxImpactedEndpointsInGroupedTicket').defaultValue, '25', 'TicketingMaxImpactedEndpointsInGroupedTicket should default to 25');
  assert.strictEqual(byKey.get('TicketingMaxImpactedEndpointsInGroupedTicket').min, 1, 'TicketingMaxImpactedEndpointsInGroupedTicket should represent a minimum of 1');
  assert.strictEqual(byKey.get('TicketingMaxImpactedEndpointsInGroupedTicket').max, 100, 'TicketingMaxImpactedEndpointsInGroupedTicket should represent a maximum of 100');
  assert.strictEqual(byKey.get('TicketingMaxOpenTicketsPerOrganization').defaultValue, '30', 'TicketingMaxOpenTicketsPerOrganization should default to 30');
  assert.strictEqual(byKey.get('TicketingDiagnosticLoggingEnabled').defaultValue, 'false', 'TicketingDiagnosticLoggingEnabled should default to disabled');
  assert.strictEqual(byKey.get('TicketingCloseWhenSignalClears').visible, false, 'TicketingCloseWhenSignalClears should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('TicketingCreateNewWhenLinkedClosed').visible, false, 'TicketingCreateNewWhenLinkedClosed should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('TicketingAutomationFailedLookbackHours').visible, false, 'TicketingAutomationFailedLookbackHours should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('TicketingVulnerabilityEnabled').visible, false, 'TicketingVulnerabilityEnabled should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('TicketingUpdateEnabled').visible, false, 'TicketingUpdateEnabled should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('TicketingVulnerabilityTicketModel').group, 'Signal Filters', 'TicketingVulnerabilityTicketModel should now live under Signal Filters');
  assert.strictEqual(byKey.get('TicketingUpdateTicketModel').group, 'Signal Filters', 'TicketingUpdateTicketModel should now live under Signal Filters');
  assert.strictEqual(byKey.get('TicketingAutomationFailedTicketModel').group, 'Signal Filters', 'TicketingAutomationFailedTicketModel should now live under Signal Filters');
  assert.strictEqual(byKey.get('TicketingMaxImpactedEndpointsInGroupedTicket').group, 'Signal Filters', 'TicketingMaxImpactedEndpointsInGroupedTicket should now live under Signal Filters');
  assert.strictEqual(byKey.get('TicketingMaxOpenTicketsPerOrganization').group, 'Signal Filters', 'TicketingMaxOpenTicketsPerOrganization should now live under Signal Filters');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdEnabled').group, 'Signal Filters', 'TicketingRebootRequiredAgeThresholdEnabled should live under Signal Filters');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdDays').group, 'Signal Filters', 'TicketingRebootRequiredAgeThresholdDays should live under Signal Filters');

  assert.strictEqual(byKey.has('HaloTenant'), false, 'HaloTenant should not exist in Action1 Ticketing settings schema');
  assert(settingsSchema.every((row) => String(row.key || '').startsWith('Ticketing')), 'every Action1 Ticketing durable settings key should start with Ticketing');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'Action1 Ticketing settings schema should not declare Action1 credential keys');

  const schedulerKeys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Cron(?:Schedule|Timezone)/.test(key));
  assert.strictEqual(schedulerKeys.length, 0, 'Phase 3a should not introduce scheduler keys');

  const removedLegacyKeys = [
    'ExistingOpenTicketBehavior',
    'CloseWhenSignalClears',
    'CreateNewWhenLinkedClosed',
    'OfflineEnabled',
    'VulnerabilityEnabled',
    'UpdateEnabled',
    'MaxOpenTicketsPerOrganization'
  ];
  for (const key of removedLegacyKeys) {
    assert.strictEqual(byKey.has(key), false, `${key} should be absent after the Ticketing key rename`);
  }

  assert(!settingsSchema.some((row) => /\bHalo\b/i.test(row.label)), 'common settings must not expose vendor-specific destination fields');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
