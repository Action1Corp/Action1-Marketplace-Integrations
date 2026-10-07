const assert = require('assert');
const { withIsolatedControlPackRuntime } = require('./isolatedControlPackRuntime');

function basePolicy() {
  return {
    policyId: 'POL-EDIT',
    baseName: 'Edit Policy',
    displayName: 'Edit Policy — All endpoints',
    organizationId: 'org-1',
    scopeType: 'ALL_ENDPOINTS',
    runSchedule: { runEveryHours: 24, startDate: '2026-08-17', startTime: '09:30', timezone: 'UTC' },
    completionDeadlineMinutes: 1440,
    policyMode: 'ASSESS_ONLY',
    selectedControls: [{
      controlId: 'identity.password.minimum-length', controlVersion: '0.1.0',
      automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0',
      parameters: { minimumLength: 14 }
    }]
  };
}

function context() {
  const noop = { info() {}, debug() {}, warn() {}, error() {} };
  return { logger: noop, action1ConfigurationManagerRuntimeLogger: noop };
}

async function run() {
  await withIsolatedControlPackRuntime(async ({ releaseRoot }) => {
  const { buildAutomationDefinitions } = require('../automationDefinition');
  const { applyEdit } = require('../lifecycleMutations');
  const previous = basePolicy();
  const desired = { ...previous, selectedControls: [{ ...previous.selectedControls[0], parameters: { minimumLength: 15 } }] };
  const desiredDefinition = buildAutomationDefinitions(desired, { releaseRoot })[0];
  const calls = { observe: 0, update: 0, create: [] };
  const correlations = {
    async listCorrelations() {
      return [{
        policyId: 'POL-EDIT', automationGroupId: desiredDefinition.automationGroupId,
        controlFamilyNameSnapshot: desiredDefinition.familyName,
        action1AutomationId: 'auto-old', desiredDefinitionFingerprint: 'old', active: true
      }];
    },
    async updateCorrelation() { throw new Error('unexpected update'); },
    async activateCorrelation(input) { calls.replacement = input; }
  };
  const missingPatchClient = {
    async updateAutomation(orgId, automationId, definition) {
      calls.update += 1;
      assert.strictEqual(definition.envelope.policyId, 'POL-EDIT');
      assert.strictEqual(definition.envelope.policyName, 'Edit Policy');
      const error = new Error('Action1 automation request failed.');
      error.statusCode = 404;
      error.diagnostics = { errorMessage: 'Automation with id=auto-old does not exists', responseContentType: 'application/json' };
      throw error;
    },
    async observeAutomation() { throw new Error('unexpected observe for PATCH'); },
    async createAutomation(orgId, definition) {
      calls.create.push({ orgId, definition });
      return { id: 'auto-new', actionId: 'Run_PowerShell_auto-new', self: 'https://action1.test/auto-new', name: definition.name };
    }
  };
  const patched = await applyEdit(context(), previous, desired, { client: missingPatchClient, correlations });
  assert.strictEqual(patched.history.counts.created, 1);
  assert.strictEqual(calls.update, 1);
  assert.strictEqual(calls.create[0].definition.fingerprint, desiredDefinition.fingerprint);
  assert.strictEqual(calls.create[0].definition.name, 'A1CM - POL-EDIT - Edit Policy - Password Policy');
  assert.strictEqual(calls.create[0].definition.envelope.policyId, 'POL-EDIT');
  assert.strictEqual(calls.create[0].definition.envelope.policyName, 'Edit Policy');
  assert.strictEqual(calls.replacement.action1AutomationId, 'auto-new');
  assert.strictEqual(calls.replacement.action1AutomationActionId, 'Run_PowerShell_auto-new');

  const unchanged = basePolicy();
  const unchangedDefinition = buildAutomationDefinitions(unchanged, { releaseRoot })[0];
  const unchangedCorrelations = {
    async listCorrelations() {
      return [{ policyId: 'POL-EDIT', automationGroupId: unchangedDefinition.automationGroupId,
        controlFamilyNameSnapshot: unchangedDefinition.familyName, action1AutomationId: 'auto-deleted',
        desiredDefinitionFingerprint: unchangedDefinition.fingerprint, active: true }];
    },
    async activateCorrelation(input) { this.replacement = input; }
  };
  let unchangedCreatePayload;
  const unchangedClient = {
    async observeAutomation() { return { state: 'MISSING' }; },
    async createAutomation(orgId, definition) { unchangedCreatePayload = { orgId, definition }; return { id: 'auto-recreated', actionId: 'Run_PowerShell_auto-recreated', self: 'https://action1.test/auto-recreated', name: definition.name }; }
  };
  const applied = await applyEdit(context(), unchanged, unchanged, { client: unchangedClient, correlations: unchangedCorrelations });
  assert.strictEqual(applied.history.counts.created, 1);
  assert.strictEqual(unchangedCreatePayload.definition.fingerprint, unchangedDefinition.fingerprint);
  assert.strictEqual(unchangedCreatePayload.definition.envelope.policyName, 'Edit Policy');
  assert.strictEqual(unchangedCorrelations.replacement.action1AutomationId, 'auto-recreated');
  assert.strictEqual(unchangedCorrelations.replacement.action1AutomationActionId, 'Run_PowerShell_auto-recreated');
  });
}

run().catch((error) => { console.error(error); process.exit(1); });
