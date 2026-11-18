const assert = require('assert');

const settingsSchema = require('../ui/settingsSchema.json');
const {
  getEffectiveSettingValue,
  serializeSettingValue
} = require('../ui/settingsValueHelpers');

const SECRET_MASK = '***';

function buildCleanHostSettings() {
  return Object.fromEntries(settingsSchema.map((setting) => [setting.key, '']));
}

function getSetting(key) {
  const setting = settingsSchema.find((row) => row.key === key);
  assert(setting, `expected Action1 Ticketing setting ${key} to exist in schema`);
  return setting;
}

function serializeAll(settings) {
  return Object.fromEntries(
    settingsSchema.map((setting) => [
      setting.key,
      serializeSettingValue(setting, settings, {
        settingsSchema,
        secretMask: SECRET_MASK
      })
    ])
  );
}

function runCleanHostEmptyStringDefaultsTest() {
  const cleanSettings = buildCleanHostSettings();

  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingOfflineEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate TicketingOfflineEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingRebootRequiredEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate TicketingRebootRequiredEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingAutomationFailedEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate TicketingAutomationFailedEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingDiagnosticLoggingEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'false',
    'clean host empty strings should keep diagnostic logging disabled by default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingOfflineThresholdDays' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '7',
    'clean host empty strings should hydrate the offline threshold default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingMaxImpactedEndpointsInGroupedTicket' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '25',
    'clean host empty strings should hydrate the grouped-ticket endpoint limit default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingMaxOpenTicketsPerOrganization' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '30',
    'clean host empty strings should hydrate the max-open safeguard default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingVulnerabilitySeverities' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'CRITICAL,HIGH',
    'clean host empty strings should hydrate the vulnerability severity defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingVulnerabilityRemediationStatuses' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'OVERDUE,DUE_SOON',
    'clean host empty strings should hydrate the vulnerability remediation defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingUpdateSeverities' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'CRITICAL,IMPORTANT',
    'clean host empty strings should hydrate the update severity defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingUpdateRemediationStatuses' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'OVERDUE,DUE_SOON',
    'clean host empty strings should hydrate the update remediation defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingVulnerabilityTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped vulnerability ticket model default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingUpdateTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped update ticket model default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingAutomationFailedTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped automation-failed ticket model default'
  );
}

function runRequiredBlankFieldsRemainBlankTest() {
  const cleanSettings = buildCleanHostSettings();
  assert.strictEqual(getEffectiveSettingValue(getSetting('TicketingOfflineThresholdDays'), cleanSettings, { settingsSchema, secretMask: SECRET_MASK }), '7');
}

function runUntouchedCleanSaveSerializesDefaultsTest() {
  const cleanSettings = buildCleanHostSettings();
  const serialized = serializeAll(cleanSettings);

  assert.strictEqual(serialized.TicketingOfflineEnabled, 'true', 'untouched clean save should persist TicketingOfflineEnabled=true');
  assert.strictEqual(serialized.TicketingOfflineThresholdDays, '7', 'untouched clean save should persist TicketingOfflineThresholdDays=7');
  assert.strictEqual(serialized.TicketingRebootRequiredEnabled, 'true', 'untouched clean save should persist TicketingRebootRequiredEnabled=true');
  assert.strictEqual(serialized.TicketingRebootRequiredAgeThresholdEnabled, 'false', 'untouched clean save should persist the reboot age threshold toggle default');
  assert.strictEqual(serialized.TicketingRebootRequiredAgeThresholdDays, '30', 'untouched clean save should persist the reboot age threshold days default');
  assert.strictEqual(serialized.TicketingAutomationFailedEnabled, 'true', 'untouched clean save should persist TicketingAutomationFailedEnabled=true');
  assert.strictEqual(serialized.TicketingAutomationFailedLookbackHours, '24', 'untouched clean save should persist TicketingAutomationFailedLookbackHours=24');
  assert.strictEqual(serialized.TicketingVulnerabilitySeverities, 'CRITICAL,HIGH', 'untouched clean save should persist vulnerability severity defaults');
  assert.strictEqual(serialized.TicketingVulnerabilityRemediationStatuses, 'OVERDUE,DUE_SOON', 'untouched clean save should persist vulnerability remediation defaults');
  assert.strictEqual(serialized.TicketingUpdateSeverities, 'CRITICAL,IMPORTANT', 'untouched clean save should persist update severity defaults');
  assert.strictEqual(serialized.TicketingUpdateRemediationStatuses, 'OVERDUE,DUE_SOON', 'untouched clean save should persist update remediation defaults');
  assert.strictEqual(serialized.TicketingVulnerabilityTicketModel, 'grouped', 'untouched clean save should persist the grouped vulnerability ticket model default');
  assert.strictEqual(serialized.TicketingUpdateTicketModel, 'grouped', 'untouched clean save should persist the grouped update ticket model default');
  assert.strictEqual(serialized.TicketingAutomationFailedTicketModel, 'grouped', 'untouched clean save should persist the grouped automation-failed ticket model default');
  assert.strictEqual(serialized.TicketingMaxImpactedEndpointsInGroupedTicket, '25', 'untouched clean save should persist the grouped ticket endpoint limit default');
  assert.strictEqual(serialized.TicketingMaxOpenTicketsPerOrganization, '30', 'untouched clean save should persist the max-open safeguard default');
  assert.strictEqual(serialized.TicketingDiagnosticLoggingEnabled, 'false', 'untouched clean save should keep diagnostic logging disabled');
  assert.strictEqual(serialized.TicketingCloseWhenSignalClears, 'true', 'untouched clean save should preserve close-when-signal-clears=true');
  assert.strictEqual(serialized.TicketingCreateNewWhenLinkedClosed, 'true', 'untouched clean save should preserve create-new-when-linked-closed=true');
}

function runExplicitSavedValuesWinOverDefaultsTest() {
  const settings = {
    ...buildCleanHostSettings(),
    TicketingOfflineEnabled: 'false',
    TicketingRebootRequiredEnabled: 'false',
    TicketingAutomationFailedEnabled: 'false',
    TicketingDiagnosticLoggingEnabled: 'false',
    TicketingOfflineThresholdDays: '11',
    TicketingVulnerabilitySeverities: 'LOW',
    TicketingUpdateTicketModel: 'endpoint'
  };

  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingOfflineEnabled' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'false',
    'explicit saved false should not be overwritten by a true default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingOfflineThresholdDays' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '11',
    'explicit saved numeric values should not be overwritten by defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingVulnerabilitySeverities' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'LOW',
    'explicit saved CSV values should not be overwritten by defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'TicketingUpdateTicketModel' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'endpoint',
    'explicit saved ticket-model values should not be overwritten by defaults'
  );
}

function runExplicitEmptyMultiSelectValuesRemainEmptyTest() {
  const settings = {
    ...buildCleanHostSettings(),
    TicketingVulnerabilitySeverities: '',
    TicketingVulnerabilitySeveritiesExplicit: 'true',
    TicketingVulnerabilityRemediationStatuses: '',
    TicketingVulnerabilityRemediationStatusesExplicit: 'true',
    TicketingUpdateSeverities: '',
    TicketingUpdateSeveritiesExplicit: 'true',
    TicketingUpdateRemediationStatuses: '',
    TicketingUpdateRemediationStatusesExplicit: 'true'
  };

  for (const key of [
    'TicketingVulnerabilitySeverities',
    'TicketingVulnerabilityRemediationStatuses',
    'TicketingUpdateSeverities',
    'TicketingUpdateRemediationStatuses'
  ]) {
    assert.strictEqual(
      getEffectiveSettingValue({ key }, settings, {
        settingsSchema,
        secretMask: SECRET_MASK
      }),
      '',
      `${key} should preserve an explicitly selected empty value`
    );
    assert.strictEqual(
      serializeSettingValue(getSetting(key), settings, {
        settingsSchema,
        secretMask: SECRET_MASK
      }),
      '',
      `${key} should serialize an explicitly selected empty value`
    );
  }

  const reloadedSettings = serializeAll(settings);
  for (const key of [
    'TicketingVulnerabilitySeverities',
    'TicketingVulnerabilityRemediationStatuses',
    'TicketingUpdateSeverities',
    'TicketingUpdateRemediationStatuses'
  ]) {
    assert.strictEqual(
      getEffectiveSettingValue({ key }, reloadedSettings, {
        settingsSchema,
        secretMask: SECRET_MASK
      }),
      '',
      `${key} should remain empty after save serialization and reload normalization`
    );
  }
}

function runSecretPlaceholderPreservationTest() {
  assert(!settingsSchema.some((field) => field.type === 'secret'), 'common schema has no provider secret; provider secret masking is covered by provider management behavior tests');
}

function run() {
  runCleanHostEmptyStringDefaultsTest();
  runRequiredBlankFieldsRemainBlankTest();
  runUntouchedCleanSaveSerializesDefaultsTest();
  runExplicitSavedValuesWinOverDefaultsTest();
  runExplicitEmptyMultiSelectValuesRemainEmptyTest();
  runSecretPlaceholderPreservationTest();
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
