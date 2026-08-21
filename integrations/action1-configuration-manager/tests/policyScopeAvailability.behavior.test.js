const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const { buildPolicyScopeAvailability } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyScopeAvailability.js')).href);

  const empty = buildPolicyScopeAvailability({
    allEndpointsAvailable: true,
    organizationBlockedByAllEndpoints: false,
    hasAnyGroupReservations: false,
    endpointGroups: [{ endpointGroupId: 'group-a', endpointGroupName: 'Group A' }]
  });
  assert.strictEqual(empty.allEndpointsAvailable, true);
  assert.strictEqual(empty.endpointGroupModeAvailable, true);
  assert.strictEqual(empty.selectableEndpointGroups.length, 1);
  assert.strictEqual(empty.targetError('ALL_ENDPOINTS', ''), '');

  const all = buildPolicyScopeAvailability({
    allEndpointsAvailable: false,
    organizationBlockedByAllEndpoints: true,
    hasAnyGroupReservations: false,
    endpointGroups: [{ endpointGroupId: 'group-a', endpointGroupName: 'Group A' }]
  });
  assert.strictEqual(all.allEndpointsAvailable, false);
  assert.strictEqual(all.endpointGroupModeAvailable, false);
  assert.strictEqual(all.selectableEndpointGroups.length, 0);
  assert(all.targetError('ALL_ENDPOINTS', '').includes('already covered'));
  assert(all.targetError('ENDPOINT_GROUP', '').includes('already covered'));

  const groups = buildPolicyScopeAvailability({
    allEndpointsAvailable: false,
    organizationBlockedByAllEndpoints: false,
    hasAnyGroupReservations: true,
    endpointGroups: [
      { endpointGroupId: 'group-a', endpointGroupName: 'Group A', reserved: true },
      { endpointGroupId: 'group-b', endpointGroupName: 'Group B', reserved: false }
    ]
  });
  assert.strictEqual(groups.allEndpointsAvailable, false);
  assert.strictEqual(groups.endpointGroupModeAvailable, true);
  assert.deepStrictEqual(groups.selectableEndpointGroups.map((entry) => entry.endpointGroupId), ['group-b']);
  assert(groups.targetError('ALL_ENDPOINTS', '').includes('group-scoped Policies'));
  assert.strictEqual(groups.targetError('ENDPOINT_GROUP', 'group-b'), '');
  assert(groups.targetError('ENDPOINT_GROUP', 'group-a').includes('another Policy'));

  const allGroups = buildPolicyScopeAvailability({
    allEndpointsAvailable: false,
    organizationBlockedByAllEndpoints: false,
    hasAnyGroupReservations: true,
    endpointGroups: [{ endpointGroupId: 'group-a', endpointGroupName: 'Group A', reserved: true }]
  });
  assert.strictEqual(allGroups.selectableEndpointGroups.length, 0);
  assert(allGroups.targetError('ENDPOINT_GROUP', '').includes('No endpoint groups'));
}

run().catch((error) => { console.error(error); process.exit(1); });
