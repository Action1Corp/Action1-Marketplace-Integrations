const assert = require('assert');
const { getOverview } = require('../overviewService');

async function run() {
  const requests = [];
  const readCounts = new Map();
  const policy = {
    policyId: 'POL-000054',
    baseName: 'Configuration Policy',
    organizationId: 'org-1',
    scopeType: 'ALL_ENDPOINTS',
    enabled: true,
    selectedControls: Array.from({ length: 4 }, (_, index) => ({ controlId: String(index) }))
  };
  const result = await getOverview({}, {
    operationType: 'manual-refresh',
    refreshIntervalMs: 0,
    refreshTimeoutMs: 20,
    sleep: async () => {},
    policyStore: { async listPolicies() { return [policy]; } },
    reportingState: { dashboardEndpoints: 'endpoints-report', dashboardNonCompliantEndpoints: 'attention-report' },
    client: {
      async listManagedEndpoints() { return [{ id: 'endpoint-27', name: 'BOX27', platform: 'Windows' }]; },
      async listReportData(org, reportId, options) {
        const count = (readCounts.get(reportId) || 0) + 1;
        readCounts.set(reportId, count);
        const complete = count >= 3;
        options.onPage({
          page: 1,
          statusCode: 200,
          rowCount: complete ? 1 : 0,
          totalLiveResponses: complete ? 2 : 0,
          totalSentRequests: 2,
          lastRequery: complete ? 'new' : 'old'
        });
        return complete
          ? [{ 'Policy ID': 'POL-000054', 'Policy Name': 'Configuration Policy', 'Endpoint Name': 'BOX27', Details: reportId === 'endpoints-report' ? 4 : 2 }]
          : [];
      },
      async requestAction1Mutation(input) {
        requests.push(input);
      }
    }
  });

  assert.deepStrictEqual(requests.map((request) => ({ method: request.method, path: request.path })), [
    { method: 'POST', path: '/reportdata/org-1/endpoints-report/requery' },
    { method: 'POST', path: '/reportdata/org-1/attention-report/requery' }
  ]);
  assert.strictEqual(result.policies[0].fullyEvaluatedCount, 1, 'aggregation must use the completed endpoint report');
  assert.strictEqual(result.policies[0].needsAttentionCount, 1, 'aggregation must use the completed non-compliant report');
  assert.strictEqual(readCounts.get('endpoints-report'), 3);
  assert.strictEqual(readCounts.get('attention-report'), 3);
}

run().catch((error) => { console.error(error); process.exit(1); });
