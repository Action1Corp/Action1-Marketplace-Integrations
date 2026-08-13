const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function run() {
  const policyPageSource = readSource('ui/policies/PolicyPage.jsx');
  assert(policyPageSource.includes('createPolicyApi(integration)'), 'PolicyPage should use the production policy action client');
  assert(!policyPageSource.includes('createDemoPolicyRepository'), 'PolicyPage should no longer use the in-memory demo policy repository');
  assert(!policyPageSource.includes('https://action1.example.test/automations/'), 'PolicyPage should not create deterministic fake Action1 URLs once persistence is production-backed');

  const policyApiSource = readSource('ui/policies/policyApi.js');
  assert(policyApiSource.includes("fetch(`/api/integrations/${integration}/actions/${actionId}`"), 'policyApi should call the manifest action boundary');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
