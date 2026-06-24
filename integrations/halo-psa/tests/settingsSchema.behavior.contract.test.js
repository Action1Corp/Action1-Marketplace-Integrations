const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const connectionKeys = [
    'HaloPsaResourceServer',
    'HaloPsaAuthorisationServer',
    'HaloPsaClientId',
    'HaloPsaClientSecret'
  ];
  const groups = new Set(settingsSchema.map((row) => row.group));
  const behaviorKeys = [
    'HaloPsaTeamId',
    'HaloPsaTicketTypeId',
    'HaloPsaCategory1Id',
    'HaloPsaNewStatusId',
    'HaloPsaClosedStatusIds',
    'HaloPsaExistingOpenTicketBehavior',
    'HaloPsaCloseWhenSignalClears',
    'HaloPsaCreateNewWhenLinkedClosed',
    'HaloPsaOfflineEnabled',
    'HaloPsaOfflineThresholdDays',
    'HaloPsaRebootRequiredEnabled',
    'HaloPsaAutomationFailedEnabled',
    'HaloPsaAutomationFailedLookbackHours',
    'HaloPsaVulnerabilityEnabled',
    'HaloPsaVulnerabilitySeverities',
    'HaloPsaVulnerabilityRemediationStatuses',
    'HaloPsaUpdateEnabled',
    'HaloPsaUpdateSeverities',
    'HaloPsaUpdateRemediationStatuses',
    'HaloPsaVulnerabilityTicketModel',
    'HaloPsaUpdateTicketModel',
    'HaloPsaAutomationFailedTicketModel',
    'HaloPsaMaxImpactedEndpointsInGroupedTicket',
    'HaloPsaMaxOpenTicketsPerOrganization',
    'HaloPsaDiagnosticLoggingEnabled'
  ];

  for (const key of connectionKeys) {
    assert(byKey.has(key), `${key} should continue to exist in HaloPSA settings schema`);
  }

  for (const key of behaviorKeys) {
    assert(byKey.has(key), `${key} should exist in HaloPSA behavior settings schema`);
  }

  for (const groupName of ['HaloPSA Configuration', 'Ticket Routing', 'Lifecycle', 'Signal Filters', 'Diagnostics']) {
    assert(groups.has(groupName), `${groupName} should be represented in the HaloPSA settings schema`);
  }
  assert.strictEqual(groups.has('Grouped Ticketing'), false, 'Grouped Ticketing should no longer be a separate settings schema group');
  assert.strictEqual(groups.has('Operational Safeguards'), false, 'Operational Safeguards should no longer be a separate settings schema group');

  assert.strictEqual(byKey.get('HaloPsaExistingOpenTicketBehavior').defaultValue, 'update_existing_open', 'HaloPsaExistingOpenTicketBehavior should default to update_existing_open');
  assert.strictEqual(byKey.get('HaloPsaCloseWhenSignalClears').defaultValue, 'true', 'HaloPsaCloseWhenSignalClears should default to true');
  assert.strictEqual(byKey.get('HaloPsaCreateNewWhenLinkedClosed').defaultValue, 'true', 'HaloPsaCreateNewWhenLinkedClosed should default to true');
  assert.strictEqual(byKey.get('HaloPsaOfflineEnabled').defaultValue, 'true', 'HaloPsaOfflineEnabled should default to true');
  assert.strictEqual(byKey.get('HaloPsaOfflineThresholdDays').defaultValue, '7', 'HaloPsaOfflineThresholdDays should default to 7');
  assert.strictEqual(byKey.get('HaloPsaRebootRequiredEnabled').defaultValue, 'true', 'HaloPsaRebootRequiredEnabled should default to true');
  assert.strictEqual(byKey.get('HaloPsaAutomationFailedEnabled').defaultValue, 'true', 'HaloPsaAutomationFailedEnabled should default to true');
  assert.strictEqual(byKey.get('HaloPsaAutomationFailedLookbackHours').defaultValue, '24', 'HaloPsaAutomationFailedLookbackHours should default to 24');
  assert.strictEqual(byKey.get('HaloPsaVulnerabilityEnabled').defaultValue, 'true', 'HaloPsaVulnerabilityEnabled should default to true');
  assert.strictEqual(byKey.get('HaloPsaVulnerabilitySeverities').defaultValue, 'CRITICAL,HIGH', 'HaloPsaVulnerabilitySeverities should use the Phase 3a text default');
  assert.strictEqual(byKey.get('HaloPsaVulnerabilityRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON', 'HaloPsaVulnerabilityRemediationStatuses should use the Phase 3a text default');
  assert.strictEqual(byKey.get('HaloPsaUpdateEnabled').defaultValue, 'true', 'HaloPsaUpdateEnabled should default to true');
  assert.strictEqual(byKey.get('HaloPsaUpdateSeverities').defaultValue, 'CRITICAL,IMPORTANT', 'HaloPsaUpdateSeverities should use the Phase 3a text default');
  assert.strictEqual(byKey.get('HaloPsaUpdateRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON', 'HaloPsaUpdateRemediationStatuses should use the Phase 3a text default');
  assert.strictEqual(byKey.get('HaloPsaVulnerabilityTicketModel').defaultValue, 'grouped', 'HaloPsaVulnerabilityTicketModel should default to grouped');
  assert.strictEqual(byKey.get('HaloPsaUpdateTicketModel').defaultValue, 'grouped', 'HaloPsaUpdateTicketModel should default to grouped');
  assert.strictEqual(byKey.get('HaloPsaAutomationFailedTicketModel').defaultValue, 'grouped', 'HaloPsaAutomationFailedTicketModel should default to grouped');
  assert.strictEqual(byKey.get('HaloPsaMaxImpactedEndpointsInGroupedTicket').defaultValue, '25', 'HaloPsaMaxImpactedEndpointsInGroupedTicket should default to 25');
  assert.strictEqual(byKey.get('HaloPsaMaxImpactedEndpointsInGroupedTicket').min, 1, 'HaloPsaMaxImpactedEndpointsInGroupedTicket should represent a minimum of 1');
  assert.strictEqual(byKey.get('HaloPsaMaxImpactedEndpointsInGroupedTicket').max, 100, 'HaloPsaMaxImpactedEndpointsInGroupedTicket should represent a maximum of 100');
  assert.strictEqual(byKey.get('HaloPsaMaxOpenTicketsPerOrganization').defaultValue, '30', 'HaloPsaMaxOpenTicketsPerOrganization should default to 30');
  assert.strictEqual(byKey.get('HaloPsaDiagnosticLoggingEnabled').defaultValue, 'false', 'HaloPsaDiagnosticLoggingEnabled should default to disabled');
  assert.strictEqual(byKey.get('HaloPsaCloseWhenSignalClears').visible, false, 'HaloPsaCloseWhenSignalClears should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('HaloPsaCreateNewWhenLinkedClosed').visible, false, 'HaloPsaCreateNewWhenLinkedClosed should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('HaloPsaAutomationFailedLookbackHours').visible, false, 'HaloPsaAutomationFailedLookbackHours should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('HaloPsaVulnerabilityEnabled').visible, false, 'HaloPsaVulnerabilityEnabled should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('HaloPsaUpdateEnabled').visible, false, 'HaloPsaUpdateEnabled should remain hidden from the visible UI');
  assert.strictEqual(byKey.get('HaloPsaVulnerabilityTicketModel').group, 'Signal Filters', 'HaloPsaVulnerabilityTicketModel should now live under Signal Filters');
  assert.strictEqual(byKey.get('HaloPsaUpdateTicketModel').group, 'Signal Filters', 'HaloPsaUpdateTicketModel should now live under Signal Filters');
  assert.strictEqual(byKey.get('HaloPsaAutomationFailedTicketModel').group, 'Signal Filters', 'HaloPsaAutomationFailedTicketModel should now live under Signal Filters');
  assert.strictEqual(byKey.get('HaloPsaMaxImpactedEndpointsInGroupedTicket').group, 'Signal Filters', 'HaloPsaMaxImpactedEndpointsInGroupedTicket should now live under Signal Filters');
  assert.strictEqual(byKey.get('HaloPsaMaxOpenTicketsPerOrganization').group, 'Signal Filters', 'HaloPsaMaxOpenTicketsPerOrganization should now live under Signal Filters');

  assert.strictEqual(byKey.has('HaloTenant'), false, 'HaloTenant should not exist in HaloPSA settings schema');
  assert(settingsSchema.every((row) => String(row.key || '').startsWith('HaloPsa')), 'every HaloPSA durable settings key should start with HaloPsa');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'HaloPSA settings schema should not declare Action1 credential keys');

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
    assert.strictEqual(byKey.has(key), false, `${key} should be absent after the HaloPsa key rename`);
  }

  const idWordLabels = [
    byKey.get('HaloPsaTeamId').label,
    byKey.get('HaloPsaTicketTypeId').label,
    byKey.get('HaloPsaCategory1Id').label,
    byKey.get('HaloPsaNewStatusId').label,
    byKey.get('HaloPsaClosedStatusIds').label
  ];
  assert(idWordLabels.every((label) => !/\bID\b/.test(label)), 'Ticket Routing labels should not expose technical ID wording');
  assert(idWordLabels.every((label) => !/\(optional\)/i.test(label)), 'Ticket Routing labels should not expose optional wording in the visible label');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
