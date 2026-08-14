const assert = require('assert');
const path = require('path');

function policy(overrides = {}) {
  return {
    policyId: 'POL-000001', displayName: 'Workstation Security — All endpoints', policyMode: 'ASSESS_ONLY',
    organizationId: 'org-1', scopeType: 'ALL_ENDPOINTS', endpointGroupId: '',
    runSchedule: { runEveryHours: 6, startDate: '2026-08-13', startTime: '15:07', timezone: 'America/Los_Angeles' },
    completionDeadlineMinutes: 360, selectedControls: [{
      controlId: 'identity.password.minimum-length', controlVersion: '0.1.0',
      automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0', parameters: { minimumLength: 14 }
    }], ...overrides
  };
}

async function run() {
  const { buildAutomationDefinitions, serializeAction1Schedule } = require(path.join(__dirname, '..', 'automationDefinition.js'));
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
  assert.deepStrictEqual(JSON.parse(decoded).controls[0].parameters, { minimumLength: 14 });
  assert(definition.fingerprint.startsWith('sha256:'));
  assert.strictEqual(definition.name, 'A1CM — Workstation Security — Password Policy');
  assert(!definition.name.includes('All endpoints'));
  const groupPolicy = policy({ scopeType: 'ENDPOINT_GROUP', endpointGroupId: 'group-1', baseName: 'Workstation Security' });
  const [groupDefinition] = buildAutomationDefinitions(groupPolicy);
  assert.deepStrictEqual(groupDefinition.target, [{ id: 'group-1', type: 'EndpointGroup' }]);
  assert.throws(() => buildAutomationDefinitions(policy({ runSchedule: { ...policy().runSchedule, timezone: 'LOCALTIME' } })), /IANA timezone/i);
}

run().catch((error) => { console.error(error); process.exit(1); });
