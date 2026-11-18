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
    TicketingResourceServer: 'https://halo.example.com/api',
    TicketingAuthorisationServer: 'https://halo.example.com/auth',
    TicketingClientId: 'halo-client-id',
    TicketingClientSecret: 'halo-client-secret',
    TicketingTeamId: '7',
    TicketingTicketTypeId: '8',
    TicketingCategory1Id: '9',
    TicketingNewStatusId: '10',
    TicketingClosedStatusIds: '11, 12 ,,13',
    TicketingExistingOpenTicketBehavior: 'skip_existing_open',
    TicketingCloseWhenSignalClears: 'false',
    TicketingCreateNewWhenLinkedClosed: 'true',
    TicketingOfflineEnabled: 'true',
    TicketingOfflineThresholdDays: '15',
    TicketingRebootRequiredEnabled: 'false',
    TicketingRebootRequiredAgeThresholdEnabled: 'true',
    TicketingRebootRequiredAgeThresholdDays: '30',
    TicketingAutomationFailedEnabled: 'true',
    TicketingAutomationFailedLookbackHours: '36',
    TicketingVulnerabilityEnabled: 'false',
    TicketingVulnerabilitySeverities: ' critical , high ',
    TicketingVulnerabilityRemediationStatuses: ' overdue , due_soon ',
    TicketingUpdateEnabled: 'false',
    TicketingUpdateSeverities: 'important, moderate',
    TicketingUpdateRemediationStatuses: 'overdue,due_soon',
    TicketingVulnerabilityTicketModel: 'grouped',
    TicketingUpdateTicketModel: 'endpoint',
    TicketingAutomationFailedTicketModel: 'grouped',
    TicketingMaxImpactedEndpointsInGroupedTicket: '40',
    TicketingMaxOpenTicketsPerOrganization: '99',
    TicketingDiagnosticLoggingEnabled: 'true',
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
    RUNTIME_SETTING_KEYS.every((key) => key.startsWith('Ticketing')),
    'runtime config should stay scoped to Ticketing-prefixed Marketplace settings'
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
      TicketingVulnerabilityEnabled: 'true',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'true',
      TicketingUpdateSeverities: ''
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false, 'vulnerability enabled should derive from selected severities');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false, 'update enabled should derive from selected severities');
}

async function runMissingBooleanDefaultsTest() {
  const settings = buildSettings();
  delete settings.TicketingVulnerabilityEnabled;
  delete settings.TicketingUpdateEnabled;

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
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: 'critical',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: 'important'
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false, 'string false should remain false for vulnerability enabled');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false, 'string false should remain false for update enabled');
}

async function runCoreSignalBooleanNormalizationTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingRebootRequiredAgeThresholdEnabled: 'false',
      TicketingRebootRequiredAgeThresholdDays: '0',
      TicketingAutomationFailedEnabled: 'false'
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
        return { TicketingActiveProvider: 'provider-alpha', TicketingOfflineEnabled: 'false', TicketingTicketTypeId: '77' };
      }
    }
  });

  assert.deepStrictEqual(requestedKeys, RUNTIME_SETTING_KEYS, 'readRuntimeSettings should request only Action1 Ticketing runtime keys');
  assert.deepStrictEqual(settings, { TicketingActiveProvider: 'provider-alpha', TicketingOfflineEnabled: 'false' });

  const fallbackGets = [];
  const fallbackSettings = await readRuntimeSettings({
    settings: {
      async all() {
        return [];
      },
      async get(key) {
        fallbackGets.push(key);
        return key === 'TicketingOfflineEnabled' ? 'false' : '';
      }
    }
  });

  assert.deepStrictEqual(fallbackGets, RUNTIME_SETTING_KEYS, 'fallback settings reads should walk the same Action1 Ticketing key list');
  assert.strictEqual(fallbackSettings.TicketingOfflineEnabled, 'false');
}

async function runLoadRuntimeConfigTest() {
  const calls = [];
  const runtimeConfig = await loadRuntimeConfig({
    settings: {
      async all(keys) {
        calls.push({ method: 'all', keys });
        return buildSettings({
          TicketingMaxOpenTicketsPerOrganization: '15',
          TicketingDiagnosticLoggingEnabled: undefined
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
  assert.strictEqual(runtimeConfig.providerId, 'connectwise-psa', 'run-local provider defaults to the configured initial provider');
  assert.strictEqual(runtimeConfig.connections.halo.resourceServer, '', 'legacy Halo connection values are not loaded from common settings');
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

async function runActiveProviderCapturedWithCommonRulesTest() {
  const reads = [];
  const runtimeConfig = await loadRuntimeConfig({
    settings: {
      async all(keys) {
        reads.push(keys);
        return { TicketingActiveProvider: 'provider-alpha', TicketingOfflineEnabled: 'false', TicketingTicketTypeId: 'legacy-halo-value' };
      }
    },
    db: { async all(sql, params) { reads.push(params); return []; } }
  });
  assert.strictEqual(runtimeConfig.providerId, 'provider-alpha', 'run captures the server-owned active provider once');
  assert.strictEqual(runtimeConfig.signalFilters.offline.enabled, false, 'shared rules remain provider independent');
  assert.strictEqual(runtimeConfig.connections.halo.resourceServer, '', 'legacy Halo settings are not consumed by the active-provider runtime');
  assert.deepStrictEqual(reads[1], ['provider-alpha'], 'mapping reads are scoped to the captured provider');
}

runActiveProviderCapturedWithCommonRulesTest().then(() => run()).catch((error) => {
  console.error(error);
  process.exit(1);
});
