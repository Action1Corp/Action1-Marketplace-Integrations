const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function run() {
  const policyPageSource = readSource('ui/policies/PolicyPage.jsx');
  assert(!policyPageSource.includes('createDemoOrganizationRepository'), 'PolicyPage should no longer import the demo organization repository');
  assert(!policyPageSource.includes('createDemoEndpointGroupRepository'), 'PolicyPage should no longer import the demo endpoint-group repository');

  const discoveryApiSource = readSource('ui/policies/policyDiscoveryApi.js');
  assert(discoveryApiSource.includes('discover-policy-organizations'), 'policyDiscoveryApi should call the organizations discovery action');
  assert(discoveryApiSource.includes('discover-policy-endpoint-groups'), 'policyDiscoveryApi should call the endpoint-groups discovery action');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
