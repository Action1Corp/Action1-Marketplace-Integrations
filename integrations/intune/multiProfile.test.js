const assert = require('node:assert/strict');
const test = require('node:test');
const { createIntunePolicyStore } = require('./policyStore');
const { buildOrganizationPlatformPlans } = require('./sync');

function makeStore() {
  const values = new Map();
  return createIntunePolicyStore({ settings: {
    get: async key => values.get(key),
    set: async (key, value) => values.set(key, value)
  } });
}

function profile(name, endpointGroupId, intuneGroupId, overrides = {}) {
  return {
    name,
    organizationId: 'org-1',
    organizationName: 'Org One',
    agentId: 'windows-installer',
    platforms: ['windows'],
    profileType: 'enrollmentAndProvisioning',
    assignmentMode: 'selectedGroups',
    intuneDeviceGroupIds: [intuneGroupId],
    monitoredAction1GroupIds: [endpointGroupId],
    ...overrides
  };
}

test('same organization accepts multiple profiles with exclusive endpoint groups', async () => {
  const store = makeStore();
  const first = await store.savePolicy(profile('First', 'endpoint-a', 'intune-a'));
  const second = await store.savePolicy(profile('Second', 'endpoint-b', 'intune-b'));
  assert.notEqual(first.policyId, second.policyId);
  assert.equal((await store.listPolicies()).length, 2);
  await assert.rejects(
    store.savePolicy(profile('Third', 'endpoint-a', 'intune-c')),
    /Action1 endpoint groups are already assigned to profile "First"/
  );
  await assert.rejects(
    store.savePolicy(profile('Third', 'endpoint-c', 'intune-a')),
    /Intune device groups are already assigned to profile "First"/
  );
  await store.savePolicy(profile('First', 'endpoint-c', 'intune-a', { policyId: first.policyId }));
  await store.savePolicy(profile('Third', 'endpoint-a', 'intune-c'));
  assert.equal((await store.listPolicies()).length, 3);
});

test('one plan per organization and platform combines profile assignments', () => {
  const plans = buildOrganizationPlatformPlans([
    profile('Windows A', 'endpoint-a', 'intune-a'),
    profile('Windows B', 'endpoint-b', 'intune-b'),
    profile('Mac', 'endpoint-c', 'intune-c', { platforms: ['macos'], agentIds: { macos: 'mac-installer' } })
  ]);
  const org = plans.get('org-1');
  assert.equal(plans.size, 1);
  assert.deepEqual(org.get('windows').intuneDeviceGroupIds, ['intune-a', 'intune-b']);
  assert.deepEqual(org.get('windows').platforms, ['windows']);
  assert.deepEqual(org.get('macos').intuneDeviceGroupIds, ['intune-c']);

  const allDevices = buildOrganizationPlatformPlans([
    profile('Selected', 'endpoint-a', 'intune-a'),
    profile('All', 'endpoint-b', 'intune-b', { assignmentMode: 'allDevices' })
  ]);
  assert.equal(allDevices.get('org-1').get('windows').assignmentMode, 'allDevices');
});
