const assert = require('assert');

const {
  DEFAULT_ACTION1_CONNECTION,
  RUNTIME_SETTING_KEYS,
  buildRuntimeConfig,
  loadRuntimeConfig,
  readRuntimeSettings
} = require('../runtimeConfig');

function buildSettings(overrides = {}) {
  return {
    HaloPsaResourceServer: 'https://halo.example.com/api',
    HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
    HaloPsaClientId: 'halo-client-id',
    HaloPsaClientSecret: 'halo-client-secret',
    HaloPsaTeamId: '7',
    HaloPsaTicketTypeId: '8',
    HaloPsaCategory1Id: '9',
    HaloPsaNewStatusId: '10',
    HaloPsaClosedStatusIds: '11, 12 ,,13',
    HaloPsaExistingOpenTicketBehavior: 'skip_existing_open',
    HaloPsaCloseWhenSignalClears: 'false',
    HaloPsaCreateNewWhenLinkedClosed: 'true',
    HaloPsaOfflineEnabled: 'true',
    HaloPsaOfflineThresholdDays: '15',
    HaloPsaRebootRequiredEnabled: 'false',
    HaloPsaRebootRequiredAgeThresholdEnabled: 'true',
    HaloPsaRebootRequiredAgeThresholdDays: '30',
    HaloPsaAutomationFailedEnabled: 'true',
    HaloPsaAutomationFailedLookbackHours: '36',
    HaloPsaVulnerabilityEnabled: 'false',
    HaloPsaVulnerabilitySeverities: ' critical , high ',
    HaloPsaVulnerabilityRemediationStatuses: ' overdue , due_soon ',
    HaloPsaUpdateEnabled: 'false',
    HaloPsaUpdateSeverities: 'important, moderate',
    HaloPsaUpdateRemediationStatuses: 'overdue,due_soon',
    HaloPsaVulnerabilityTicketModel: 'grouped',
    HaloPsaUpdateTicketModel: 'endpoint',
    HaloPsaAutomationFailedTicketModel: 'grouped',
    HaloPsaMaxImpactedEndpointsInGroupedTicket: '40',
    HaloPsaMaxOpenTicketsPerOrganization: '99',
    HaloPsaDiagnosticLoggingEnabled: 'true',
    ...overrides
  };
}

function buildMappings() {
  return [
    {
      id: 101,
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha',
      haloClientId: 'client-1',
      haloClientName: 'Contoso',
      enabled: true
    },
    {
      id: 102,
      action1OrgId: 'org-2',
      action1OrgName: 'Beta',
      haloClientId: 'client-2',
      haloClientName: 'Fabrikam',
      enabled: false
    }
  ];
}

async function run() {
  runRuntimeSettingKeyScopeTest();
  await runBuildRuntimeConfigTest();
  await runSeverityDerivedEnabledFlagsTest();
  await runMissingBooleanDefaultsTest();
  await runStringFalseNormalizationTest();
  await runCoreSignalBooleanNormalizationTest();
  await runReadRuntimeSettingsAllFallbackTest();
  await runLoadRuntimeConfigTest();
}

function runRuntimeSettingKeyScopeTest() {
  assert(RUNTIME_SETTING_KEYS.length > 0, 'runtime config should expose a non-empty Marketplace setting key list');
  assert(
    RUNTIME_SETTING_KEYS.every((key) => key.startsWith('HaloPsa')),
    'runtime config should stay scoped to HaloPsa-prefixed Marketplace settings'
  );
}

async function runBuildRuntimeConfigTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings(),
    mappings: buildMappings()
  });

  assert.deepStrictEqual(DEFAULT_ACTION1_CONNECTION, {
    baseUrl: '',
    clientId: '',
    clientSecretRef: ''
  });
  assert.deepStrictEqual(runtimeConfig.connections.action1, DEFAULT_ACTION1_CONNECTION);
  assert.strictEqual(runtimeConfig.connections.halo.resourceServer, 'https://halo.example.com/api');
  assert.strictEqual(runtimeConfig.connections.halo.authorisationServer, 'https://halo.example.com/auth');
  assert.strictEqual(runtimeConfig.connections.halo.clientId, 'halo-client-id');
  assert.strictEqual(runtimeConfig.connections.halo.clientSecretRef, 'halo-client-secret');
  assert.deepStrictEqual(runtimeConfig.ticketDestination.closedStatusIds, ['11', '12', '13']);
  assert.strictEqual(runtimeConfig.lifecycle.existingOpenTicketBehavior, 'skip_existing_open');
  assert.strictEqual(runtimeConfig.lifecycle.closeWhenSignalClears, false);
  assert.strictEqual(runtimeConfig.lifecycle.createNewWhenLinkedClosed, true);
  assert.strictEqual(runtimeConfig.lifecycle.reopenClosedTickets, false);
  assert.strictEqual(runtimeConfig.signalFilters.offline.enabled, true, 'runtime config should preserve explicit offline enabled');
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.enabled, false, 'runtime config should preserve explicit false for reboot required enabled');
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.ageThresholdEnabled, true, 'runtime config should preserve explicit reboot-required age threshold enabled');
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.ageThresholdDays, 30, 'runtime config should normalize reboot-required age threshold days');
  assert.strictEqual(runtimeConfig.signalFilters.automationFailed.enabled, true, 'runtime config should preserve explicit automation failed enabled');
  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false, 'runtime config should preserve explicit false for vulnerability enabled');
  assert.deepStrictEqual(runtimeConfig.signalFilters.vulnerability.severities, ['CRITICAL', 'HIGH']);
  assert.deepStrictEqual(runtimeConfig.signalFilters.vulnerability.remediationStatuses, ['OVERDUE', 'DUE_SOON']);
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false, 'runtime config should preserve explicit false for update enabled');
  assert.deepStrictEqual(runtimeConfig.signalFilters.update.severities, ['IMPORTANT', 'MODERATE']);
  assert.deepStrictEqual(runtimeConfig.signalFilters.update.remediationStatuses, ['OVERDUE', 'DUE_SOON']);
  assert.strictEqual(runtimeConfig.vulnerabilities.ticketModel, 'grouped');
  assert.strictEqual(runtimeConfig.updates.ticketModel, 'endpoint');
  assert.strictEqual(runtimeConfig.automationFailed.ticketModel, 'grouped');
  assert.strictEqual(runtimeConfig.maxImpactedEndpointsInGroupedTicket, 40);
  assert.strictEqual(runtimeConfig.operationalSafeguards.enableDebugLogging, true, 'runtime config should preserve the diagnostic logging flag');
  assert.strictEqual(runtimeConfig.operationalSafeguards.maxOpenTicketsPerOrganization, 99);
  assert.strictEqual(runtimeConfig.provisioning.dryRunPreviewEnabled, false, 'Marketplace runtime should not reintroduce standalone dry-run as an enabled default');
  assert.deepStrictEqual(runtimeConfig.orgClientMappings, [
    {
      mappingId: '101',
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha',
      haloClientId: 'client-1',
      haloClientName: 'Contoso',
      allowHaloClientToCreateAction1Org: false
    }
  ]);
}

async function runSeverityDerivedEnabledFlagsTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      HaloPsaVulnerabilityEnabled: 'true',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'true',
      HaloPsaUpdateSeverities: ''
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false, 'vulnerability enabled should derive from selected severities');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false, 'update enabled should derive from selected severities');
}

async function runMissingBooleanDefaultsTest() {
  const settings = buildSettings();
  delete settings.HaloPsaVulnerabilityEnabled;
  delete settings.HaloPsaUpdateEnabled;

  const runtimeConfig = buildRuntimeConfig({
    settings,
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, true, 'vulnerability defaults should still apply when the enabled key is missing');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, true, 'update defaults should still apply when the enabled key is missing');
}

async function runStringFalseNormalizationTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: 'critical',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: 'important'
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false, 'string false should remain false for vulnerability enabled');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false, 'string false should remain false for update enabled');
}

async function runCoreSignalBooleanNormalizationTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaRebootRequiredAgeThresholdEnabled: 'false',
      HaloPsaRebootRequiredAgeThresholdDays: '0',
      HaloPsaAutomationFailedEnabled: 'false'
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.offline.enabled, false, 'string false should remain false for offline enabled');
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.enabled, false, 'string false should remain false for reboot required enabled');
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.ageThresholdEnabled, false, 'string false should remain false for reboot age threshold enabled');
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.ageThresholdDays, 30, 'invalid reboot age threshold days should fall back to default');
  assert.strictEqual(runtimeConfig.signalFilters.automationFailed.enabled, false, 'string false should remain false for automation failed enabled');
}

async function runReadRuntimeSettingsAllFallbackTest() {
  const requestedKeys = [];
  const settings = await readRuntimeSettings({
    settings: {
      async all(keys) {
        requestedKeys.push(...keys);
        return {
          HaloPsaTicketTypeId: '77'
        };
      }
    }
  });

  assert.deepStrictEqual(requestedKeys, RUNTIME_SETTING_KEYS, 'readRuntimeSettings should request only HaloPSA runtime keys');
  assert.deepStrictEqual(settings, {
    HaloPsaTicketTypeId: '77'
  });

  const fallbackGets = [];
  const fallbackSettings = await readRuntimeSettings({
    settings: {
      async all() {
        return [];
      },
      async get(key) {
        fallbackGets.push(key);
        return key === 'HaloPsaTeamId' ? '22' : '';
      }
    }
  });

  assert.deepStrictEqual(fallbackGets, RUNTIME_SETTING_KEYS, 'fallback settings reads should walk the same HaloPSA key list');
  assert.strictEqual(fallbackSettings.HaloPsaTeamId, '22');
}

async function runLoadRuntimeConfigTest() {
  const calls = [];
  const runtimeConfig = await loadRuntimeConfig({
    settings: {
      async all(keys) {
        calls.push({ method: 'all', keys });
        return buildSettings({
          HaloPsaMaxOpenTicketsPerOrganization: '15',
          HaloPsaDiagnosticLoggingEnabled: undefined
        });
      }
    },
    db: {
      async all(sql) {
        calls.push({ method: 'db.all', sql });
        return [
          {
            id: 301,
            action1_org_id: 'org-db-1',
            action1_org_name: 'Database Org',
            halo_client_id: 'client-db-1',
            halo_client_name: 'Database Client',
            enabled: 1,
            created_at: null,
            updated_at: null
          }
        ];
      }
    }
  });

  assert.strictEqual(calls[0].method, 'all', 'loadRuntimeConfig should read Marketplace settings before building runtime config');
  assert.strictEqual(calls[1].method, 'db.all', 'loadRuntimeConfig should load DB-backed org/client mappings');
  assert.strictEqual(runtimeConfig.operationalSafeguards.maxOpenTicketsPerOrganization, 15);
  assert.strictEqual(runtimeConfig.operationalSafeguards.enableDebugLogging, false, 'diagnostic logging should remain disabled when the setting is missing');
  assert.deepStrictEqual(runtimeConfig.orgClientMappings, [
    {
      mappingId: '301',
      action1OrgId: 'org-db-1',
      action1OrgName: 'Database Org',
      haloClientId: 'client-db-1',
      haloClientName: 'Database Client',
      allowHaloClientToCreateAction1Org: false
    }
  ]);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
