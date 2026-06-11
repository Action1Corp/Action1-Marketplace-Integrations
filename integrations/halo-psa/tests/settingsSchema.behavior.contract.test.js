const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const connectionKeys = [
    'HaloResourceServer',
    'HaloAuthorisationServer',
    'HaloClientId',
    'HaloClientSecret'
  ];
  const groups = new Set(settingsSchema.map((row) => row.group));
  const behaviorKeys = [
    'HaloTeamId',
    'HaloTicketTypeId',
    'HaloCategory1Id',
    'HaloNewStatusId',
    'HaloClosedStatusIds',
    'ExistingOpenTicketBehavior',
    'CloseWhenSignalClears',
    'CreateNewWhenLinkedClosed',
    'OfflineEnabled',
    'OfflineThresholdDays',
    'RebootRequiredEnabled',
    'AutomationFailedEnabled',
    'AutomationFailedLookbackHours',
    'VulnerabilityEnabled',
    'VulnerabilitySeverities',
    'VulnerabilityRemediationStatuses',
    'UpdateEnabled',
    'UpdateSeverities',
    'UpdateRemediationStatuses',
    'VulnerabilityTicketModel',
    'UpdateTicketModel',
    'AutomationFailedTicketModel',
    'MaxImpactedEndpointsInGroupedTicket',
    'MaxOpenTicketsPerOrganization'
  ];

  for (const key of connectionKeys) {
    assert(byKey.has(key), `${key} should continue to exist in HaloPSA settings schema`);
  }

  for (const key of behaviorKeys) {
    assert(byKey.has(key), `${key} should exist in HaloPSA behavior settings schema`);
  }

  for (const groupName of ['HaloPSA Configuration', 'Ticket Routing', 'Lifecycle', 'Signal Filters', 'Grouped Ticketing', 'Operational Safeguards']) {
    assert(groups.has(groupName), `${groupName} should be represented in the HaloPSA settings schema`);
  }

  assert.strictEqual(byKey.get('ExistingOpenTicketBehavior').defaultValue, 'update_existing_open', 'ExistingOpenTicketBehavior should default to update_existing_open');
  assert.strictEqual(byKey.get('CloseWhenSignalClears').defaultValue, 'true', 'CloseWhenSignalClears should default to true');
  assert.strictEqual(byKey.get('CreateNewWhenLinkedClosed').defaultValue, 'true', 'CreateNewWhenLinkedClosed should default to true');
  assert.strictEqual(byKey.get('OfflineEnabled').defaultValue, 'true', 'OfflineEnabled should default to true');
  assert.strictEqual(byKey.get('OfflineThresholdDays').defaultValue, '7', 'OfflineThresholdDays should default to 7');
  assert.strictEqual(byKey.get('RebootRequiredEnabled').defaultValue, 'true', 'RebootRequiredEnabled should default to true');
  assert.strictEqual(byKey.get('AutomationFailedEnabled').defaultValue, 'true', 'AutomationFailedEnabled should default to true');
  assert.strictEqual(byKey.get('AutomationFailedLookbackHours').defaultValue, '24', 'AutomationFailedLookbackHours should default to 24');
  assert.strictEqual(byKey.get('VulnerabilityEnabled').defaultValue, 'true', 'VulnerabilityEnabled should default to true');
  assert.strictEqual(byKey.get('VulnerabilitySeverities').defaultValue, 'CRITICAL,HIGH', 'VulnerabilitySeverities should use the Phase 3a text default');
  assert.strictEqual(byKey.get('VulnerabilityRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON', 'VulnerabilityRemediationStatuses should use the Phase 3a text default');
  assert.strictEqual(byKey.get('UpdateEnabled').defaultValue, 'true', 'UpdateEnabled should default to true');
  assert.strictEqual(byKey.get('UpdateSeverities').defaultValue, 'CRITICAL,IMPORTANT', 'UpdateSeverities should use the Phase 3a text default');
  assert.strictEqual(byKey.get('UpdateRemediationStatuses').defaultValue, 'OVERDUE,DUE_SOON', 'UpdateRemediationStatuses should use the Phase 3a text default');
  assert.strictEqual(byKey.get('VulnerabilityTicketModel').defaultValue, 'grouped', 'VulnerabilityTicketModel should default to grouped');
  assert.strictEqual(byKey.get('UpdateTicketModel').defaultValue, 'grouped', 'UpdateTicketModel should default to grouped');
  assert.strictEqual(byKey.get('AutomationFailedTicketModel').defaultValue, 'grouped', 'AutomationFailedTicketModel should default to grouped');
  assert.strictEqual(byKey.get('MaxImpactedEndpointsInGroupedTicket').defaultValue, '25', 'MaxImpactedEndpointsInGroupedTicket should default to 25');
  assert.strictEqual(byKey.get('MaxImpactedEndpointsInGroupedTicket').min, 1, 'MaxImpactedEndpointsInGroupedTicket should represent a minimum of 1');
  assert.strictEqual(byKey.get('MaxImpactedEndpointsInGroupedTicket').max, 100, 'MaxImpactedEndpointsInGroupedTicket should represent a maximum of 100');
  assert.strictEqual(byKey.get('MaxOpenTicketsPerOrganization').defaultValue, '30', 'MaxOpenTicketsPerOrganization should default to 30');

  assert.strictEqual(byKey.has('HaloTenant'), false, 'HaloTenant should not exist in HaloPSA settings schema');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'HaloPSA settings schema should not declare Action1 credential keys');

  const schedulerKeys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Cron(?:Schedule|Timezone)/.test(key));
  assert.strictEqual(schedulerKeys.length, 0, 'Phase 3a should not introduce scheduler keys');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
