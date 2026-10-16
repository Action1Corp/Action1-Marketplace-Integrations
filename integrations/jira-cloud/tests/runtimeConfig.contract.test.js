const assert = require('assert');

const {
  DEFAULT_ACTION1_CONNECTION,
  RUNTIME_SETTING_KEYS,
  buildRuntimeConfig,
  loadRuntimeConfig,
  normalizeExistingOpenIssueBehavior,
  readRuntimeSettings
} = require('../runtimeConfig');

function buildSettings(overrides = {}) {
  return {
    JiraCloudSiteUrl: 'https://example.atlassian.net/',
    JiraCloudUserEmail: 'jira-admin@example.com',
    JiraCloudApiToken: 'jira-secret',
    JiraCloudExistingOpenIssueBehavior: 'skip_existing_open',
    JiraCloudCloseWhenSignalClears: 'false',
    JiraCloudCreateNewWhenLinkedCompleted: 'true',
    JiraCloudOfflineEnabled: 'true',
    JiraCloudOfflineThresholdDays: '15',
    JiraCloudRebootRequiredEnabled: 'false',
    JiraCloudAutomationFailedEnabled: 'true',
    JiraCloudAutomationFailedLookbackHours: '36',
    JiraCloudVulnerabilityEnabled: 'false',
    JiraCloudVulnerabilitySeverities: ' critical , high ',
    JiraCloudVulnerabilityRemediationStatuses: ' overdue , due_soon ',
    JiraCloudUpdateEnabled: 'false',
    JiraCloudUpdateSeverities: 'important, moderate',
    JiraCloudUpdateRemediationStatuses: 'overdue,due_soon',
    JiraCloudVulnerabilityTicketModel: 'grouped',
    JiraCloudUpdateTicketModel: 'endpoint',
    JiraCloudAutomationFailedTicketModel: 'grouped',
    JiraCloudMaxImpactedEndpointsInGroupedTicket: '40',
    JiraCloudMaxOpenTicketsPerOrganization: '99',
    JiraCloudDiagnosticLoggingEnabled: 'true',
    ...overrides
  };
}

function buildMappings() {
  return [
    {
      id: 101,
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha',
      jiraProjectId: '1001',
      jiraProjectKey: 'OPS',
      jiraProjectName: 'Operations',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug',
      enabled: true
    },
    {
      id: 102,
      action1OrgId: 'org-2',
      action1OrgName: 'Beta',
      jiraProjectId: '1002',
      jiraProjectKey: 'SEC',
      jiraProjectName: 'Security',
      jiraIssueTypeId: '10002',
      jiraIssueTypeName: 'Task',
      enabled: false
    }
  ];
}

async function run() {
  runRuntimeSettingKeyScopeTest();
  runExistingOpenIssueBehaviorNormalizationTest();
  runBuildRuntimeConfigTest();
  runSeverityDerivedEnabledFlagsTest();
  runMissingBooleanDefaultsTest();
  runStringFalseNormalizationTest();
  runCoreSignalBooleanNormalizationTest();
  await runReadRuntimeSettingsAllFallbackTest();
  await runLoadRuntimeConfigTest();
}

function runRuntimeSettingKeyScopeTest() {
  assert(RUNTIME_SETTING_KEYS.length > 0, 'runtime config should expose a non-empty Marketplace setting key list');
  assert(RUNTIME_SETTING_KEYS.every((key) => key.startsWith('JiraCloud')), 'runtime config should stay scoped to JiraCloud-prefixed Marketplace settings');
}

function runExistingOpenIssueBehaviorNormalizationTest() {
  assert.strictEqual(normalizeExistingOpenIssueBehavior('skip_existing_open'), 'skip_existing_open');
  assert.strictEqual(normalizeExistingOpenIssueBehavior('anything-else'), 'update_existing_open');
}

function runBuildRuntimeConfigTest() {
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
  assert.strictEqual(runtimeConfig.connections.jira.siteUrl, 'https://example.atlassian.net');
  assert.strictEqual(runtimeConfig.connections.jira.email, 'jira-admin@example.com');
  assert.strictEqual(runtimeConfig.connections.jira.apiTokenRef, 'jira-secret');
  assert.strictEqual(runtimeConfig.lifecycle.existingOpenIssueBehavior, 'skip_existing_open');
  assert.strictEqual(runtimeConfig.lifecycle.closeWhenSignalClears, false);
  assert.strictEqual(runtimeConfig.lifecycle.createNewWhenLinkedClosed, true);
  assert.strictEqual(runtimeConfig.lifecycle.reopenClosedTickets, false);
  assert.strictEqual(runtimeConfig.signalFilters.offline.enabled, true);
  assert.strictEqual(runtimeConfig.signalFilters.offline.thresholdDays, 15);
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.enabled, false);
  assert.strictEqual(runtimeConfig.signalFilters.automationFailed.enabled, true);
  assert.strictEqual(runtimeConfig.signalFilters.automationFailed.lookbackHours, 36);
  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false);
  assert.deepStrictEqual(runtimeConfig.signalFilters.vulnerability.severities, ['CRITICAL', 'HIGH']);
  assert.deepStrictEqual(runtimeConfig.signalFilters.vulnerability.remediationStatuses, ['OVERDUE', 'DUE_SOON']);
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false);
  assert.deepStrictEqual(runtimeConfig.signalFilters.update.severities, ['IMPORTANT', 'MODERATE']);
  assert.deepStrictEqual(runtimeConfig.signalFilters.update.remediationStatuses, ['OVERDUE', 'DUE_SOON']);
  assert.strictEqual(runtimeConfig.vulnerabilities.ticketModel, 'grouped');
  assert.strictEqual(runtimeConfig.updates.ticketModel, 'endpoint');
  assert.strictEqual(runtimeConfig.automationFailed.ticketModel, 'grouped');
  assert.strictEqual(runtimeConfig.maxImpactedEndpointsInGroupedTicket, 40);
  assert.strictEqual(runtimeConfig.operationalSafeguards.enableDebugLogging, true);
  assert.strictEqual(runtimeConfig.operationalSafeguards.maxOpenTicketsPerOrganization, 99);
  assert.deepStrictEqual(runtimeConfig.orgProjectMappings, [
    {
      mappingId: '101',
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha',
      jiraProjectId: '1001',
      jiraProjectKey: 'OPS',
      jiraProjectName: 'Operations',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug'
    }
  ]);
}

function runSeverityDerivedEnabledFlagsTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      JiraCloudVulnerabilityEnabled: 'true',
      JiraCloudVulnerabilitySeverities: '',
      JiraCloudVulnerabilityRemediationStatuses: '',
      JiraCloudUpdateEnabled: 'true',
      JiraCloudUpdateSeverities: '',
      JiraCloudUpdateRemediationStatuses: ''
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false, 'vulnerability enabled should derive from selected severities');
  assert.deepStrictEqual(runtimeConfig.signalFilters.vulnerability.severities, [], 'empty vulnerability severity should remain empty');
  assert.deepStrictEqual(runtimeConfig.signalFilters.vulnerability.remediationStatuses, [], 'empty vulnerability remediation should remain empty');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false, 'update enabled should derive from selected severities');
  assert.deepStrictEqual(runtimeConfig.signalFilters.update.severities, [], 'empty update severity should remain empty');
  assert.deepStrictEqual(runtimeConfig.signalFilters.update.remediationStatuses, [], 'empty update remediation should remain empty');
}

function runMissingBooleanDefaultsTest() {
  const settings = buildSettings();
  delete settings.JiraCloudVulnerabilityEnabled;
  delete settings.JiraCloudUpdateEnabled;

  const runtimeConfig = buildRuntimeConfig({
    settings,
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, true, 'vulnerability defaults should still apply when the enabled key is missing');
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, true, 'update defaults should still apply when the enabled key is missing');
}

function runStringFalseNormalizationTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      JiraCloudVulnerabilityEnabled: 'false',
      JiraCloudVulnerabilitySeverities: 'critical',
      JiraCloudUpdateEnabled: 'false',
      JiraCloudUpdateSeverities: 'important'
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.vulnerability.enabled, false);
  assert.strictEqual(runtimeConfig.signalFilters.update.enabled, false);
}

function runCoreSignalBooleanNormalizationTest() {
  const runtimeConfig = buildRuntimeConfig({
    settings: buildSettings({
      JiraCloudOfflineEnabled: 'false',
      JiraCloudRebootRequiredEnabled: 'false',
      JiraCloudAutomationFailedEnabled: 'false'
    }),
    mappings: []
  });

  assert.strictEqual(runtimeConfig.signalFilters.offline.enabled, false);
  assert.strictEqual(runtimeConfig.signalFilters.rebootRequired.enabled, false);
  assert.strictEqual(runtimeConfig.signalFilters.automationFailed.enabled, false);
}

async function runReadRuntimeSettingsAllFallbackTest() {
  const requestedKeys = [];
  const settings = await readRuntimeSettings({
    settings: {
      async all(keys) {
        requestedKeys.push(...keys);
        return {
          JiraCloudMaxOpenTicketsPerOrganization: '77'
        };
      }
    }
  });

  assert.deepStrictEqual(requestedKeys, RUNTIME_SETTING_KEYS, 'readRuntimeSettings should request only Jira runtime keys');
  assert.deepStrictEqual(settings, {
    JiraCloudMaxOpenTicketsPerOrganization: '77'
  });

  const fallbackGets = [];
  const fallbackSettings = await readRuntimeSettings({
    settings: {
      async all() {
        return [];
      },
      async get(key) {
        fallbackGets.push(key);
        return key === 'JiraCloudDiagnosticLoggingEnabled' ? 'true' : '';
      }
    }
  });

  assert.deepStrictEqual(fallbackGets, RUNTIME_SETTING_KEYS, 'fallback settings reads should walk the same Jira key list');
  assert.strictEqual(fallbackSettings.JiraCloudDiagnosticLoggingEnabled, 'true');
}

async function runLoadRuntimeConfigTest() {
  const calls = [];
  const runtimeConfig = await loadRuntimeConfig({
    settings: {
      async all(keys) {
        calls.push({ method: 'all', keys });
        return buildSettings({
          JiraCloudMaxOpenTicketsPerOrganization: '15',
          JiraCloudDiagnosticLoggingEnabled: undefined
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
            jira_project_id: '1001',
            jira_project_key: 'OPS',
            jira_project_name: 'Operations',
            jira_issue_type_id: '10001',
            jira_issue_type_name: 'Bug',
            enabled: 1,
            created_at: null,
            updated_at: null
          }
        ];
      }
    }
  });

  assert.strictEqual(calls[0].method, 'all', 'loadRuntimeConfig should read Marketplace settings before building runtime config');
  assert.strictEqual(calls[1].method, 'db.all', 'loadRuntimeConfig should load DB-backed org/project mappings');
  assert.strictEqual(runtimeConfig.operationalSafeguards.maxOpenTicketsPerOrganization, 15);
  assert.strictEqual(runtimeConfig.operationalSafeguards.enableDebugLogging, false, 'diagnostic logging should remain disabled when the setting is missing');
  assert.deepStrictEqual(runtimeConfig.orgProjectMappings, [
    {
      mappingId: '301',
      action1OrgId: 'org-db-1',
      action1OrgName: 'Database Org',
      jiraProjectId: '1001',
      jiraProjectKey: 'OPS',
      jiraProjectName: 'Operations',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug'
    }
  ]);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
