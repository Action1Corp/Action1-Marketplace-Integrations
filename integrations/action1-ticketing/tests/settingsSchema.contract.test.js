const assert = require('assert');
const settingsSchema = require('../ui/settingsSchema.json');

function run() {
  assert(Array.isArray(settingsSchema), 'settingsSchema should be an array');

  const byKey = new Map(settingsSchema.map((row) => [row.key, row]));
  const removedHaloOwnedKeys = ['TicketingResourceServer', 'TicketingAuthorisationServer', 'TicketingClientId', 'TicketingClientSecret', 'TicketingTeamId', 'TicketingTicketTypeId', 'TicketingCategory1Id', 'TicketingNewStatusId', 'TicketingClosedStatusIds'];
  for (const key of removedHaloOwnedKeys) assert.strictEqual(byKey.has(key), false, `${key} must not remain as a shared or Halo fallback setting`);
  assert.strictEqual(byKey.get('TicketingActiveProvider').defaultValue, 'connectwise-psa');
  assert.strictEqual(byKey.has('HaloTenant'), false, 'HaloTenant should not exist in Action1 Ticketing settings schema');
  assert(settingsSchema.every((row) => String(row.key || '').startsWith('Ticketing')), 'every Action1 Ticketing durable settings key should start with Ticketing');

  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdEnabled').label, 'Require last boot at least', 'TicketingRebootRequiredAgeThresholdEnabled should use the shorter threshold toggle label');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdEnabled').helpText, 'Use this to avoid creating or maintaining reboot-required tickets for endpoints rebooted more recently than the threshold.', 'TicketingRebootRequiredAgeThresholdEnabled should preserve the reboot age threshold helper copy');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdDays').label, 'days ago', 'TicketingRebootRequiredAgeThresholdDays should use the operator-facing suffix label');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'Action1 Ticketing settings schema should not declare Action1 credential keys');

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
    assert.strictEqual(byKey.has(key), false, `${key} should be absent after the Ticketing key rename`);
  }

  const rowStyleStateKeys = [
    'Action1OrgHaloClientMappings',
    'TicketingOrgClientMappings',
    'TicketingEndpointCorrelations',
    'TicketingGroupedCorrelations',
    'TicketingSignalWatermarks',
    'TicketingDiscoveryCache'
  ];
  for (const key of rowStyleStateKeys) {
    assert.strictEqual(byKey.has(key), false, `${key} should not be declared in Action1 Ticketing settings schema`);
  }

  for (const key of ['TicketingCloseWhenSignalClears', 'TicketingCreateNewWhenLinkedClosed']) {
    assert.strictEqual(byKey.get(key).visible, false, `${key} should remain durable but hidden from the visible UI`);
  }

  for (const key of [
    'TicketingAutomationFailedLookbackHours',
    'TicketingVulnerabilityEnabled',
    'TicketingUpdateEnabled'
  ]) {
    assert.strictEqual(byKey.get(key).visible, false, `${key} should remain durable but hidden from the visible operator UI`);
  }

  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdDays').type, 'number', 'TicketingRebootRequiredAgeThresholdDays should be a numeric setting');
  assert.strictEqual(byKey.get('TicketingRebootRequiredAgeThresholdDays').min, 1, 'TicketingRebootRequiredAgeThresholdDays should require a minimum of 1 day');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
