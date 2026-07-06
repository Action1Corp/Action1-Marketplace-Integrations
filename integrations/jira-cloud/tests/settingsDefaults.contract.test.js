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
  assert(setting, `expected Jira setting ${key} to exist in schema`);
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
    getEffectiveSettingValue({ key: 'JiraCloudOfflineEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate JiraCloudOfflineEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudRebootRequiredEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate JiraCloudRebootRequiredEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudAutomationFailedEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'true',
    'clean host empty strings should hydrate JiraCloudAutomationFailedEnabled from schema defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudDiagnosticLoggingEnabled' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'false',
    'clean host empty strings should keep diagnostic logging disabled by default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudOfflineThresholdDays' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '7',
    'clean host empty strings should hydrate the offline threshold default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudMaxImpactedEndpointsInGroupedTicket' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '25',
    'clean host empty strings should hydrate the grouped-issue endpoint limit default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudMaxOpenTicketsPerOrganization' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '30',
    'clean host empty strings should hydrate the max-open safeguard default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudVulnerabilitySeverities' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'CRITICAL,HIGH',
    'clean host empty strings should hydrate the vulnerability severity defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudVulnerabilityRemediationStatuses' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'OVERDUE,DUE_SOON',
    'clean host empty strings should hydrate the vulnerability remediation defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudUpdateSeverities' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'CRITICAL,IMPORTANT',
    'clean host empty strings should hydrate the update severity defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudUpdateRemediationStatuses' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'OVERDUE,DUE_SOON',
    'clean host empty strings should hydrate the update remediation defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudVulnerabilityTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped vulnerability ticket model default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudUpdateTicketModel' }, cleanSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'grouped',
    'clean host empty strings should hydrate the grouped update ticket model default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudAutomationFailedTicketModel' }, cleanSettings, {
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
    'JiraCloudSiteUrl',
    'JiraCloudUserEmail',
    'JiraCloudApiToken'
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

  assert.strictEqual(serialized.JiraCloudExistingOpenIssueBehavior, 'update_existing_open', 'untouched clean save should persist JiraCloudExistingOpenIssueBehavior=update_existing_open');
  assert.strictEqual(serialized.JiraCloudCloseWhenSignalClears, 'false', 'untouched clean save should preserve Jira close-when-signal-clears=false');
  assert.strictEqual(serialized.JiraCloudCreateNewWhenLinkedCompleted, 'true', 'untouched clean save should preserve create-new-when-linked-completed=true');
  assert.strictEqual(serialized.JiraCloudOfflineEnabled, 'true', 'untouched clean save should persist JiraCloudOfflineEnabled=true');
  assert.strictEqual(serialized.JiraCloudOfflineThresholdDays, '7', 'untouched clean save should persist JiraCloudOfflineThresholdDays=7');
  assert.strictEqual(serialized.JiraCloudRebootRequiredEnabled, 'true', 'untouched clean save should persist JiraCloudRebootRequiredEnabled=true');
  assert.strictEqual(serialized.JiraCloudAutomationFailedEnabled, 'true', 'untouched clean save should persist JiraCloudAutomationFailedEnabled=true');
  assert.strictEqual(serialized.JiraCloudAutomationFailedLookbackHours, '24', 'untouched clean save should persist JiraCloudAutomationFailedLookbackHours=24');
  assert.strictEqual(serialized.JiraCloudVulnerabilityEnabled, 'true', 'untouched clean save should preserve vulnerability enabled=true');
  assert.strictEqual(serialized.JiraCloudVulnerabilitySeverities, 'CRITICAL,HIGH', 'untouched clean save should persist vulnerability severity defaults');
  assert.strictEqual(serialized.JiraCloudVulnerabilityRemediationStatuses, 'OVERDUE,DUE_SOON', 'untouched clean save should persist vulnerability remediation defaults');
  assert.strictEqual(serialized.JiraCloudUpdateEnabled, 'true', 'untouched clean save should preserve update enabled=true');
  assert.strictEqual(serialized.JiraCloudUpdateSeverities, 'CRITICAL,IMPORTANT', 'untouched clean save should persist update severity defaults');
  assert.strictEqual(serialized.JiraCloudUpdateRemediationStatuses, 'OVERDUE,DUE_SOON', 'untouched clean save should persist update remediation defaults');
  assert.strictEqual(serialized.JiraCloudVulnerabilityTicketModel, 'grouped', 'untouched clean save should persist the grouped vulnerability ticket model default');
  assert.strictEqual(serialized.JiraCloudUpdateTicketModel, 'grouped', 'untouched clean save should persist the grouped update ticket model default');
  assert.strictEqual(serialized.JiraCloudAutomationFailedTicketModel, 'grouped', 'untouched clean save should persist the grouped automation-failed ticket model default');
  assert.strictEqual(serialized.JiraCloudMaxImpactedEndpointsInGroupedTicket, '25', 'untouched clean save should persist the grouped issue endpoint limit default');
  assert.strictEqual(serialized.JiraCloudMaxOpenTicketsPerOrganization, '30', 'untouched clean save should persist the max-open safeguard default');
  assert.strictEqual(serialized.JiraCloudDiagnosticLoggingEnabled, 'false', 'untouched clean save should keep diagnostic logging disabled');
}

function runExplicitSavedValuesWinOverDefaultsTest() {
  const settings = {
    ...buildCleanHostSettings(),
    JiraCloudOfflineEnabled: 'false',
    JiraCloudRebootRequiredEnabled: 'false',
    JiraCloudAutomationFailedEnabled: 'false',
    JiraCloudDiagnosticLoggingEnabled: 'false',
    JiraCloudOfflineThresholdDays: '11',
    JiraCloudVulnerabilitySeverities: 'LOW',
    JiraCloudUpdateTicketModel: 'endpoint'
  };

  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudOfflineEnabled' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'false',
    'explicit saved false should not be overwritten by a true default'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudOfflineThresholdDays' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    '11',
    'explicit saved numeric values should not be overwritten by defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudVulnerabilitySeverities' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'LOW',
    'explicit saved CSV values should not be overwritten by defaults'
  );
  assert.strictEqual(
    getEffectiveSettingValue({ key: 'JiraCloudUpdateTicketModel' }, settings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    'endpoint',
    'explicit saved ticket-model values should not be overwritten by defaults'
  );
}

function runSecretPlaceholderPreservationTest() {
  const currentSettings = {
    ...buildCleanHostSettings(),
    JiraCloudApiToken: SECRET_MASK
  };

  assert.strictEqual(
    getEffectiveSettingValue(getSetting('JiraCloudApiToken'), currentSettings, {
      settingsSchema,
      secretMask: SECRET_MASK
    }),
    SECRET_MASK,
    'stored secret placeholders should survive effective-value resolution'
  );
  assert.strictEqual(
    serializeSettingValue(getSetting('JiraCloudApiToken'), currentSettings, {
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
  runSecretPlaceholderPreservationTest();
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
