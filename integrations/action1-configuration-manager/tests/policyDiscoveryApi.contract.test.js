const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          organizations: [{ organizationId: 'org-acme', organizationName: 'Acme Corp' }],
          organizationId: 'org-acme',
          allEndpointsAvailable: false,
          endpointGroups: [{ endpointGroupId: 'group-open', endpointGroupName: 'Open Group', endpointCount: 12 }]
        };
      }
    };
  };

  const { createPolicyDiscoveryApi } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyDiscoveryApi.js')).href
  );

  const api = createPolicyDiscoveryApi('action1-configuration-manager');
  const organizations = await api.listOrganizations();
  assert.deepStrictEqual(organizations, [{ organizationId: 'org-acme', organizationName: 'Acme Corp' }]);
  assert.strictEqual(fetchCalls[0].url, '/api/integrations/action1-configuration-manager/actions/discover-policy-organizations');
  assert.strictEqual(fetchCalls[0].options.method, 'POST');

  const endpointGroupResult = await api.listEndpointGroups('org-acme', { policyId: 'POL-000010' });
  assert.deepStrictEqual(endpointGroupResult, {
    organizationId: 'org-acme',
    allEndpointsAvailable: false,
    organizationBlockedByAllEndpoints: false,
    hasAnyGroupReservations: false,
    reservedEndpointGroupIds: [],
    endpointGroups: [{ endpointGroupId: 'group-open', endpointGroupName: 'Open Group', endpointCount: 12 }]
  });
  assert.deepStrictEqual(JSON.parse(fetchCalls[1].options.body), {
    payload: { organizationId: 'org-acme', policyId: 'POL-000010' }
  });

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { ok: false, message: 'Organization discovery failed.' };
    }
  });
  await assert.rejects(() => api.listOrganizations(), /Organization discovery failed/);

  global.fetch = async () => ({
    ok: false,
    async json() {
      throw new Error('bad json');
    }
  });
  await assert.rejects(() => api.listEndpointGroups('org-acme'), /Unable to complete the policy discovery request/);
}

try {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
