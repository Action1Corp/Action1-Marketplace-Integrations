const assert = require('assert');

const { runStage4CandidatePipeline } = require('../stage4CandidatePipeline');

function baseConfig(overrides = {}) {
  return {
    ticketDestination: {
      ticketTypeId: 'tt-1',
      closedStatusIds: ['closed-1']
    },
    lifecycle: {
      existingOpenTicketBehavior: 'update_existing_open'
    },
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
    orgClientMappings: overrides.orgClientMappings || []
  };
}

function mappingRow(mappingId, action1OrgId, haloClientId) {
  return {
    mappingId,
    action1OrgId,
    action1OrgName: action1OrgId,
    haloClientId,
    haloClientName: haloClientId,
    allowHaloClientToCreateAction1Org: false
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
      orgClientMappings: [mappingRow('map-1', 'org-1', 'client-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [{ id: 'ep-1', last_seen: '2026-05-01_00-00-00' }]
    },
    now: '2026-05-10T00:00:00Z'
  });

  const offline = result.candidates.find((row) => row.signal.type === 'OFFLINE');
  assert(offline, 'offline candidate should be created for mapped orgs');
  assert.strictEqual(offline.identity.key, 'map-1|ep-1|OFFLINE', 'endpoint candidate identity should preserve orgLinkId, endpointId, and signalType');
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
      orgClientMappings: [mappingRow('map-1', 'org-1', 'client-1')]
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

function runEndpointOnlySignalsStayEndpointModeTest() {
  const result = runStage4CandidatePipeline({
    enableGroupedAggregation: true,
    config: baseConfig({
      vulnerabilities: { ticketModel: 'grouped' },
      updates: { ticketModel: 'grouped' },
      automationFailed: { ticketModel: 'grouped' },
      signalFilters: {
        offline: { enabled: true, thresholdDays: 1 },
        rebootRequired: { enabled: true },
        automationFailed: { enabled: false },
        vulnerability: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] },
        update: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] }
      },
      orgClientMappings: [mappingRow('map-1', 'org-1', 'client-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [{ id: 'ep-1', last_seen: '2026-05-01_00-00-00', reboot_required: 'yes' }]
    },
    now: '2026-05-10T00:00:00Z'
  });

  const offline = result.candidates.find((row) => row.signal.type === 'OFFLINE');
  const reboot = result.candidates.find((row) => row.signal.type === 'REBOOT_REQUIRED');
  assert.strictEqual(offline.ticketModel, 'endpoint', 'OFFLINE should remain endpoint-only');
  assert.strictEqual(reboot.ticketModel, 'endpoint', 'REBOOT_REQUIRED should remain endpoint-only');
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
      orgClientMappings: []
    }),
    action1EndpointsByOrg: {
      'org-9': [{ id: 'ep-9', reboot_required: 'yes' }]
    }
  });

  assert.strictEqual(result.candidates.length, 0, 'unmapped orgs should not create candidates');
  assert(result.skipped.some((row) => row.reason === 'unmapped_org'), 'unmapped orgs should be skipped safely');
}

function runDisabledSignalsDoNotIncrementSkippedTest() {
  const result = runStage4CandidatePipeline({
    enableGroupedAggregation: true,
    config: baseConfig({
      signalFilters: {
        offline: { enabled: true, thresholdDays: 1 },
        rebootRequired: { enabled: false },
        automationFailed: { enabled: false },
        vulnerability: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] },
        update: { severities: [], remediationStatuses: ['OVERDUE', 'DUE_SOON'] }
      },
      vulnerabilities: { ticketModel: 'grouped' },
      updates: { ticketModel: 'grouped' },
      automationFailed: { ticketModel: 'grouped' },
      orgClientMappings: [mappingRow('map-1', 'org-1', 'client-1')]
    }),
    action1EndpointsByOrg: {
      'org-1': [{ id: 'ep-1', last_seen: '2026-05-01_00-00-00', reboot_required: 'yes' }]
    },
    signalDatasets: {
      vulnerabilitiesByEndpoint: {
        'org-1': {
          'ep-1': [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }]
        }
      },
      updatesByEndpoint: {
        'org-1': {
          'ep-1': [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'High', update_sla_status: 'Overdue' }]
        }
      },
      automationFailedByEndpoint: {
        'org-1': {
          'ep-1': [{ status: 'Error', instanceId: 'inst-1' }]
        }
      }
    },
    now: '2026-05-10T00:00:00Z'
  });

  assert.strictEqual(result.candidates.length, 1, 'only enabled signals should create candidates');
  assert.strictEqual(result.candidates[0].signal.type, 'OFFLINE', 'disabled signals should not create candidates');
  assert.strictEqual(result.skipped.some((row) => row.detail === 'signal_disabled'), false, 'disabled signals should not become skipped rows');
  assert.strictEqual(result.summary.skippedByReason.signal_not_qualified || 0, 0, 'disabled signals should not inflate skipped summary counts');
}

function run() {
  runMappedOfflineIdentityTest();
  runGroupedIdentitySemanticsTest();
  runEndpointOnlySignalsStayEndpointModeTest();
  runUnmappedOrgSkippedTest();
  runDisabledSignalsDoNotIncrementSkippedTest();
}

run();
