const assert = require('assert');
const path = require('path');

async function run() {
  const { createAction1AutomationClient, normalizeAutomationResponse } = require(path.join(__dirname, '..', 'action1AutomationClient.js'));
  const requests = [];
  const context = {
    action1: { async getCredentials() { return { apiKey: 'test-key', apiSecret: 'test-secret' }; } },
    async http(options) {
      requests.push(options);
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      return { status: 201, data: { id: 'auto-1', self: 'https://app.action1.com/api/3.0/automations/schedules/org-1/auto-1', name: 'A1CM — Policy — Family', actions: [{ name: 'Run PowerShell', template_id: 'run_script', id: 'Run_PowerShell_test-id' }] }, headers: {} };
    },
    logger: { info() {}, warn() {}, error() {} }
  };
  const client = createAction1AutomationClient(context);
  const result = await client.createAutomation('org-1', {
    payload: {
      name: 'A1CM — Policy — Family', endpoints: [{ id: 'ALL', type: 'EndpointGroup' }],
      actions: [{ name: 'Run PowerShell', template_id: 'run_script', params: { run_script_params: [], run_script_text: 'script', run_script_language: 'PowerShell' } }],
      settings: 'ENABLED EVERY:360 AT:15-07-00 DATE:2026-08-13', settings_timezone: 'America/Los_Angeles', retry_minutes: '360'
    }
  });
  assert.deepStrictEqual(result, { id: 'auto-1', self: 'https://app.action1.com/api/3.0/automations/schedules/org-1/auto-1', name: 'A1CM — Policy — Family', actionId: 'Run_PowerShell_test-id' });
  const createRequest = requests.find((request) => request.url.endsWith('/automations/schedules/org-1'));
  assert.strictEqual(createRequest.method, 'POST');
  assert.strictEqual(createRequest.data.name, 'A1CM — Policy — Family');
  assert.deepStrictEqual(createRequest.data.endpoints, [{ id: 'ALL', type: 'EndpointGroup' }]);
  assert.deepStrictEqual(createRequest.data.actions[0].params.run_script_params, []);
  assert.strictEqual(createRequest.data.retry_minutes, '360');
  assert.strictEqual(createRequest.data.actions.length, 1);
  const definition = { name: 'A1CM — Renamed — Family', payload: { name: 'A1CM — Renamed — Family', endpoints: [{ id: 'ALL', type: 'EndpointGroup' }], actions: [{ name: 'Run PowerShell', template_id: 'run_script', params: { run_script_text: 'updated' } }], settings: 'ENABLED EVERY:720 AT:15-07-00 DATE:2026-08-13', retry_minutes: '720' } };
  const updated = await client.updateAutomation('org-1', 'auto-1', definition, 'Run_PowerShell_test-id');
  assert.strictEqual(updated.id, 'auto-1');
  const patchRequest = requests.find((request) => request.method === 'PATCH');
  assert.strictEqual(patchRequest.url.endsWith('/automations/schedules/org-1/auto-1'), true);
  assert.strictEqual(patchRequest.data.name, 'A1CM — Renamed — Family');
  assert.deepStrictEqual(patchRequest.data.actions, [{ id: 'Run_PowerShell_test-id', name: 'Run PowerShell', template_id: 'run_script', params: { run_script_text: 'updated' } }]);
  const requestCountBeforeMissingActionId = requests.length;
  await assert.rejects(() => client.updateAutomation('org-1', 'auto-1', definition), /action id is required/i);
  assert.strictEqual(requests.length, requestCountBeforeMissingActionId, 'PATCH without an action ID must fail before transport');
  const deleted = await client.deleteAutomation('org-1', 'auto-1');
  assert.deepStrictEqual(deleted, { status: 'deleted' });

  const instance = await client.createAutomationInstance('org-1', {
    payload: { name: 'A1CM — POL-000037 — State Cleanup', endpoints: [{ id: 'group-1', type: 'EndpointGroup' }], actions: [{ name: 'Run PowerShell', template_id: 'run_script' }], retry_minutes: '10080' }
  });
  assert.deepStrictEqual(instance, { id: 'auto-1', type: 'AutomationInstance', status: null });
  assert.strictEqual(requests.filter((entry) => entry.method === 'POST' && entry.url.includes('/automations/instances/org-1')).length, 1);
  let ambiguousAttempts = 0;
  const ambiguousContext = {
    action1: { async getCredentials() { return { apiKey: 'test-key', apiSecret: 'test-secret' }; } },
    async http(options) {
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      ambiguousAttempts += 1;
      throw new Error('socket timeout');
    },
    logger: { info() {}, warn() {}, error() {} }
  };
  await assert.rejects(() => createAction1AutomationClient(ambiguousContext).createAutomationInstance('org-1', { payload: { name: 'cleanup' } }), /socket timeout/);
  assert.strictEqual(ambiguousAttempts, 1, 'ambiguous instance POST must not be blindly retried');
  const deleteRequest = requests.find((request) => request.method === 'DELETE');
  assert.strictEqual(deleteRequest.url.endsWith('/automations/schedules/org-1/auto-1'), true);
  assert(!JSON.stringify(requests).includes('test-secret'));

  for (const payload of [
    {},
    { actions: [] },
    { actions: [{ template_id: 'other', id: 'other-id' }] },
    { actions: [{ template_id: 'run_script', id: 'one' }, { template_id: 'run_script', id: 'two' }] },
    { actions: [{ template_id: 'run_script' }] }
  ]) {
    assert.throws(() => normalizeAutomationResponse({ id: 'auto-1', self: 'self', name: 'name', ...payload }), /Run PowerShell action id/i);
  }

  function errorContext(payload, status = 400, contentType = 'application/json') {
    return {
      action1: { async getCredentials() { return { baseUrl: 'https://app.action1.com/api/3.0', apiKey: 'test-key', apiSecret: 'test-secret' }; } },
      async http(options) {
        if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
        return { status, data: payload, headers: { 'content-type': contentType } };
      },
      logger: { info() {}, warn() {}, error() {} }
    };
  }

  const absentClient = createAction1AutomationClient(errorContext({ type: 'Error', status: 400, developer_message: 'Automation with id=gone-1 does not exists' }));
  assert.deepStrictEqual(await absentClient.deleteAutomation('org-1', 'gone-1'), { status: 'alreadyAbsent' });

  const other400Client = createAction1AutomationClient(errorContext({ type: 'Error', status: 400, developer_message: 'Malformed request' }));
  await assert.rejects(() => other400Client.deleteAutomation('org-1', 'gone-1'));

  const differentIdClient = createAction1AutomationClient(errorContext({ type: 'Error', status: 400, developer_message: 'Automation with id=other-1 does not exists' }));
  await assert.rejects(() => differentIdClient.deleteAutomation('org-1', 'gone-1'));

  const missingClient = createAction1AutomationClient(errorContext({ type: 'Error', status: 404, developer_message: 'Automation with id=gone-1 does not exists' }, 404));
  assert.deepStrictEqual(await missingClient.observeAutomation('org-1', 'gone-1'), { state: 'MISSING' });

  const liveMissingClient = createAction1AutomationClient(errorContext({ type: 'Error', status: 400, developer_message: 'Automation with id=gone-1 not found' }));
  assert.deepStrictEqual(await liveMissingClient.observeAutomation('org-1', 'gone-1'), { state: 'MISSING' });

  const liveDifferentIdClient = createAction1AutomationClient(errorContext({ type: 'Error', status: 400, developer_message: 'Automation with id=other-1 not found' }));
  assert.strictEqual((await liveDifferentIdClient.observeAutomation('org-1', 'gone-1')).state, 'UNRESOLVED');

  const arbitrary400Client = createAction1AutomationClient(errorContext({ type: 'Error', status: 400, developer_message: 'Malformed request' }));
  assert.strictEqual((await arbitrary400Client.observeAutomation('org-1', 'gone-1')).state, 'UNRESOLVED');

  const unresolvedClient = createAction1AutomationClient(errorContext({ type: 'Error', status: 404, developer_message: 'Automation with id=other-1 does not exists' }, 404));
  assert.strictEqual((await unresolvedClient.observeAutomation('org-1', 'gone-1')).state, 'UNRESOLVED');

  const existsContext = errorContext({ id: 'auto-1', self: 'https://action1.test/auto-1', name: 'A1CM — Policy — Family' }, 200);
  const existsClient = createAction1AutomationClient(existsContext);
  assert.strictEqual((await existsClient.observeAutomation('org-1', 'auto-1')).state, 'EXISTS');
}

run().catch((error) => { console.error(error); process.exit(1); });
