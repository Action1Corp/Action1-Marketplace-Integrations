const assert = require('assert');
const { reconcileEnabledPolicies } = require('../reconciliation');
const { extractHistoryEnvelope } = require('../historyContract');

function policy(policyId, enabled = true) {
  return {
    policyId,
    enabled,
    baseName: policyId,
    displayName: `${policyId} — All endpoints`,
    organizationId: 'org-1',
    organizationNameSnapshot: 'Acme',
    scopeType: 'ALL_ENDPOINTS',
    runSchedule: { runEveryHours: 24, startDate: '2026-08-17', startTime: '09:30', timezone: 'UTC' },
    completionDeadlineMinutes: 1440,
    policyMode: 'ASSESS_ONLY',
    selectedControls: [{
      controlId: 'identity.password.minimum-length',
      controlVersion: '0.1.0',
      automationGroupId: 'identity.password-policy',
      automationGroupVersion: '0.1.0',
      parameters: { minimumLength: 14 }
    }]
  };
}

async function run() {
  const policies = [policy('POL-EXISTS'), policy('POL-MISSING'), policy('POL-DISABLED', false)];
  const correlations = new Map([
    ['POL-EXISTS', [{ policyId: 'POL-EXISTS', automationGroupId: 'identity.password-policy', action1AutomationId: 'auto-exists', active: true }]],
    ['POL-MISSING', [{ policyId: 'POL-MISSING', automationGroupId: 'identity.password-policy', action1AutomationId: 'auto-missing', active: true }]],
    ['POL-DISABLED', [{ policyId: 'POL-DISABLED', automationGroupId: 'identity.password-policy', action1AutomationId: 'auto-disabled', active: true }]]
  ]);
  const calls = { observe: [], create: [], update: [], delete: [], saved: [], logs: [] };
  const client = {
    async observeAutomation(orgId, id) {
      calls.observe.push([orgId, id]);
      return { state: id === 'auto-missing' ? 'MISSING' : 'EXISTS' };
    },
    async createAutomation(orgId, definition) {
      calls.create.push({ orgId, definition });
      return { id: 'auto-replacement', self: 'https://action1.test/auto-replacement', name: definition.name };
    },
    async updateAutomation() { calls.update.push(true); },
    async deleteAutomation() { calls.delete.push(true); }
  };
  const correlationStore = {
    async listCorrelations(policyId) { return correlations.get(policyId) || []; },
    async activateCorrelation(input) {
      correlations.set(input.policyId, [{ ...input, active: true }]);
    }
  };
  const runtimeLogger = { info(message) { calls.logs.push(message); }, warn() {}, error(message) { calls.logs.push(message); } };
  const result = await reconcileEnabledPolicies({ logger: { info() {}, warn() {}, error() {} }, action1ConfigurationManagerRuntimeLogger: runtimeLogger }, {
    policyStore: { async listPolicies() { return policies; } },
    stateStore: { async save(input) { calls.saved.push(input); } },
    client,
    correlations: correlationStore
  });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.aggregate, { policiesChecked: 2, automationsChecked: 2, created: 1, unchanged: 1, failed: 0 });
  assert.deepStrictEqual(calls.observe, [['org-1', 'auto-exists'], ['org-1', 'auto-missing']]);
  assert.strictEqual(calls.create.length, 1);
  assert.strictEqual(calls.update.length, 0);
  assert.strictEqual(calls.delete.length, 0);
  assert.strictEqual(calls.saved.length, 2);
  assert.strictEqual(calls.saved.every((entry) => entry.lastResult === 'Success'), true);
  assert(calls.logs.some(message => message.includes('Automation exists: policy=POL-EXISTS') && message.includes('family=Password Policy') && message.includes('automationId=auto-exists')));
  assert(calls.logs.some(message => message.includes('Missing owned automation detected: policy=POL-MISSING') && message.includes('automationId=auto-missing')));
  assert(calls.logs.some(message => message.includes('Recreating missing automation: policy=POL-MISSING')));
  assert(calls.logs.some(message => message.includes('Replacement automation created: policy=POL-MISSING') && message.includes('oldAutomationId=auto-missing') && message.includes('newAutomationId=auto-replacement')));
  assert(calls.logs.some(message => message.includes('Correlation replaced: policy=POL-MISSING') && message.includes('automationId=auto-replacement')));
  assert(calls.logs.some(message => message.includes('Aggregate reconciliation completed: policiesChecked=2 automationsChecked=2 created=1 unchanged=1 failed=0')));
  assert(!calls.logs.some(message => /test-secret|run_script|payload|base64/i.test(message)));
  const envelope = extractHistoryEnvelope(result.details);
  assert.strictEqual(envelope.policyNameSnapshot, '2 policies');
  assert.strictEqual(envelope.organizationNameSnapshot, 'Acme');
  assert.deepStrictEqual(envelope.familyOutcomes, []);
  assert.strictEqual(envelope.policies.length, 2);
  assert.deepStrictEqual(envelope.policies.map(entry => entry.familyChanges[0].outcome), ['Unchanged', 'Created']);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(envelope.counts, 'updated'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(envelope.counts, 'deleted'), false);

  correlations.set('POL-SINGLE', [{ policyId: 'POL-SINGLE', automationGroupId: 'identity.password-policy', action1AutomationId: 'auto-single', active: true }]);
  const singleResult = await reconcileEnabledPolicies({ logger: { info() {}, warn() {}, error() {} } }, {
    policyStore: { async listPolicies() { return [policy('POL-SINGLE')]; } },
    stateStore: { async save() {} },
    client,
    correlations: correlationStore
  });
  const singleEnvelope = extractHistoryEnvelope(singleResult.details);
  assert.strictEqual(singleEnvelope.policyNameSnapshot, 'POL-SINGLE — All endpoints');
  assert.strictEqual(singleEnvelope.organizationNameSnapshot, 'Acme');
  assert.deepStrictEqual(singleEnvelope.familyOutcomes.map(outcome => outcome.outcome), ['Unchanged']);

  const unresolvedLogs = [];
  const unresolvedResult = await reconcileEnabledPolicies({
    logger: { info() {}, warn() {}, error() {} },
    action1ConfigurationManagerRuntimeLogger: {
      info(message) { unresolvedLogs.push(message); },
      error(message) { unresolvedLogs.push(message); }
    }
  }, {
    policyStore: { async listPolicies() { return [policy('POL-UNRESOLVED')]; } },
    stateStore: { async save() {} },
    client: {
      async observeAutomation() {
        const error = new Error('transport failure');
        error.category = 'transport-failure';
        error.statusCode = 503;
        return { state: 'UNRESOLVED', error };
      }
    },
    correlations: {
      async listCorrelations() {
        return [{ policyId: 'POL-UNRESOLVED', automationGroupId: 'identity.password-policy', action1AutomationId: 'auto-unresolved', active: true }];
      }
    }
  });
  assert.strictEqual(unresolvedResult.ok, false);
  assert(unresolvedLogs.some(message => message.includes('Automation existence check unresolved: policy=POL-UNRESOLVED') && message.includes('family=Password Policy') && message.includes('category=transport-failure') && message.includes('status=503')));
  assert(unresolvedLogs.some(message => message.includes('Policy reconciliation failed: policy=POL-UNRESOLVED')));
  assert(!unresolvedLogs.some(message => /test-secret|run_script|payload|base64/i.test(message)));
}

run().catch((error) => { console.error(error); process.exit(1); });
