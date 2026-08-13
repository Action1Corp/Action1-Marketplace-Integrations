const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function run() {
  const source = readSource('ui/policies/PolicyPage.jsx');
  assert(source.includes('createPolicyDiscoveryApi(integration)'), 'PolicyPage should create the async discovery API');
  assert(source.includes('createAction1OrganizationRepository'), 'PolicyPage should create the organization discovery repository');
  assert(source.includes('createAction1EndpointGroupRepository'), 'PolicyPage should create the endpoint-group discovery repository');
  assert(source.includes('organizationsLoading'), 'PolicyPage should track organization loading state');
  assert(source.includes('organizationsError'), 'PolicyPage should track organization error state');
  assert(source.includes('loadEndpointGroupsForOrganization'), 'PolicyPage should load endpoint groups asynchronously');
  assert(source.includes('endpointGroupStateByOrganization'), 'PolicyPage should track endpoint-group loading state by organization');
  assert(source.includes('allEndpointsAvailableByOrganization'), 'PolicyPage should track all-endpoints availability by organization');
  assert(source.includes("mode.kind === 'create'"), 'PolicyPage should limit target rediscovery to create mode');
  assert(!source.includes('createDemoOrganizationRepository'), 'PolicyPage should remove the demo organization repository seam');
  assert(!source.includes('createDemoEndpointGroupRepository'), 'PolicyPage should remove the demo endpoint-group repository seam');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
