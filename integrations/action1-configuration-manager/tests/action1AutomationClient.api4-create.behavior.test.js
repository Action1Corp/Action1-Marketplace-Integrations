const assert = require('node:assert/strict');
const test = require('node:test');

const { createAction1AutomationClient } = require('../action1AutomationClient');
const { buildAutomationDefinitions } = require('../automationDefinition');

function makeContext(response, calls) {
  return {
    action1: { async getCredentials() {
      return { baseUrl: 'https://eu.action1.test/api/4.0', apiKey: 'key', apiSecret: 'secret', organizationId: 'credential-org' };
    } },
    async http(options) {
      calls.push(options);
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      return { status: 201, data: response, headers: { 'content-type': 'application/json' } };
    },
    logger: { info() {}, warn() {}, error() {} }
  };
}

function makeLegacyContext(response, calls) {
  return {
    action1: { async getCredentials() { return { baseUrl: 'https://app.action1.com/api/3.0', apiKey: 'key', apiSecret: 'secret' }; } },
    async http(options) {
      calls.push(options);
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      return { status: 201, data: response, headers: { 'content-type': 'application/json' } };
    },
    logger: { info() {}, warn() {}, error() {} }
  };
}

function definition() {
  return {
    automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0', familyName: 'Password Policy',
    name: 'A1CM — POL-000001 — Password Policy', fingerprint: 'sha256:stable',
    payload: {
      name: 'A1CM — POL-000001 — Password Policy',
      endpoints: [{ id: 'group-policy', type: 'EndpointGroup' }],
      actions: [{ name: 'Run PowerShell', template_id: 'run_script', params: { run_script_text: 'Write-Output test', run_script_params: [], run_script_language: 'PowerShell', reboot: 'none' } }],
      settings: 'ENABLED EVERY:360 AT:15-07-00 DATE:2026-08-13', settings_timezone: 'UTC', retry_minutes: '360'
    }
  };
}

test('API 4 create wraps the existing schedule content and preserves policy organization scope', async () => {
  const calls = [];
  const response = {
    id: 'resource-id', type: 'AutomationSchedule',
    configuration: {
      id: 'configuration-id', type: 'AutomationScheduleConfiguration', name: definition().name,
      organization_id: 'policy-org', retry_minutes: '360', settings: definition().payload.settings,
      actions: [{ id: 'action-id', name: 'Run PowerShell', template_id: 'run_script', params: definition().payload.actions[0].params }]
    }, endpoints: [{ id: 'group-policy', type: 'EndpointGroup' }], signatures: []
  };
  const ids = ['configuration-id', 'action-id'];
  const client = createAction1AutomationClient(makeContext(response, calls), { uuidGenerator: () => ids.shift() });
  const result = await client.createAutomation('policy-org', definition());
  const request = calls.find((entry) => entry.method === 'POST' && entry.url.includes('/automations/schedules/'));

  assert.equal(request.url.endsWith('/automations/schedules/policy-org'), true);
  assert.equal(request.data.configuration.organization_id, 'policy-org');
  assert.equal(request.data.configuration.type, 'AutomationScheduleConfiguration');
  assert.equal(request.data.configuration.id, 'configuration-id');
  assert.equal(request.data.configuration.actions[0].id, 'action-id');
  assert.deepEqual(request.data.endpoints, definition().payload.endpoints);
  assert.equal(request.data.name, undefined);
  assert.equal(request.data.configuration.name, definition().payload.name);
  assert.deepEqual(request.data.configuration.actions[0].params, definition().payload.actions[0].params);
  assert.equal(request.data.configuration.settings, definition().payload.settings);
  assert.equal(request.data.configuration.settings_timezone, definition().payload.settings_timezone);
  assert.equal(request.data.configuration.retry_minutes, definition().payload.retry_minutes);
  assert.equal(request.data.signatures, undefined);
  assert.deepEqual(result, {
    id: 'resource-id', self: 'https://eu.action1.test/api/4.0/automations/schedules/policy-org/resource-id',
    name: definition().name, actionId: 'action-id', configurationId: 'configuration-id'
  });
});

test('API 4 create keeps configuration and action identities distinct from the returned resource identity', async () => {
  const calls = [];
  const response = {
    id: 'resource-id', configuration: { id: 'configuration-id', type: 'AutomationScheduleConfiguration', name: 'name', organization_id: 'policy-org', actions: [{ id: 'action-id', template_id: 'run_script' }] }, endpoints: []
  };
  const ids = ['configuration-id', 'action-id'];
  const client = createAction1AutomationClient(makeContext(response, calls), { uuidGenerator: () => ids.shift() });
  const result = await client.createAutomation('policy-org', definition());
  assert.equal(result.id, 'resource-id');
  assert.equal(result.configurationId, 'configuration-id');
  assert.equal(result.actionId, 'action-id');
});

test('API 3 create sends the existing flat body without API 4 fields', async () => {
  const calls = [];
  const legacy = definition();
  const response = { id: 'resource-id', self: 'https://app.action1.com/api/3.0/automations/schedules/policy-org/resource-id', name: legacy.name, actions: [{ id: 'server-action-id', template_id: 'run_script' }] };
  let uuidCalls = 0;
  const client = createAction1AutomationClient(makeLegacyContext(response, calls), { uuidGenerator: () => { uuidCalls += 1; return 'must-not-be-used'; } });
  await client.createAutomation('policy-org', legacy);
  const request = calls.find((entry) => entry.method === 'POST' && entry.url.includes('/automations/schedules/'));
  assert.deepEqual(request.data, legacy.payload);
  assert.equal(uuidCalls, 0);
});

test('API 4 create rejects a response that changes submitted identities', async () => {
  const calls = [];
  const response = { id: 'resource-id', configuration: { id: 'other-configuration', type: 'AutomationScheduleConfiguration', name: 'name', actions: [{ id: 'other-action', template_id: 'run_script' }] } };
  const ids = ['configuration-id', 'action-id'];
  const client = createAction1AutomationClient(makeContext(response, calls), { uuidGenerator: () => ids.shift() });
  await assert.rejects(() => client.createAutomation('policy-org', definition()), /configuration id|action id/i);
});

test('desired automation definitions remain UUID-free before an API 4 create', () => {
  const definitions = buildAutomationDefinitions({
    policyId: 'POL-000001', baseName: 'Policy', policyMode: 'ASSESS_AND_REMEDIATE', organizationId: 'policy-org',
    scopeType: 'ENDPOINT_GROUP', endpointGroupId: 'group-policy', selectedControls: [{ controlId: 'identity.password.minimum-length', controlVersion: '0.1.0', automationGroupId: 'identity-access.password-policy', automationGroupVersion: '0.1.0', parameters: {} }],
    runSchedule: { runEveryHours: 6, startDate: '2026-08-13', startTime: '07:15', timezone: 'UTC' }, completionDeadlineMinutes: 360
  });
  assert.equal(definitions[0].payload.configuration, undefined);
  assert.equal(definitions[0].payload.actions[0].id, undefined);
});
