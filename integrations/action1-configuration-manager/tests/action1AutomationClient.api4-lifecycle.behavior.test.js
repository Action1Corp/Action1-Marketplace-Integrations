const assert = require('node:assert/strict');
const test = require('node:test');

const { createAction1AutomationClient } = require('../action1AutomationClient');

const policyOrg = 'policy-org';
const resourceId = 'resource-id';
const configurationId = 'configuration-id';
const actionId = 'action-id';

function definition() {
  return {
    name: 'A1CM — Policy — Family',
    payload: {
      name: 'A1CM — Policy — Family',
      endpoints: [{ id: 'group-1', type: 'EndpointGroup' }],
      actions: [{ name: 'Run PowerShell', template_id: 'run_script', params: { run_script_text: 'updated-script', run_script_params: [], run_script_language: 'PowerShell' } }],
      settings: 'ENABLED EVERY:720 AT:15-07-00 DATE:2026-08-13', settings_timezone: 'UTC', retry_minutes: '720'
    }
  };
}

function nestedSchedule(overrides = {}) {
  return {
    id: resourceId, type: 'AutomationSchedule',
    configuration: {
      id: configurationId, type: 'AutomationScheduleConfiguration', name: definition().name,
      organization_id: policyOrg, settings: definition().payload.settings, settings_timezone: 'UTC', retry_minutes: '720',
      actions: [{ id: actionId, name: 'Run PowerShell', template_id: 'run_script', params: definition().payload.actions[0].params }]
    }, endpoints: definition().payload.endpoints, signatures: [], ...overrides
  };
}

function contextFor(responses, calls) {
  let index = 0;
  return {
    action1: { async getCredentials() { return { baseUrl: 'https://eu.action1.test/api/4.0', apiKey: 'key', apiSecret: 'secret', organizationId: 'credential-org' }; } },
    async http(options) {
      calls.push(options);
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      const response = typeof responses === 'function' ? responses(options) : (Array.isArray(responses) ? responses[index++] : responses);
      if (response?.error) throw response.error;
      return { status: Number.isFinite(response?.status) ? response.status : 200, data: response?.data || response, headers: { 'content-type': 'application/json' } };
    },
    logger: { info() {}, warn() {}, error() {} }
  };
}

test('API 4 GET normalizes nested schedule identity without a Console projection query', async () => {
  const calls = [];
  const client = createAction1AutomationClient(contextFor(nestedSchedule(), calls));
  const observed = await client.observeAutomation(policyOrg, resourceId);
  const request = calls.find((entry) => entry.method === 'GET');
  assert.equal(request.url.endsWith(`/automations/schedules/${policyOrg}/${resourceId}`), true);
  assert.equal(request.url.includes('?fields='), false);
  assert.deepEqual(observed, { state: 'EXISTS', automation: { id: resourceId, self: null, name: definition().name, organizationId: policyOrg, configurationId, actionId } });
});

test('API 4 GET rejects a schedule returned for a different organization', async () => {
  const calls = [];
  const response = nestedSchedule({ configuration: { ...nestedSchedule().configuration, organization_id: 'other-org' } });
  const client = createAction1AutomationClient(contextFor(response, calls));
  const observed = await client.observeAutomation(policyOrg, resourceId);
  assert.deepEqual(observed, { state: 'UNRESOLVED', reason: 'malformed-success' });
});

test('API 4 PATCH preserves resource, configuration, and action identities while updating desired content', async () => {
  const calls = [];
  const response = nestedSchedule();
  const client = createAction1AutomationClient(contextFor(response, calls));
  const result = await client.updateAutomation(policyOrg, resourceId, definition(), actionId, configurationId);
  const request = calls.find((entry) => entry.method === 'PATCH');
  assert.equal(request.url.endsWith(`/automations/schedules/${policyOrg}/${resourceId}`), true);
  assert.equal(request.data.configuration.id, configurationId);
  assert.equal(request.data.configuration.actions[0].id, actionId);
  assert.equal(request.data.configuration.organization_id, policyOrg);
  assert.deepEqual(request.data.endpoints, definition().payload.endpoints);
  assert.equal(request.data.configuration.actions[0].params.run_script_text, 'updated-script');
  assert.equal(request.data.configuration.settings, definition().payload.settings);
  assert.equal(request.data.configuration.retry_minutes, '720');
  assert.equal(request.data.configuration.actions.length, 1);
  assert.deepEqual(result, { id: resourceId, self: `https://eu.action1.test/api/4.0/automations/schedules/${policyOrg}/${resourceId}`, name: definition().name, configurationId, actionId });
});

test('API 4 PATCH fails safely when persisted configuration or action identity is unavailable', async () => {
  const calls = [];
  const client = createAction1AutomationClient(contextFor(nestedSchedule(), calls));
  await assert.rejects(() => client.updateAutomation(policyOrg, resourceId, definition(), actionId, null), /configuration id/i);
  await assert.rejects(() => client.updateAutomation(policyOrg, resourceId, definition(), null, configurationId), /action id/i);
  assert.equal(calls.filter((entry) => entry.method === 'PATCH').length, 0);
});

test('API 4 DELETE uses the schedule resource ID and accepts the confirmed success envelope', async () => {
  const calls = [];
  const client = createAction1AutomationClient(contextFor({ id: '0', type: 'Success', status: 200, developer_message: 'Success', user_message: 'Success' }, calls));
  assert.deepEqual(await client.deleteAutomation(policyOrg, resourceId), { status: 'deleted' });
  const request = calls.find((entry) => entry.method === 'DELETE');
  assert.equal(request.url.endsWith(`/automations/schedules/${policyOrg}/${resourceId}`), true);
});

test('API 4 one-time instance wraps cleanup content with fresh identities and preserves policy scope', async () => {
  const calls = [];
  const ids = ['instance-configuration-id', 'instance-action-id'];
  const response = {
    id: 'instance-resource-id', type: 'AutomationInstance', name: 'A1CM — Policy — State Cleanup',
    start_time: '2026-10-30_12-00-00', retry_minutes: '10080', status: 'Running',
    actions: [{ id: 'instance-action-id', name: 'Run PowerShell', template_id: 'run_script', params: { run_script_text: 'cleanup' } }],
    endpoints: [{ id: 'group-1', type: 'EndpointGroup' }]
  };
  const client = createAction1AutomationClient(contextFor(response, calls), { now: () => Date.parse('2026-10-30T12:00:00.000Z'), uuidGenerator: () => ids.shift() });
  const instance = await client.createAutomationInstance(policyOrg, { payload: { name: 'A1CM — Policy — State Cleanup', endpoints: [{ id: 'group-1', type: 'EndpointGroup' }], actions: [{ name: 'Run PowerShell', template_id: 'run_script', params: { run_script_text: 'cleanup' } }], retry_minutes: '10080' } });
  const request = calls.find((entry) => entry.method === 'POST' && entry.url.includes('/automations/instances/'));
  assert.equal(request.url.endsWith(`/automations/instances/${policyOrg}`), true);
  assert.equal(request.data.configuration.type, 'AutomationScheduleConfiguration');
  assert.equal(request.data.configuration.organization_id, policyOrg);
  assert.equal(request.data.configuration.id, 'instance-configuration-id');
  assert.equal(request.data.configuration.actions[0].id, 'instance-action-id');
  assert.equal(request.data.configuration.start_time, '2026-10-30_12-00-00');
  assert.equal(request.data.configuration.settings, undefined);
  assert.deepEqual(instance, { id: 'instance-resource-id', type: 'AutomationInstance', status: 'Running', configurationId: 'instance-configuration-id', actionId: 'instance-action-id' });
});

test('API 4 instance response identities must match the submitted identities', async () => {
  const calls = [];
  const client = createAction1AutomationClient(contextFor({ id: 'instance-resource-id', type: 'AutomationInstance', actions: [{ id: 'other-action', template_id: 'run_script' }] }, calls), { uuidGenerator: (() => { const ids = ['submitted', 'submitted-action']; return () => ids.shift(); })() });
  await assert.rejects(() => client.createAutomationInstance(policyOrg, { payload: { name: 'cleanup', endpoints: [{ id: 'group-1', type: 'EndpointGroup' }], actions: [{ name: 'Run PowerShell', template_id: 'run_script', params: {} }], retry_minutes: '10080' } }), /action id/i);
});
