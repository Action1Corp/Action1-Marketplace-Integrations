const assert = require('assert');
async function run() {
  const { getPolicyRouteFromSearch, buildPolicyEditPath, buildPolicyCreatePath } = await import('../ui/policies/policyRouting.js');
  assert.deepStrictEqual(getPolicyRouteFromSearch('?policyId=POL-000064'), { kind: 'details', policyId: 'POL-000064' });
  assert.deepStrictEqual(getPolicyRouteFromSearch('?policyId=POL-000064&mode=edit'), { kind: 'edit', policyId: 'POL-000064' });
  assert.deepStrictEqual(getPolicyRouteFromSearch('?mode=create'), { kind: 'create', policyId: null, policyName: '' });
  const name = 'Remote Workforce & + # 日本語';
  assert.deepStrictEqual(getPolicyRouteFromSearch(`?mode=create&policyId=ignored&${new URLSearchParams({ policyName: name })}`), { kind: 'create', policyId: null, policyName: name });
  assert.deepStrictEqual(getPolicyRouteFromSearch('?mode=unsupported&policyId=POL-000064&policyName=ignored'), { kind: 'details', policyId: 'POL-000064' });
  assert.deepStrictEqual(getPolicyRouteFromSearch('?mode=unsupported&policyName=ignored'), { kind: 'list', policyId: null });
  assert.strictEqual(getPolicyRouteFromSearch('?mode=edit&policyId=%20').kind, 'invalid');
  assert.strictEqual(buildPolicyEditPath('action1-configuration-manager', 'POL-000064', '?mode=create&policyName=old'), '/apps/action1-configuration-manager/policies?policyId=POL-000064&mode=edit');
  assert.strictEqual(buildPolicyCreatePath('action1-configuration-manager', '?policyId=old&mode=edit&policyName=old'), '/apps/action1-configuration-manager/policies?mode=create');
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
  assert.strictEqual(buildPolicyDetailsPath(integration, 'POL-000064', '?mode=edit&policyName=ignored'), '/apps/action1-configuration-manager/policies?policyId=POL-000064');
  assert.strictEqual(buildPoliciesListPath(integration, '?mode=create&policyName=ignored&policyId=old'), '/apps/action1-configuration-manager/policies');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
