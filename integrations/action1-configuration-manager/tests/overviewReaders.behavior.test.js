const assert = require('assert');
const { createAction1DiscoveryClient } = require('../action1DiscoveryClient');
const { normalizeReportRow, normalizeEndpointRow } = require('../overviewService');

function context() {
  const requests = [];
  let token = 0;
  return {
    requests,
    action1: { async getCredentials() { return { baseUrl: 'https://action1.test/api/3.0', apiKey: 'key', apiSecret: 'secret' }; } },
    async http(options) {
      requests.push(options);
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: `token-${++token}`, expires_in: 3600 }, headers: {} };
      const url = new URL(options.url);
      const from = url.searchParams.get('from') || '0';
      if (url.pathname.endsWith('/endpoints/managed/org-1')) return { status: 200, data: Number(from) === 0 ? { items: [{ id: '1', name: 'Win1', platform: 'Windows', organization_id: 'org-1', status: 'Disconnected' }], total_items: 2, from: 0, next_page: '/endpoints/managed/org-1?limit=100&from=1' } : { items: [{ id: '2', name: 'Linux1', platform: 'Linux', organization_id: 'org-1' }], total_items: 2, from: 1 }, headers: {} };
      if (url.pathname.endsWith('/endpoints/groups/org-1/group-1/contents')) return { status: 200, data: Number(from) === 0 ? { items: [{ id: '3', name: 'Win2', platform: 'Windows', organization_id: 'org-1' }], next_page: '/endpoints/groups/org-1/group-1/contents?limit=100&from=1' } : { items: [{ id: '4', name: 'Mac1', platform: 'macOS', organization_id: 'org-1' }] }, headers: {} };
      if (url.pathname.endsWith('/reportdata/org-1/201/data')) {
        if (url.searchParams.get('limit') === '500') return { status: 200, data: { items: [], total_items: 0 }, headers: {} };
        return { status: 200, data: Number(from) === 0 ? { items: [{ 'Policy ID': 'POL-1', 'Policy Name': 'Policy', 'Endpoint Name': 'Win1', Details: '2' }], next_page: '/reportdata/org-1/201/data?limit=100&from=1' } : { items: [{ 'Policy ID': 'POL-1', 'Policy Name': 'Policy', 'Endpoint Name': 'Win2', Details: 3 }], total_items: 2, from: 1 }, headers: {} };
      }
      return { status: 404, data: {}, headers: {} };
    },
    logger: { info() {}, warn() {}, error() {} }
  };
}

async function run() {
  const testContext = context();
  const client = createAction1DiscoveryClient(testContext);
  const managed = await client.listManagedEndpoints('org-1');
  assert.deepStrictEqual(managed.map(normalizeEndpointRow), [
    { id: '1', name: 'Win1', platform: 'Windows', status: 'Disconnected', organizationId: 'org-1' },
    { id: '2', name: 'Linux1', platform: 'Linux', status: '', organizationId: 'org-1' }
  ]);
  const group = await client.listEndpointGroupContents('org-1', 'group-1');
  assert.strictEqual(group.length, 2);
  const report = await client.listReportData('org-1', '201');
  assert.deepStrictEqual(report.map(normalizeReportRow), [
    { policyId: 'POL-1', policyName: 'Policy', endpointName: 'Win1', details: 2 },
    { policyId: 'POL-1', policyName: 'Policy', endpointName: 'Win2', details: 3 }
  ]);
  assert.deepStrictEqual(normalizeReportRow({ fields: { 'Policy ID': 'POL-FIELDS', 'Policy Name': 'Field Policy', 'Endpoint Name': 'BOX-FIELDS', Details: 4 } }), {
    policyId: 'POL-FIELDS', policyName: 'Field Policy', endpointName: 'BOX-FIELDS', details: 4
  });
  assert(testContext.requests.some((request) => request.url.includes('/endpoints/managed/org-1')));
  assert(testContext.requests.some((request) => request.url.includes('/endpoints/groups/org-1/group-1/contents')));
  assert(testContext.requests.some((request) => request.url.includes('/reportdata/org-1/201/data')));
  const reportRequest = testContext.requests.find((request) => request.url.includes('/reportdata/org-1/201/data'));
  assert(reportRequest.url.includes('limit=200&from=0&live_only=no&details=no'), 'Dashboard report reads must use the Action1 summary query contract');
}

run().catch((error) => { console.error(error); process.exit(1); });
