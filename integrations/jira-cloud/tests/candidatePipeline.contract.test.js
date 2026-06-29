const assert = require('assert');

const { runStage4CandidatePipeline } = require('../stage4CandidatePipeline');

function baseConfig(overrides = {}) {
  return {
    signalFilters: {
      offline: { enabled: false, thresholdDays: 7 },
      rebootRequired: { enabled: false },
      automationFailed: { enabled: false },
      vulnerability: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] },
      update: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] },
      ...(overrides.signalFilters || {})
    },
    vulnerabilities: overrides.vulnerabilities || { ticketModel: 'endpoint' },
    updates: overrides.updates || { ticketModel: 'endpoint' },
    automationFailed: overrides.automationFailed || { ticketModel: 'endpoint' },
    orgProjectMappings: overrides.orgProjectMappings || []
  };
}

function mappingRow(mappingId, action1OrgId, jiraProjectId, jiraIssueTypeId) {
  return {
    mappingId,
    action1OrgId,
    action1OrgName: action1OrgId,
    jiraProjectId,
    jiraProjectKey: 'OPS',
    jiraProjectName: 'Operations',
    jiraIssueTypeId,
    jiraIssueTypeName: 'Bug'
  };
}

function runMappedOfflineIdentityTest() {
  const result = runStage4CandidatePipeline({
    config: baseConfig({
      signalFilters: {
        offline: { enabled: true, thresholdDays: 7 },
        rebootRequired: { enabled: false },
        automationFailed: { enabled: false },
        vulnerability: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] },
        update: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] }
      },
      orgProjectMappings: [mappingRow('map-1', 'org-1', 'project-1', 'issue-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [{ id: 'ep-1', last_seen: '2026-05-01_00-00-00' }]
    },
    now: '2026-05-10T00:00:00Z'
  });

  const offline = result.candidates.find((row) => row.signal.type === 'OFFLINE');
  assert(offline, 'offline candidate should be created for mapped orgs');
  assert.strictEqual(offline.identity.key, 'map-1|ep-1|OFFLINE', 'endpoint candidate identity should preserve orgLinkId, endpointId, and signalType');
  assert.strictEqual(offline.routing.jiraProjectId, 'project-1', 'routing should use Jira project from the mapping row');
  assert.strictEqual(offline.routing.jiraIssueTypeId, 'issue-1', 'routing should use Jira issue type from the mapping row');
  assert.strictEqual(offline.identity.key.includes('project-1'), false, 'identity should not include Jira project');
  assert.strictEqual(offline.identity.key.includes('issue-1'), false, 'identity should not include Jira issue type');
}

function runGroupedIdentitySemanticsTest() {
  const result = runStage4CandidatePipeline({
    enableGroupedAggregation: true,
    config: baseConfig({
      vulnerabilities: { ticketModel: 'grouped' },
      updates: { ticketModel: 'grouped' },
      automationFailed: { ticketModel: 'grouped' },
      signalFilters: {
        offline: { enabled: false, thresholdDays: 7 },
        rebootRequired: { enabled: false },
        automationFailed: { enabled: true },
        vulnerability: { severities: ['HIGH'], remediationStatuses: ['OVERDUE'] },
        update: { severities: ['IMPORTANT'], remediationStatuses: ['OVERDUE'] }
      },
      orgProjectMappings: [mappingRow('map-1', 'org-1', 'project-1', 'issue-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [{ id: 'ep-1', name: 'A' }, { id: 'ep-2', name: 'B' }]
    },
    signalDatasets: {
      vulnerabilitiesByEndpoint: {
        'org-1': {
          'ep-1': [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }],
          'ep-2': [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }]
        }
      },
      updatesByEndpoint: {
        'org-1': {
          'ep-1': [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'High', update_sla_status: 'Overdue' }],
          'ep-2': [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'High', update_sla_status: 'Overdue' }]
        }
      },
      automationFailedByEndpoint: {
        'org-1': {
          'ep-1': [{ status: 'Error', instanceId: 'inst-1' }],
          'ep-2': [{ status: 'Error', instanceId: 'inst-1' }]
        }
      }
    }
  });

  assert(result.candidates.some((row) => row.ticketModel === 'grouped' && row.identity.key === 'map-1|VULNERABILITY|CVE-1'), 'grouped vulnerability identity should use cveId');
  assert(result.candidates.some((row) => row.ticketModel === 'grouped' && row.identity.key === 'map-1|UPDATE|pkg-1:ver-1'), 'grouped update identity should use packageId and versionId');
  assert(result.candidates.some((row) => row.ticketModel === 'grouped' && row.identity.key === 'map-1|AUTOMATION_FAILED|inst-1'), 'grouped automation identity should use automation instance id');
}

function runUnmappedOrgSkippedTest() {
  const result = runStage4CandidatePipeline({
    config: baseConfig({
      signalFilters: {
        offline: { enabled: false, thresholdDays: 7 },
        rebootRequired: { enabled: true },
        automationFailed: { enabled: false },
        vulnerability: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] },
        update: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] }
      },
      orgProjectMappings: []
    }),
    action1EndpointsByOrg: {
      'org-9': [{ id: 'ep-9', reboot_required: 'yes' }]
    }
  });

  assert.strictEqual(result.candidates.length, 0, 'unmapped orgs should not create candidates');
  assert(result.skipped.some((row) => row.reason === 'unmapped_org'), 'unmapped orgs should be skipped safely');
}

function runSavedSignalSettingsDriveQualificationTest() {
  const result = runStage4CandidatePipeline({
    config: baseConfig({
      signalFilters: {
        offline: { enabled: true, thresholdDays: 15 },
        rebootRequired: { enabled: false },
        automationFailed: { enabled: false },
        vulnerability: { enabled: false, severities: [], remediationStatuses: ['OVERDUE'] },
        update: { enabled: false, severities: [], remediationStatuses: ['OVERDUE'] }
      },
      orgProjectMappings: [mappingRow('map-1', 'org-1', 'project-1', 'issue-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [
        { id: 'ep-1', last_seen: '2026-05-01_00-00-00' },
        { id: 'ep-2', last_seen: '2026-05-10_00-00-00', reboot_required: 'yes' }
      ]
    },
    now: '2026-05-12T00:00:00Z'
  });

  assert.strictEqual(result.candidates.some((row) => row.signal.type === 'OFFLINE'), false, 'saved offline threshold should affect qualification');
  assert.strictEqual(result.candidates.some((row) => row.signal.type === 'REBOOT_REQUIRED'), false, 'saved reboot-required setting should affect qualification');
}

function runTicketModelSettingsDriveCandidateModeTest() {
  const result = runStage4CandidatePipeline({
    enableGroupedAggregation: true,
    config: baseConfig({
      vulnerabilities: { ticketModel: 'endpoint' },
      updates: { ticketModel: 'grouped' },
      automationFailed: { ticketModel: 'grouped' },
      signalFilters: {
        offline: { enabled: false, thresholdDays: 7 },
        rebootRequired: { enabled: false },
        automationFailed: { enabled: true },
        vulnerability: { enabled: true, severities: ['HIGH'], remediationStatuses: ['OVERDUE'] },
        update: { enabled: true, severities: ['IMPORTANT'], remediationStatuses: ['OVERDUE'] }
      },
      orgProjectMappings: [mappingRow('map-1', 'org-1', 'project-1', 'issue-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [{ id: 'ep-1', name: 'A' }, { id: 'ep-2', name: 'B' }]
    },
    signalDatasets: {
      vulnerabilitiesByEndpoint: {
        'org-1': {
          'ep-1': [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }],
          'ep-2': [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }]
        }
      },
      updatesByEndpoint: {
        'org-1': {
          'ep-1': [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'High', update_sla_status: 'Overdue' }],
          'ep-2': [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'High', update_sla_status: 'Overdue' }]
        }
      },
      automationFailedByEndpoint: {
        'org-1': {
          'ep-1': [{ status: 'Error', instanceId: 'inst-1' }],
          'ep-2': [{ status: 'Error', instanceId: 'inst-1' }]
        }
      }
    }
  });

  assert(result.candidates.some((row) => row.signal.type === 'VULNERABILITY' && row.ticketModel !== 'grouped'), 'saved vulnerability ticket model should affect candidate output');
  assert(result.candidates.some((row) => row.signal.type === 'UPDATE' && row.ticketModel === 'grouped'), 'saved update ticket model should affect candidate output');
  assert(result.candidates.some((row) => row.signal.type === 'AUTOMATION_FAILED' && row.ticketModel === 'grouped'), 'saved automation failed ticket model should affect candidate output');
}

function run() {
  runMappedOfflineIdentityTest();
  runGroupedIdentitySemanticsTest();
  runUnmappedOrgSkippedTest();
  runSavedSignalSettingsDriveQualificationTest();
  runTicketModelSettingsDriveCandidateModeTest();
}

run();
