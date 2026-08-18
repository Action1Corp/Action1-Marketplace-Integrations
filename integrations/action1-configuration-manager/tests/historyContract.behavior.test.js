const assert = require('assert');
const {
  createHistoryEnvelope,
  extractHistoryEnvelope,
  resultDetails
} = require('../historyContract');

function run() {
  const envelope = createHistoryEnvelope({
    operation: 'POLICY_DELETED',
    policy: { displayName: 'Finance Policy — All endpoints', organizationNameSnapshot: 'Acme Corp' },
    summary: 'Policy deleted. Automations removed: 2.',
    counts: { deleted: 2, failed: 0 },
    familyOutcomes: [{ familyName: 'Firewall', outcome: 'Removed', message: 'Action1 id=secret-id' }],
    errors: ['Action1 response body included token=secret-token']
  });
  const parsed = extractHistoryEnvelope(`Started action\n${resultDetails(envelope)}`);

  assert.strictEqual(parsed.operation, 'POLICY_DELETED');
  assert.strictEqual(parsed.policyNameSnapshot, 'Finance Policy — All endpoints');
  assert.strictEqual(parsed.organizationNameSnapshot, 'Acme Corp');
  assert.deepStrictEqual(parsed.counts, { deleted: 2, failed: 0 });
  assert(!JSON.stringify(parsed).includes('secret-id'));
  assert(!JSON.stringify(parsed).includes('secret-token'));
  assert(!JSON.stringify(parsed).includes('Action1 response body'));
  assert(!JSON.stringify(parsed).includes('action1AutomationId'));

  const reconciliation = extractHistoryEnvelope(resultDetails(createHistoryEnvelope({
    operation: 'SCHEDULED_RECONCILIATION',
    summary: 'Checked 4 Policies.',
    counts: { policiesChecked: 4, automationsChecked: 8, created: 1, updated: 1, deleted: 0, unchanged: 6, failed: 0 }
  })));
  assert.strictEqual(reconciliation.counts.policiesChecked, 4);
  assert.strictEqual(reconciliation.counts.automationsChecked, 8);
  assert.strictEqual(reconciliation.operationLabel, 'Scheduled reconciliation');

  const projected = extractHistoryEnvelope(resultDetails(createHistoryEnvelope({
    operation: 'SCHEDULED_RECONCILIATION',
    policyNameSnapshot: '1 policies',
    organizationNameSnapshot: '2 organizations',
    summary: 'Checked 2 Enabled Policies. Restored 1 missing automation.',
    counts: { policiesChecked: 2, automationsChecked: 2, created: 1, unchanged: 1, failed: 0 },
    policies: [
      { policyNameSnapshot: 'Policy A — All endpoints', organizationNameSnapshot: 'Acme', familyChanges: [{ familyName: 'Password Policy', outcome: 'Created' }] },
      { policyNameSnapshot: 'Policy B — All endpoints', organizationNameSnapshot: 'Beta', familyChanges: [{ familyName: 'Account Lockout', outcome: 'Unchanged' }] }
    ]
  })));
  assert.strictEqual(projected.policyNameSnapshot, '1 policies');
  assert.strictEqual(projected.organizationNameSnapshot, '2 organizations');
  assert.deepStrictEqual(projected.policies.map(policy => policy.familyChanges[0].outcome), ['Created', 'Unchanged']);
  assert(!JSON.stringify(projected).includes('automationId'));
  assert.strictEqual(extractHistoryEnvelope('legacy runtime log'), null);
}

try {
  run();
  console.log('Configuration Manager History contract behavior passed.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
