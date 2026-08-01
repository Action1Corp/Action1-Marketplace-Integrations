const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const { createDemoPolicyRepository } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'demo', 'demoPolicyRepository.js')).href
  );
  const { createDemoOrganizationRepository } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'demo', 'demoOrganizationRepository.js')).href
  );
  const { createDemoEndpointGroupRepository } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'demo', 'demoEndpointGroupRepository.js')).href
  );

  const organizations = createDemoOrganizationRepository().listOrganizations();
  assert.strictEqual(Array.isArray(organizations), true, 'demo organization repository should return an array');
  assert.strictEqual(organizations.length > 0, true, 'demo organization repository should expose at least one demo organization');
  assert.strictEqual(typeof organizations[0].organizationId, 'string', 'demo organization repository should expose stable organization ids');
  assert.strictEqual(typeof organizations[0].organizationName, 'string', 'demo organization repository should expose organization names');

  const endpointGroups = createDemoEndpointGroupRepository().listEndpointGroups(organizations[0].organizationId);
  assert.strictEqual(Array.isArray(endpointGroups), true, 'demo endpoint-group repository should return an array');
  assert.strictEqual(endpointGroups.length > 0, true, 'demo endpoint-group repository should expose demo endpoint groups for the first organization');
  assert.strictEqual(typeof endpointGroups[0].endpointGroupId, 'string', 'demo endpoint-group repository should expose stable endpoint-group ids');
  assert.strictEqual(typeof endpointGroups[0].endpointGroupName, 'string', 'demo endpoint-group repository should expose endpoint-group names');

  const policyRepository = createDemoPolicyRepository();
  assert.deepStrictEqual(policyRepository.listPolicies(), [], 'demo policy repository should start empty for the Policies demo flow');
  assert.strictEqual(policyRepository.getPolicy('POL-999999'), null, 'demo policy repository should return null for an unknown policy id');

  const createdPolicy = policyRepository.createPolicy({
    policyId: 'POL-000001',
    baseName: 'Workstation Security',
    displayName: 'Workstation Security — Finance Workstations',
    organizationId: organizations[0].organizationId,
    organizationNameSnapshot: organizations[0].organizationName,
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: endpointGroups[0].endpointGroupId,
    endpointGroupNameSnapshot: endpointGroups[0].endpointGroupName,
    policyMode: 'ASSESS_ONLY',
    runSchedule: {
      runEveryHours: 6
    },
    completionDeadlineMinutes: 360,
    controlPackId: 'windows-endpoint-configuration',
    controlPackVersion: '0.1.0',
    selectedControls: [
      {
        controlId: 'identity.password.minimum-length',
        controlVersion: '0.1.0',
        automationGroupId: 'identity.password-policy',
        automationGroupVersion: '0.1.0',
        parameters: { minimumLength: 14 }
      }
    ]
  });

  assert.strictEqual(createdPolicy.policyId, 'POL-000001', 'demo policy repository should preserve the provided policy id');
  assert.strictEqual(policyRepository.listPolicies().length, 1, 'demo policy repository should expose created policies in-memory');
  assert.strictEqual(
    policyRepository.getPolicy('POL-000001').displayName,
    'Workstation Security — Finance Workstations',
    'demo policy repository should return created policies by id'
  );

  const updatedPolicy = policyRepository.updatePolicy('POL-000001', {
    ...createdPolicy,
    baseName: 'Workstation Security Updated',
    displayName: 'Workstation Security Updated — Finance Workstations',
    policyMode: 'ASSESS_AND_REMEDIATE'
  });

  assert.strictEqual(updatedPolicy.baseName, 'Workstation Security Updated', 'demo policy repository should update mutable policy fields in memory');
  assert.strictEqual(updatedPolicy.policyMode, 'ASSESS_AND_REMEDIATE', 'demo policy repository should persist updated policy mode in memory');
  assert.strictEqual(
    policyRepository.getPolicy('POL-000001').displayName,
    'Workstation Security Updated — Finance Workstations',
    'demo policy repository should expose the updated policy shape from getPolicy'
  );
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
