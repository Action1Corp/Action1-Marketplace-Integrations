const assert = require('node:assert/strict');
const test = require('node:test');
const integration = require('./index');

function setup(groups = {}, existingPolicies = []) {
  const calls = [];
  let saved = JSON.stringify(existingPolicies);
  const context = {
    settings: {
      get: async key => key === 'IntuneEnrollmentPolicies' ? saved : '',
      set: async (key, value) => { calls.push(['save', key]); saved = value; }
    },
    action1: { getCredentials: async () => ({ apiKey: 'key', apiSecret: 'secret' }) },
    http: {
      post: async (url, body) => {
        calls.push(['post', url, body]);
        return { data: url.endsWith('/oauth2/token') ? { access_token: 'token' } : {} };
      },
      get: async url => {
        calls.push(['get', url]);
        if (url.includes('/settings/all')) return { data: { items: [{ id: 'setting-1', template_id: 'endpoint_custom_attributes', value: '[{"name":"Action1 Provisioning Status"}]' }] } };
        const id = url.split('/').at(-1);
        if (!groups[id]) throw new Error('Group not found');
        return { data: groups[id] };
      },
      patch: async (url, body) => { calls.push(['patch', url, body]); return { data: {} }; }
    }
  };
  return { context, calls, policies: () => JSON.parse(saved) };
}

function profile(overrides = {}) {
  return {
    name: 'Provisioning', organizationId: 'org-1', organizationName: 'My organization',
    agentId: 'agent-1', profileType: 'enrollmentAndProvisioning',
    monitoredAction1GroupIds: ['group-1'], monitoredAction1GroupMap: { 'group-1': 'First' },
    ...overrides
  };
}

test('creating a profile adds the exclusion before persisting and preserves existing filters', async () => {
  const { context, calls, policies } = setup({ 'group-1': { exclude_filter: [{ field_name: 'name', field_value: 'test', mode: 'include' }] } });
  const result = await integration.actions['save-policy'](context, { payload: { policy: profile() } });
  assert.equal(result.ok, true);
  const patch = calls.find(call => call[0] === 'patch');
  assert.deepEqual(patch[2].exclude_filter, [
    { field_name: 'name', field_value: 'test', mode: 'include' },
    { field_name: 'custom:Action1 Provisioning Status', field_value: 'Completed', mode: 'include' }
  ]);
  assert.ok(calls.findIndex(call => call[0] === 'patch') < calls.findIndex(call => call[0] === 'save'));
  assert.equal(policies().length, 1);
});

test('editing a profile ensures newly selected groups and leaves an existing exclusion alone', async () => {
  const exclusion = { field_name: 'custom:Action1 Provisioning Status', field_value: 'Completed', mode: 'include' };
  const { context, calls } = setup({
    'group-1': { exclude_filter: [exclusion] }, 'group-2': { exclude_filter: [] }
  }, [profile({ policyId: 'ENR-000001' })]);
  const result = await integration.actions['save-policy'](context, { payload: { policy: profile({
    policyId: 'ENR-000001', monitoredAction1GroupIds: ['group-1', 'group-2']
  }) } });
  assert.equal(result.ok, true);
  const patches = calls.filter(call => call[0] === 'patch');
  assert.equal(patches.length, 1);
  assert.match(patches[0][1], /group-2$/);
});

test('Action1 failure and invalid profiles do not persist', async () => {
  const { context, calls, policies } = setup({ 'group-1': { exclude_filter: [] } });
  context.http.patch = async () => { throw new Error('Forbidden'); };
  const failed = await integration.actions['save-policy'](context, { payload: { policy: profile() } });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /First.*Forbidden/);
  assert.deepEqual(policies(), []);
  const invalid = await integration.actions['save-policy'](context, { payload: { policy: profile({ agentId: '' }) } });
  assert.equal(invalid.ok, false);
  assert.equal(calls.filter(call => call[0] === 'post').length, 1);
});

test('enrollment-only profiles do not change Action1 groups', async () => {
  const { context, calls } = setup();
  const result = await integration.actions['save-policy'](context, { payload: { policy: profile({ profileType: 'enrollmentOnly', monitoredAction1GroupIds: [] }) } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(call => call[0]), ['save']);
});

test('profile save creates the provisioning attribute before updating groups when missing', async () => {
  const { context, calls } = setup({ 'group-1': { exclude_filter: [] } });
  const get = context.http.get;
  context.http.get = async url => url.includes('/settings/all') ? { data: { items: [] } } : get(url);
  const result = await integration.actions['save-policy'](context, { payload: { policy: profile() } });
  assert.equal(result.ok, true);
  const settingCall = calls.find(call => call[0] === 'post' && call[1].endsWith('/settings/all'));
  assert.deepEqual(JSON.parse(settingCall[2].value), [{ name: 'Action1 Provisioning Status' }]);
  assert.ok(calls.indexOf(settingCall) < calls.findIndex(call => call[0] === 'patch'));
});
