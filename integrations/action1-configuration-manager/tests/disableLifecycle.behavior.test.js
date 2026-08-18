const assert = require('assert');
const { disablePolicy } = require('../lifecycleMutations');

const policy = { policyId: 'POL-DISABLE', organizationId: 'org-1' };
const rows = [
  { automationGroupId: 'family-a', controlFamilyNameSnapshot: 'Family A', action1AutomationId: 'auto-a' },
  { automationGroupId: 'family-b', controlFamilyNameSnapshot: 'Family B', action1AutomationId: 'auto-b' }
];
const context = { action1ConfigurationManagerRuntimeLogger: { info() {}, debug() {}, warn() {}, error() {} } };

async function run() {
  const deleted = [];
  const inactive = [];
  const correlations = { async listCorrelations() { return rows; }, async markInactive(policyId, groupId) { inactive.push([policyId, groupId]); } };
  const client = { async deleteAutomation(orgId, id) { deleted.push([orgId, id]); return { status: 'deleted' }; } };
  const result = await disablePolicy(context, policy, { client, correlations });
  assert.deepStrictEqual(result.counts, { deleted: 2, failed: 0 });
  assert.deepStrictEqual(deleted, [['org-1', 'auto-a'], ['org-1', 'auto-b']]);
  assert.deepStrictEqual(inactive, [['POL-DISABLE', 'family-a'], ['POL-DISABLE', 'family-b']]);

  const partialInactive = [];
  let call = 0;
  await assert.rejects(() => disablePolicy(context, policy, {
    client: { async deleteAutomation() { call += 1; if (call === 2) throw new Error('delete unresolved'); return { status: 'deleted' }; } },
    correlations: { async listCorrelations() { return rows; }, async markInactive(policyId, groupId) { partialInactive.push([policyId, groupId]); } }
  }));
  assert.deepStrictEqual(partialInactive, [['POL-DISABLE', 'family-a']]);
}

run().catch((error) => { console.error(error); process.exit(1); });
