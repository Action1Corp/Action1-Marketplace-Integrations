const assert = require('assert');
const path = require('path');

function policy(overrides = {}) {
  return {
    policyId: 'POL-000001', baseName: 'Workstation Security', displayName: 'Workstation Security — All endpoints', policyMode: 'ASSESS_ONLY',
    organizationId: 'org-1', scopeType: 'ALL_ENDPOINTS', endpointGroupId: '',
    runSchedule: { runEveryHours: 6, startDate: '2026-08-13', startTime: '15:07', timezone: 'America/Los_Angeles' },
    completionDeadlineMinutes: 360, selectedControls: [{
      controlId: 'identity.password.minimum-length', controlVersion: '0.1.0',
      automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0', parameters: { minimumLength: 14 }
    }], ...overrides
  };
}

async function run() {
  const { buildAutomationDefinitions, buildAutomationDisplayName, serializeAction1Schedule } = require(path.join(__dirname, '..', 'automationDefinition.js'));
  assert.strictEqual(
    buildAutomationDisplayName({ policyId: 'POL-000055', policyName: 'Windows 11 Security Baseline', controlFamilyName: 'Removable Storage' }),
    'A1CM - POL-000055 - Windows 11 Security Baseline - Removable Storage'
  );
  assert(!buildAutomationDisplayName({ policyId: 'POL-000055', policyName: 'Windows 11 Security Baseline', controlFamilyName: 'Removable Storage' }).includes('—'));
  assert.strictEqual(
    buildAutomationDisplayName({ policyId: 'POL-000999', policyName: 'Finance Hardening', controlFamilyName: 'Defender Protection' }),
    'A1CM - POL-000999 - Finance Hardening - Defender Protection'
  );
  const schedule = serializeAction1Schedule({ runEveryHours: 6, startDate: '2026-08-13', startTime: '15:07', timezone: 'America/Los_Angeles', completionDeadlineMinutes: 360 });
  assert.strictEqual(schedule.settings, 'ENABLED EVERY:360 AT:22-07-00 DATE:2026-08-13');
  assert.strictEqual(schedule.settings_timezone, 'UTC');
  assert.strictEqual(schedule.retry_minutes, '360');
  const [definition] = buildAutomationDefinitions(policy({ baseName: 'Workstation Security' }));
  assert.deepStrictEqual(definition.target, [{ id: 'ALL', type: 'EndpointGroup' }]);
  assert.strictEqual(definition.payload.actions[0].template_id, 'run_script');
  assert.deepStrictEqual(definition.payload.actions[0].params.run_script_params, []);
  assert.strictEqual((definition.scriptText.match(/__A1CM_POLICY_CONFIGURATION_BASE64__/g) || []).length, 0);
  const decoded = Buffer.from(definition.envelopeBase64, 'base64').toString('utf8');
  const envelope = JSON.parse(decoded);
  assert.strictEqual(envelope.policyId, 'POL-000001');
  assert.strictEqual(envelope.policyName, 'Workstation Security');
  assert.notStrictEqual(envelope.policyName, policy({ baseName: 'Workstation Security' }).displayName);
  assert(definition.payload.actions[0].params.run_script_text.includes(definition.envelopeBase64));
  assert.deepStrictEqual(envelope.controls[0].parameters, { minimumLength: 14 });
  assert(definition.fingerprint.startsWith('sha256:'));
  assert.strictEqual(definition.name, 'A1CM - POL-000001 - Workstation Security - Password Policy');
  assert(!definition.name.includes('All endpoints'));
  const renamedDefinition = buildAutomationDefinitions(policy({ baseName: 'Finance Hardening' }))[0];
  assert.strictEqual(renamedDefinition.name, 'A1CM - POL-000001 - Finance Hardening - Password Policy');
  assert.strictEqual(renamedDefinition.envelope.policyId, 'POL-000001');
  assert.strictEqual(renamedDefinition.envelope.policyName, 'Finance Hardening');
  assert.strictEqual(renamedDefinition.name.split(' - ').at(-1), 'Password Policy');
  const scopeOnlyDefinition = buildAutomationDefinitions(policy({ baseName: 'Workstation Security', displayName: 'Workstation Security — Finance Workstations' }))[0];
  assert.strictEqual(scopeOnlyDefinition.envelope.policyName, 'Workstation Security');
  const groupPolicy = policy({ scopeType: 'ENDPOINT_GROUP', endpointGroupId: 'group-1', baseName: 'Workstation Security' });
  const [groupDefinition] = buildAutomationDefinitions(groupPolicy);
  assert.deepStrictEqual(groupDefinition.target, [{ id: 'group-1', type: 'EndpointGroup' }]);
  assert.throws(() => buildAutomationDefinitions(policy({ runSchedule: { ...policy().runSchedule, timezone: 'LOCALTIME' } })), /IANA timezone/i);
}

run().catch((error) => { console.error(error); process.exit(1); });
