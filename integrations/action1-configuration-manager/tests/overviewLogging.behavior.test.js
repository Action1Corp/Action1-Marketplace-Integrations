const assert = require('assert');
const { getOverview } = require('../overviewService');

async function run() {
  const messages = [];
  let refreshReads = 0;
  const context = {
    action1ConfigurationManagerRuntimeLogger: {
      async info(message) { messages.push(message); },
      async debug(message) { messages.push(message); },
      async warn(message) { messages.push(message); },
      async error(message) { messages.push(message); }
    },
    logger: { info() {} }
  };
  const policy = {
    policyId: 'POL-000053',
    baseName: 'Test Policy',
    organizationId: '3d3efe00-d7bb-11f0-b156-3bcf0b961a7f',
    scopeType: 'ALL_ENDPOINTS',
    enabled: true,
    selectedControls: Array.from({ length: 23 }, (_, index) => ({ controlId: String(index) }))
  };
  const result = await getOverview(context, {
    operationType: 'manual-refresh',
    policyStore: { async listPolicies() { return [policy]; } },
    reportingState: { dashboardEndpoints: 'dashboard-endpoints-id', dashboardNonCompliantEndpoints: 'dashboard-non-compliant-id', dashboardNonCompliantControls: 'dashboard-non-compliant-controls-id' },
    client: {
      async listManagedEndpoints() { return [{ id: 'endpoint-26', name: 'BOX26', platform: 'Windows', status: 'Disconnected' }]; },
      async listReportData(org, reportId, options) {
        refreshReads += 1;
        options.onPage({ page: 1, statusCode: 200, rowCount: 1, totalLiveResponses: refreshReads > 4 ? 2 : 0, totalSentRequests: 2, lastRequery: refreshReads > 4 ? '2026-08-26T19:00:01Z' : '2026-08-26T19:00:00Z' });
        if (reportId === 'dashboard-endpoints-id') return [{ 'Policy ID': 'POL-000053', 'Policy Name': 'Test Policy', 'Endpoint Name': 'BOX26', Details: 22 }];
        if (reportId === 'dashboard-non-compliant-id') return [{ 'Policy ID': 'POL-000053', 'Endpoint Name': 'BOX26', Details: 0 }];
        return [{ 'Policy ID': 'POL-000053', 'Control Name': 'Minimum password length', Details: 2 }];
      },
      async requestAction1Mutation() {}
    }
  });
  assert.strictEqual(result.policies[0].fullyEvaluatedCount, 0);
  assert.strictEqual(result.policies[0].partialCount, 1);
  assert(messages.some((message) => message.includes('Dashboard refresh started') && message.includes('activePolicies=1')));
  assert(messages.some((message) => message.includes('Dashboard report endpoint') && message.includes('BOX26') && message.includes('observedControlCount') && message.includes('22')));
  assert(messages.some((message) => message.includes('Dashboard endpoint') && message.includes('BOX26') && message.includes('PARTIAL')));
  assert(messages.some((message) => message.includes('Dashboard policy evaluated') && message.includes('assigned=1') && message.includes('evaluated=0') && message.includes('partial=1') && message.includes('coverage=0%') && message.includes('compliance=—')));
  assert(messages.some((message) => message.includes('Dashboard reports loaded') && message.includes('policy=POL-000053')));
  assert(messages.some((message) => message.includes('Dashboard refresh completed') && message.includes('policies=1') && message.includes('assigned=1') && message.includes('evaluated=0') && message.includes('partial=1') && message.includes('elapsed=')));
  assert(!messages.some((message) => message.includes('policy-aggregate') || message.includes('policy-result') || message.includes('overview-aggregate')));
  assert(messages.filter((message) => message.includes('Dashboard policy evaluated')).length === 1);
  assert(messages.every((message) => !message.includes('apiSecret') && !message.includes('apiKey') && !message.includes('Bearer')));
}

run().catch((error) => { console.error(error); process.exit(1); });
