const assert = require('assert');
const { createDbPolicyStore } = require('../policyStore');

async function run() {
  const reservations = [
    { policy_id: 'POL-ALL', organization_id: 'org-all', scope_type: 'ALL_ENDPOINTS', endpoint_group_id: null, enabled: 0 },
    { policy_id: 'POL-GROUP-A', organization_id: 'org-groups', scope_type: 'ENDPOINT_GROUP', endpoint_group_id: 'group-a', enabled: 0 },
    { policy_id: 'POL-GROUP-B', organization_id: 'org-groups', scope_type: 'ENDPOINT_GROUP', endpoint_group_id: 'group-b', enabled: 1 }
  ];
  const context = {
    db: {
      async all(sql, params) {
        assert(sql.includes('action1_configuration_manager_scope_reservations'));
        return reservations.filter((entry) => entry.organization_id === params[0]);
      }
    }
  };
  const store = createDbPolicyStore(context);

  const noReservations = await store.getOrganizationTargetAvailability('org-empty');
  assert.deepStrictEqual(noReservations, {
    allEndpointsAvailable: true,
    organizationBlockedByAllEndpoints: false,
    hasAnyGroupReservations: false,
    reservedEndpointGroupIds: [],
    reservedPolicyIdByEndpointGroupId: {}
  });

  const allReserved = await store.getOrganizationTargetAvailability('org-all');
  assert.strictEqual(allReserved.organizationBlockedByAllEndpoints, true);
  assert.strictEqual(allReserved.allEndpointsAvailable, false);
  assert.strictEqual(allReserved.hasAnyGroupReservations, false);

  const groupsReserved = await store.getOrganizationTargetAvailability('org-groups');
  assert.strictEqual(groupsReserved.organizationBlockedByAllEndpoints, false);
  assert.strictEqual(groupsReserved.allEndpointsAvailable, false);
  assert.strictEqual(groupsReserved.hasAnyGroupReservations, true);
  assert.deepStrictEqual(groupsReserved.reservedEndpointGroupIds.sort(), ['group-a', 'group-b']);
}

run().catch((error) => { console.error(error); process.exit(1); });
