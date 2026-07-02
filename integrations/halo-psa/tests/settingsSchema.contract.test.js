const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const requiredKeys = [
    'HaloPsaResourceServer',
    'HaloPsaAuthorisationServer',
    'HaloPsaClientId',
    'HaloPsaClientSecret'
  ];

  for (const key of requiredKeys) {
    assert(byKey.has(key), `${key} should exist in HaloPSA settings schema`);
    assert.strictEqual(byKey.get(key).required, true, `${key} should be required`);
  }

  assert.strictEqual(byKey.get('HaloPsaClientSecret').type, 'secret', 'HaloPsaClientSecret should use type secret');
  assert.strictEqual(byKey.has('HaloTenant'), false, 'HaloTenant should not exist in HaloPSA settings schema');
  assert(settingsSchema.every((row) => String(row.key || '').startsWith('HaloPsa')), 'every HaloPSA durable settings key should start with HaloPsa');

  assert.strictEqual(byKey.get('HaloPsaTeamId').label, 'Team', 'HaloPsaTeamId should use the standalone-style Team label');
  assert.strictEqual(byKey.get('HaloPsaTicketTypeId').label, 'Ticket Type', 'HaloPsaTicketTypeId should use the standalone-style Ticket Type label');
  assert.strictEqual(byKey.get('HaloPsaNewStatusId').label, 'New PSA Ticket Status', 'HaloPsaNewStatusId should use the standalone-style New PSA Ticket Status label');
  assert.strictEqual(byKey.get('HaloPsaCategory1Id').label, 'Category', 'HaloPsaCategory1Id should use the standalone-style Category label');
  assert.strictEqual(byKey.get('HaloPsaClosedStatusIds').label, 'Complete / Closed Statuses', 'HaloPsaClosedStatusIds should use the standalone-style closed statuses label');
  assert.strictEqual(byKey.get('HaloPsaRebootRequiredAgeThresholdEnabled').label, 'Only qualify reboot required when last boot is at least (days)', 'HaloPsaRebootRequiredAgeThresholdEnabled should use the threshold toggle label');
  assert.strictEqual(byKey.get('HaloPsaRebootRequiredAgeThresholdDays').label, 'Reboot Required Age Threshold Days', 'HaloPsaRebootRequiredAgeThresholdDays should use the numeric threshold label');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'HaloPSA settings schema should not declare Action1 credential keys');

  const removedLegacyKeys = [
    'HaloResourceServer',
    'HaloAuthorisationServer',
    'HaloClientId',
    'HaloClientSecret',
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
  for (const key of removedLegacyKeys) {
    assert.strictEqual(byKey.has(key), false, `${key} should be absent after the HaloPsa key rename`);
  }

  const rowStyleStateKeys = [
    'Action1OrgHaloClientMappings',
    'HaloPsaOrgClientMappings',
    'HaloPsaEndpointCorrelations',
    'HaloPsaGroupedCorrelations',
    'HaloPsaSignalWatermarks',
    'HaloPsaDiscoveryCache'
  ];
  for (const key of rowStyleStateKeys) {
    assert.strictEqual(byKey.has(key), false, `${key} should not be declared in HaloPSA settings schema`);
  }

  for (const key of ['HaloPsaCloseWhenSignalClears', 'HaloPsaCreateNewWhenLinkedClosed']) {
    assert.strictEqual(byKey.get(key).visible, false, `${key} should remain durable but hidden from the visible UI`);
  }

  for (const key of [
    'HaloPsaAutomationFailedLookbackHours',
    'HaloPsaVulnerabilityEnabled',
    'HaloPsaUpdateEnabled'
  ]) {
    assert.strictEqual(byKey.get(key).visible, false, `${key} should remain durable but hidden from the visible operator UI`);
  }

  assert.strictEqual(byKey.get('HaloPsaRebootRequiredAgeThresholdDays').type, 'number', 'HaloPsaRebootRequiredAgeThresholdDays should be a numeric setting');
  assert.strictEqual(byKey.get('HaloPsaRebootRequiredAgeThresholdDays').min, 1, 'HaloPsaRebootRequiredAgeThresholdDays should require a minimum of 1 day');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
