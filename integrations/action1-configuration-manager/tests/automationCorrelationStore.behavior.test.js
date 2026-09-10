const assert = require('assert');
const path = require('path');

function createDb() {
  const rows = [];
  return {
    rows,
    async run(sql, params = []) {
      if (sql.includes('INSERT INTO action1_configuration_manager_automation_correlations')) {
        assert.strictEqual((sql.match(/\?/g) || []).length + 1, 13, 'correlation INSERT must bind exactly the 13 schema columns');
        const existing = rows.find((row) => row.policy_id === params[0] && row.automation_group_id === params[1]);
        if (existing) throw new Error('duplicate correlation');
        rows.push({
          policy_id: params[0], automation_group_id: params[1], automation_group_version: params[2],
          control_family_name_snapshot: params[3], action1_organization_id: params[4],
          action1_automation_id: params[5], action1_automation_action_id: params[6], action1_automation_name: params[7],
          action1_automation_self: params[8], desired_definition_fingerprint: params[9],
          last_applied_at: params[10], last_error: params[11]
        });
        return { changes: 1 };
      }
      if (sql.includes('UPDATE action1_configuration_manager_automation_correlations')) {
        const row = rows.find((entry) => entry.policy_id === params[1] && entry.automation_group_id === params[2]);
        if (row) row.last_error = params[0];
        return { changes: row ? 1 : 0 };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
    async all(sql, params = []) {
      if (sql.includes('FROM action1_configuration_manager_automation_correlations')) {
        return rows.filter((row) => row.policy_id === params[0]).map((row) => ({ ...row }));
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    }
  };
}

async function run() {
  const { createAutomationCorrelationStore } = require(path.join(__dirname, '..', 'automationCorrelationStore.js'));
  const db = createDb();
  const store = createAutomationCorrelationStore({ db });
  const saved = await store.insertCorrelation({
    policyId: 'POL-000001', automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0',
    controlFamilyNameSnapshot: 'Password Policy', action1OrganizationId: 'org-1',
    action1AutomationId: 'auto-1', action1AutomationActionId: 'Run_PowerShell_test-id', action1AutomationName: 'A1CM — Policy — Password Policy',
    action1AutomationSelf: 'https://app.action1.com/api/3.0/automations/schedules/org-1/auto-1',
    desiredDefinitionFingerprint: 'sha256:abc', lastAppliedAt: '2026-08-13T12:00:00.000Z', lastError: null
  });
  assert.strictEqual(saved.action1AutomationId, 'auto-1');
  assert.strictEqual(saved.action1AutomationActionId, 'Run_PowerShell_test-id');
  assert.strictEqual((await store.listCorrelations('POL-000001')).length, 1);
  assert.strictEqual((await store.listCorrelations('POL-000002')).length, 0, 'correlations must not cross-read Policies');
  await assert.rejects(() => store.insertCorrelation({
    policyId: 'POL-000001', automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0',
    controlFamilyNameSnapshot: 'Password Policy', action1OrganizationId: 'org-1',
    action1AutomationId: 'auto-2', action1AutomationActionId: 'Run_PowerShell_duplicate', action1AutomationName: 'duplicate', action1AutomationSelf: 'self',
    desiredDefinitionFingerprint: 'sha256:def', lastAppliedAt: '2026-08-13T12:00:00.000Z'
  }), /duplicate correlation/);
  await store.recordFailure('POL-000001', 'identity.password-policy', 'Action1 create failed: 429');
  assert.strictEqual(db.rows[0].last_error, 'Action1 create failed: 429');
  await assert.rejects(() => store.recordFailure('POL-000001', 'identity.password-policy', 'x'.repeat(2001)), /bounded/);
  assert(!JSON.stringify(db.rows).includes('run_script_text'));
}

run().catch((error) => { console.error(error); process.exit(1); });
