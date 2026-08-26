const assert = require('assert');
const { buildOverviewViewModel, getOverview } = require('../overviewService');

function endpoint(name, platform = 'Windows') {
  return { id: `${name}-id`, name, platform, status: 'Disconnected', organizationId: 'org-1' };
}

function policy(overrides = {}) {
  return {
    policyId: 'POL-000001',
    baseName: 'Windows Hardening',
    displayName: 'Windows Hardening — Prod Servers',
    organizationId: 'org-1',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-prod',
    endpointGroupNameSnapshot: 'Prod Servers',
    enabled: true,
    selectedControls: [{ controlId: 'a' }, { controlId: 'b' }, { controlId: 'c' }, { controlId: 'd' }, { controlId: 'e' }],
    ...overrides
  };
}

async function run() {
  const result = buildOverviewViewModel({
    policies: [policy(), policy({ policyId: 'POL-000002', enabled: false }), policy({ policyId: 'POL-000003', enabled: true, organizationId: 'org-2', selectedControls: [{ controlId: 'a' }] })],
    assignedEndpointsByPolicy: {
      'POL-000001': [endpoint('BOX1'), endpoint('BOX2'), endpoint('BOX3'), endpoint('BOX4'), endpoint('BOX5'), endpoint('BOX6')],
      'POL-000003': [endpoint('BOX1')]
    },
    observedRows: [
      { policyId: 'POL-000001', policyName: policy().baseName, endpointName: 'BOX1', details: 5 },
      { policyId: 'POL-000001', policyName: policy().baseName, endpointName: 'BOX2', details: 3 },
      { policyId: 'POL-000001', policyName: policy().baseName, endpointName: 'BOX3', details: 7 },
      { policyId: 'POL-000003', policyName: 'Other', endpointName: 'BOX1', details: 1 }
    ],
    nonCompliantRows: [
      { policyId: 'POL-000001', endpointName: 'BOX1', details: 0 },
      { policyId: 'POL-000001', endpointName: 'BOX3', details: 2 },
      { policyId: 'POL-000003', endpointName: 'BOX1', details: 0 }
    ]
  });

  assert.strictEqual(result.policies.length, 2, 'disabled Policies must be excluded');
  const first = result.policies.find((entry) => entry.policyId === 'POL-000001');
  assert.deepStrictEqual(first.scope, { type: 'ENDPOINT_GROUP', endpointGroupId: 'group-prod', name: 'Prod Servers' });
  assert.deepStrictEqual({
    assigned: first.assignedCount,
    fully: first.fullyEvaluatedCount,
    compliant: first.compliantCount,
    attention: first.needsAttentionCount,
    partial: first.partialCount,
    noData: first.noDataCount,
    inconsistent: first.inconsistentCount,
    notFully: first.notFullyEvaluatedCount,
    coverage: first.evaluationCoveragePercent,
    compliance: first.compliancePercent
  }, { assigned: 6, fully: 1, compliant: 1, attention: 0, partial: 1, noData: 3, inconsistent: 1, notFully: 5, coverage: 16.67, compliance: 100 });
  assert.strictEqual(result.endpointAttention.length, 0, 'inconsistent endpoints must not appear as compliant attention rows');

  const zero = buildOverviewViewModel({ policies: [policy({ policyId: 'POL-ZERO', selectedControls: [{ controlId: 'a' }] })], assignedEndpointsByPolicy: { 'POL-ZERO': [] }, observedRows: [], nonCompliantRows: [] }).policies[0];
  assert.strictEqual(zero.evaluationCoveragePercent, null);
  assert.strictEqual(zero.compliancePercent, null);

  const attention = buildOverviewViewModel({
    policies: [policy({ policyId: 'POL-ATTN', selectedControls: [{ controlId: 'a' }, { controlId: 'b' }] })],
    assignedEndpointsByPolicy: { 'POL-ATTN': [endpoint('BOX9')] },
    observedRows: [{ policyId: 'POL-ATTN', endpointName: 'BOX9', details: 2 }],
    nonCompliantRows: [{ policyId: 'POL-ATTN', endpointName: 'BOX9', details: 1 }]
  });
  assert.strictEqual(attention.policies[0].needsAttentionCount, 1);
  assert.strictEqual(attention.policies[0].compliantCount, 0);
  assert.deepStrictEqual(attention.endpointAttention, [{ endpointName: 'BOX9', policyId: 'POL-ATTN', policyName: 'Windows Hardening', nonCompliantCount: 1 }]);

  const calls = { all: 0, group: 0, reports: [] };
  const serviceResult = await getOverview({}, {
    policyStore: { async listPolicies() { return [policy(), policy({ policyId: 'POL-OTHER', organizationId: 'org-2', scopeType: 'ALL_ENDPOINTS', endpointGroupId: null, enabled: true, selectedControls: [{ controlId: 'a' }] })]; } },
    reportingState: { dashboardEndpoints: 'report-a', dashboardNonCompliantEndpoints: 'report-b' },
    client: {
      async listManagedEndpoints(org) { calls.all += 1; return [{ id: `${org}-1`, name: `Win-${org}`, platform: 'Windows', organization_id: org }]; },
      async listEndpointGroupContents(org) { calls.group += 1; return [{ id: `${org}-1`, name: `Win-${org}`, platform: 'Windows', organization_id: org }]; },
      async listReportData(org, reportId) { calls.reports.push(`${org}:${reportId}`); return [{ 'Policy ID': org === 'org-1' ? 'POL-000001' : 'POL-OTHER', 'Policy Name': 'Policy', 'Endpoint Name': `Win-${org}`, Details: 5 }]; }
    }
  });
  assert.strictEqual(serviceResult.policies.length, 2);
  assert.strictEqual(calls.group, 1);
  assert.strictEqual(calls.all, 1);
  assert.deepStrictEqual(calls.reports.sort(), ['org-1:report-a', 'org-1:report-b', 'org-2:report-a', 'org-2:report-b']);

  const scoped = buildOverviewViewModel({
    policies: [policy({ policyId: 'POL-SAME', organizationId: 'org-1', selectedControls: [{ controlId: 'a' }] }), policy({ policyId: 'POL-SAME', organizationId: 'org-2', selectedControls: [{ controlId: 'a' }] })],
    assignedEndpointsByPolicy: { 'POL-SAME': [endpoint('BOX-SAME')] },
    observedRows: [{ organizationId: 'org-2', policyId: 'POL-SAME', endpointName: 'BOX-SAME', details: 1 }],
    nonCompliantRows: []
  });
  assert.strictEqual(scoped.policies[0].noDataCount, 1, 'report rows from another organization must not cross-match');
}

run().catch((error) => { console.error(error); process.exit(1); });
