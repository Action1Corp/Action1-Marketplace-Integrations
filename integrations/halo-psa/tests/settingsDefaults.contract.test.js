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
  assert(setting, `expected HaloPSA setting ${key} to exist in schema`);
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
    getEffectiveSettingValue({ key: 'HaloPsaOfflineEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate HaloPsaOfflineEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaRebootRequiredEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate HaloPsaRebootRequiredEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaAutomationFailedEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate HaloPsaAutomationFailedEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaDiagnosticLoggingEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'false',
    'clean host empty strings should keep diagnostic logging disabled by default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaOfflineThresholdDays' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '7',
    'clean host empty strings should hydrate the offline threshold default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaMaxImpactedEndpointsInGroupedTicket' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '25',
    'clean host empty strings should hydrate the grouped-ticket endpoint limit default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaMaxOpenTicketsPerOrganization' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '30',
    'clean host empty strings should hydrate the max-open safeguard default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaVulnerabilitySeverities' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'CRITICAL,HIGH',
    'clean host empty strings should hydrate the vulnerability severity defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaVulnerabilityRemediationStatuses' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'OVERDUE,DUE_SOON',
    'clean host empty strings should hydrate the vulnerability remediation defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaUpdateSeverities' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'CRITICAL,IMPORTANT',
    'clean host empty strings should hydrate the update severity defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaUpdateRemediationStatuses' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'OVERDUE,DUE_SOON',
    'clean host empty strings should hydrate the update remediation defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaVulnerabilityTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped vulnerability ticket model default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaUpdateTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped update ticket model default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaAutomationFailedTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped automation-failed ticket model default'
  );
}

function runRequiredBlankFieldsRemainBlankTest() {
  const cleanSettings = buildCleanHostSettings();

  for (const key of [
    'HaloPsaResourceServer',
    'HaloPsaAuthorisationServer',
    'HaloPsaClientId',
    'HaloPsaClientSecret',
    'HaloPsaTeamId',
    'HaloPsaTicketTypeId',
    'HaloPsaCategory1Id',
    'HaloPsaNewStatusId',
    'HaloPsaClosedStatusIds'
  ]) {
    assert.strictEqual(
      getEffectiveSettingValue(getSetting(key), cleanSettings, {
        settingsSchema,
        secretMask: SECRET_MASK
      }),
      '',
      `${key} should remain blank when there is no schema default`
    );
  }
}

function runUntouchedCleanSaveSerializesDefaultsTest() {
  const cleanSettings = buildCleanHostSettings();
  const serialized = serializeAll(cleanSettings);

  assert.strictEqual(serialized.HaloPsaOfflineEnabled, 'true', 'untouched clean save should persist HaloPsaOfflineEnabled=true');
  assert.strictEqual(serialized.HaloPsaOfflineThresholdDays, '7', 'untouched clean save should persist HaloPsaOfflineThresholdDays=7');
  assert.strictEqual(serialized.HaloPsaRebootRequiredEnabled, 'true', 'untouched clean save should persist HaloPsaRebootRequiredEnabled=true');
  assert.strictEqual(serialized.HaloPsaRebootRequiredAgeThresholdEnabled, 'false', 'untouched clean save should persist the reboot age threshold toggle default');
  assert.strictEqual(serialized.HaloPsaRebootRequiredAgeThresholdDays, '30', 'untouched clean save should persist the reboot age threshold days default');
  assert.strictEqual(serialized.HaloPsaAutomationFailedEnabled, 'true', 'untouched clean save should persist HaloPsaAutomationFailedEnabled=true');
  assert.strictEqual(serialized.HaloPsaAutomationFailedLookbackHours, '24', 'untouched clean save should persist HaloPsaAutomationFailedLookbackHours=24');
  assert.strictEqual(serialized.HaloPsaVulnerabilitySeverities, 'CRITICAL,HIGH', 'untouched clean save should persist vulnerability severity defaults');
  assert.strictEqual(serialized.HaloPsaVulnerabilityRemediationStatuses, 'OVERDUE,DUE_SOON', 'untouched clean save should persist vulnerability remediation defaults');
  assert.strictEqual(serialized.HaloPsaUpdateSeverities, 'CRITICAL,IMPORTANT', 'untouched clean save should persist update severity defaults');
  assert.strictEqual(serialized.HaloPsaUpdateRemediationStatuses, 'OVERDUE,DUE_SOON', 'untouched clean save should persist update remediation defaults');
  assert.strictEqual(serialized.HaloPsaVulnerabilityTicketModel, 'grouped', 'untouched clean save should persist the grouped vulnerability ticket model default');
  assert.strictEqual(serialized.HaloPsaUpdateTicketModel, 'grouped', 'untouched clean save should persist the grouped update ticket model default');
  assert.strictEqual(serialized.HaloPsaAutomationFailedTicketModel, 'grouped', 'untouched clean save should persist the grouped automation-failed ticket model default');
  assert.strictEqual(serialized.HaloPsaMaxImpactedEndpointsInGroupedTicket, '25', 'untouched clean save should persist the grouped ticket endpoint limit default');
  assert.strictEqual(serialized.HaloPsaMaxOpenTicketsPerOrganization, '30', 'untouched clean save should persist the max-open safeguard default');
  assert.strictEqual(serialized.HaloPsaDiagnosticLoggingEnabled, 'false', 'untouched clean save should keep diagnostic logging disabled');
  assert.strictEqual(serialized.HaloPsaCloseWhenSignalClears, 'true', 'untouched clean save should preserve close-when-signal-clears=true');
  assert.strictEqual(serialized.HaloPsaCreateNewWhenLinkedClosed, 'true', 'untouched clean save should preserve create-new-when-linked-closed=true');
}

function runExplicitSavedValuesWinOverDefaultsTest() {
  const settings = {
    ...buildCleanHostSettings(),
    HaloPsaOfflineEnabled: 'false',
    HaloPsaRebootRequiredEnabled: 'false',
    HaloPsaAutomationFailedEnabled: 'false',
    HaloPsaDiagnosticLoggingEnabled: 'false',
    HaloPsaOfflineThresholdDays: '11',
    HaloPsaVulnerabilitySeverities: 'LOW',
    HaloPsaUpdateTicketModel: 'endpoint'
  };

  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaOfflineEnabled' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'false',
    'explicit saved false should not be overwritten by a true default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaOfflineThresholdDays' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '11',
    'explicit saved numeric values should not be overwritten by defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaVulnerabilitySeverities' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'LOW',
    'explicit saved CSV values should not be overwritten by defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'HaloPsaUpdateTicketModel' }, settings, {
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
    HaloPsaVulnerabilitySeverities: '',
    HaloPsaVulnerabilitySeveritiesExplicit: 'true',
    HaloPsaVulnerabilityRemediationStatuses: '',
    HaloPsaVulnerabilityRemediationStatusesExplicit: 'true',
    HaloPsaUpdateSeverities: '',
    HaloPsaUpdateSeveritiesExplicit: 'true',
    HaloPsaUpdateRemediationStatuses: '',
    HaloPsaUpdateRemediationStatusesExplicit: 'true'
  };

  for (const key of [
    'HaloPsaVulnerabilitySeverities',
    'HaloPsaVulnerabilityRemediationStatuses',
    'HaloPsaUpdateSeverities',
    'HaloPsaUpdateRemediationStatuses'
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
    'HaloPsaVulnerabilitySeverities',
    'HaloPsaVulnerabilityRemediationStatuses',
    'HaloPsaUpdateSeverities',
    'HaloPsaUpdateRemediationStatuses'
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
  const currentSettings = {
    ...buildCleanHostSettings(),
    HaloPsaClientSecret: SECRET_MASK
  };

  assert.strictEqual(
    getEffectiveSettingValue(getSetting('HaloPsaClientSecret'), currentSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    SECRET_MASK,
    'stored secret placeholders should survive effective-value resolution'
  );
  assert.strictEqual(
    serializeSettingValue(getSetting('HaloPsaClientSecret'), currentSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    SECRET_MASK,
    'stored secret placeholders should survive serialization so save logic can keep skipping them'
  );
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
