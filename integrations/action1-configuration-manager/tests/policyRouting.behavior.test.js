const assert = require('assert');
async function run() {
  const {
    buildPolicyDetailsPath,
    buildPoliciesPath,
    buildPoliciesListPath,
    getPolicyIdFromSearch
  } = await import('../ui/policies/policyRouting.js');
  const integration = 'action1-configuration-manager';
  assert.strictEqual(buildPoliciesPath(integration), '/apps/action1-configuration-manager/policies');
  assert.strictEqual(
    buildPolicyDetailsPath(integration, 'POL-000123'),
    '/apps/action1-configuration-manager/policies?policyId=POL-000123'
  );
  assert(!buildPolicyDetailsPath(integration, 'POL-000123').includes('/policies/POL-000123'));
  assert.strictEqual(
    getPolicyIdFromSearch('?policyId=POL-000123'),
    'POL-000123'
  );
  assert.strictEqual(
    getPolicyIdFromSearch(''),
    null
  );
  assert.strictEqual(
    buildPolicyDetailsPath(integration, 'POL/000123', '?tab=overview'),
    '/apps/action1-configuration-manager/policies?tab=overview&policyId=POL%2F000123'
  );
  assert.strictEqual(
    buildPoliciesListPath(integration, '?tab=overview&policyId=POL-000123'),
    '/apps/action1-configuration-manager/policies?tab=overview'
  );
  assert.strictEqual(
    getPolicyIdFromSearch('?policyId=POL-000123&other=kept'),
    'POL-000123'
  );
  assert.strictEqual(getPolicyIdFromSearch(''), null);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
