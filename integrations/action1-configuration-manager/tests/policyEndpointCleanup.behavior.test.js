const assert = require('assert');
const {
  CLEANUP_RETRY_MINUTES,
  buildPolicyEndpointCleanupScript,
  buildPolicyEndpointCleanupInstance
} = require('../policyEndpointCleanup');
const { cleanupPolicy } = require('../lifecycleMutations');

function policy(overrides = {}) {
  return {
    policyId: 'POL-000037',
    baseName: 'Workstation Security',
    organizationId: 'org-acme',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-finance',
    ...overrides
  };
}

function correlations() {
  return {
    async listCorrelations() {
      return [{ active: true, automationGroupId: 'family-a', controlFamilyNameSnapshot: 'Family A', action1AutomationId: 'scheduled-1' }];
    },
    async markInactive() {}
  };
}

async function run() {
  assert.strictEqual(CLEANUP_RETRY_MINUTES, 10080);

  const script = buildPolicyEndpointCleanupScript('POL-000037');
  assert(script.includes("$baseDirectory = 'C:\\Windows\\Action1\\ConfigurationManager'"));
  assert(script.includes("$policyId = 'POL-000037'"));
  assert(script.includes('$policyDirectory = Join-Path $baseDirectory $policyId'));
  assert(script.includes("Test-Path -LiteralPath $policyDirectory -PathType Container"));
  assert(script.includes('Remove-Item `'));
  assert(script.includes('-Recurse'));
  assert(script.includes('-Force'));
  assert(!script.includes("Remove-Item -LiteralPath $baseDirectory"));
  assert.throws(() => buildPolicyEndpointCleanupScript('POL-000038/..'), /policy id/i);
  assert(!buildPolicyEndpointCleanupScript('POL-000037').includes('POL-000038'));

  const groupInstance = buildPolicyEndpointCleanupInstance(policy());
  assert.strictEqual(groupInstance.organizationId, 'org-acme');
  assert.deepStrictEqual(groupInstance.payload.endpoints, [{ id: 'group-finance', type: 'EndpointGroup' }]);
  assert.strictEqual(groupInstance.payload.retry_minutes, '10080');
  assert.strictEqual(groupInstance.payload.settings, undefined);
  assert.strictEqual(groupInstance.payload.actions.length, 1);
  assert.strictEqual(groupInstance.payload.actions[0].name, 'Run PowerShell');
  assert.strictEqual(groupInstance.payload.actions[0].template_id, 'run_script');
  assert.deepStrictEqual(Object.keys(groupInstance.payload.actions[0].params).sort(), [
    'condition_script_language',
    'condition_script_text',
    'display_summary',
    'run_script_language',
    'run_script_params',
    'run_script_text'
  ]);
  assert.strictEqual(groupInstance.payload.actions[0].params.display_summary, '');
  assert.strictEqual(groupInstance.payload.actions[0].params.condition_script_text, '');
  assert.strictEqual(groupInstance.payload.actions[0].params.condition_script_language, 'PowerShell');
  assert.deepStrictEqual(groupInstance.payload.actions[0].params.run_script_params, []);
  assert.strictEqual(groupInstance.payload.actions[0].params.run_script_language, 'PowerShell');
  assert(!Object.hasOwn(groupInstance.payload.actions[0].params, 'reboot_options'));
  assert(groupInstance.name.includes('A1CM'));
  assert(groupInstance.name.includes('POL-000037'));
  assert(groupInstance.name.includes('State Cleanup'));
  assert(groupInstance.payload.actions[0].params.run_script_text.includes('POL-000037'));

  const allInstance = buildPolicyEndpointCleanupInstance(policy({ scopeType: 'ALL_ENDPOINTS', endpointGroupId: '' }));
  assert.deepStrictEqual(allInstance.payload.endpoints, [{ id: 'ALL', type: 'EndpointGroup' }]);

  const calls = [];
  const client = {
    async deleteAutomation(orgId, id) { calls.push(['delete', orgId, id]); return { status: 'deleted' }; },
    async createAutomationInstance(orgId, instance) { calls.push(['instance', orgId, instance]); return { id: 'instance-1' }; }
  };
  const history = await cleanupPolicy({}, policy(), { client, correlations: correlations() });
  assert.deepStrictEqual(calls.map((entry) => entry[0]), ['delete', 'instance']);
  assert.strictEqual(calls[1][1], 'org-acme');
  assert.strictEqual(history.cleanup.instanceId, 'instance-1');

  await assert.rejects(
    () => cleanupPolicy({}, policy(), { client: { ...client, async createAutomationInstance() { const error = new Error('HTTP 400'); error.statusCode = 400; throw error; } }, correlations: correlations() }),
    /HTTP 400/
  );
  await assert.rejects(
    () => cleanupPolicy({}, policy(), { client: { ...client, async createAutomationInstance() { throw new Error('socket timeout'); } }, correlations: correlations() }),
    /socket timeout/
  );
}

run().catch((error) => { console.error(error); process.exit(1); });
