const assert = require('node:assert/strict');
const test = require('node:test');
const integration = require('./index');

test('creates a named endpoint group in the selected Action1 organization', async () => {
  const requests = [];
  const context = {
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret', baseUrl: 'https://app.eu.action1.com/api/3.0' }) },
    http: {
      post: async (url, payload, options) => {
        requests.push({ url, payload, options });
        if (url.endsWith('/oauth2/token')) return { data: { access_token: 'token' } };
        return { data: { id: 'new-group-1', name: 'Provisioning', description: '', endpoint_count: 0 } };
      }
    }
  };
  const result = await integration.actions['create-action1-endpoint-group'](context, {
    payload: { organizationId: 'org-1', name: '  Provisioning  ' }
  });
  assert.equal(requests[1].url, 'https://app.eu.action1.com/api/3.0/endpoints/groups/org-1');
  assert.deepEqual(requests[1].payload, { name: 'Provisioning' });
  assert.equal(requests[1].options.headers.Authorization, 'Bearer token');
  assert.equal(result.groupUrl, 'https://app.eu.action1.com/console/endpoints/groups/new-group-1/settings?org=org-1');
  assert.deepEqual(result.group, {
    id: 'new-group-1', name: 'Provisioning', description: '', endpointCount: null,
    editable: true, editUrl: result.groupUrl
  });
});

test('loads endpoint counts from group contents and protects the built-in group', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => ({
    ok: true,
    json: async () => url.endsWith('/oauth2/token')
      ? { access_token: 'token' }
      : { items: [{ id: 'group-1', name: 'Provisioning' }, { id: 'new', name: 'New Endpoints' }] }
  });
  try {
    const context = {
      action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret', baseUrl: 'https://app.eu.action1.com/api/3.0' }) },
      http: {
        post: async () => ({ data: { access_token: 'token' } }),
        get: async url => {
          if (url.includes('/group-1/contents')) return { data: { total_items: '7', items: [{}] } };
          throw new Error('Count unavailable');
        }
      }
    };
    const result = await integration.actions['list-action1-endpoint-groups'](context, { payload: { organizationId: 'org-1' } });
    assert.equal(result.groups[0].endpointCount, null);
    assert.equal(result.groups[0].editable, false);
    assert.equal(result.groups[1].endpointCount, 7);
    assert.equal(result.groups[1].editUrl, 'https://app.eu.action1.com/console/endpoints/groups/group-1/settings?org=org-1');
  } finally {
    global.fetch = originalFetch;
  }
});

test('deletes only a manageable group not assigned to a saved profile', async () => {
  const deleted = [];
  const context = {
    settings: { get: async () => '[]' },
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async () => ({ data: { access_token: 'token' } }),
      get: async () => ({ data: { id: 'group-1', name: 'Provisioning' } }),
      delete: async url => { deleted.push(url); return { data: {} }; }
    }
  };
  const remove = integration.actions['delete-action1-endpoint-group'];
  const result = await remove(context, { payload: { organizationId: 'org-1', groupId: 'group-1' } });
  assert.equal(result.groupId, 'group-1');
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /\/endpoints\/groups\/org-1\/group-1$/);

  context.http.get = async () => ({ data: { id: 'new', name: 'New Endpoints' } });
  await assert.rejects(remove(context, { payload: { organizationId: 'org-1', groupId: 'new' } }), /cannot be deleted/i);
  assert.equal(deleted.length, 1);

  context.settings.get = async () => JSON.stringify([{ policyId: 'ENR-1', organizationId: 'org-1', monitoredAction1GroupIds: ['group-1'] }]);
  await assert.rejects(remove(context, { payload: { organizationId: 'org-1', groupId: 'group-1' } }), /saved profile/i);
  assert.equal(deleted.length, 1);
});

test('deleting a deselected group updates its saved profile selection', async () => {
  let saved = JSON.stringify([{
    policyId: 'ENR-000001', name: 'Provisioning', organizationId: 'org-1', organizationName: 'Organization',
    agentId: 'agent-1', profileType: 'enrollmentAndProvisioning', monitoredAction1GroupIds: ['group-1']
  }]);
  const events = [];
  const context = {
    settings: {
      get: async key => key === 'IntuneEnrollmentPolicies' ? saved : '',
      set: async (key, value) => { events.push('save'); saved = value; }
    },
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async () => ({ data: { access_token: 'token' } }),
      get: async url => url.includes('/settings/all')
        ? { data: { items: [{ id: 'setting-1', template_id: 'endpoint_custom_attributes', value: '[{"name":"Action1 Provisioning Status"}]' }] } }
        : { data: { id: url.split('/').at(-1), exclude_filter: [] } },
      patch: async () => { events.push('patch'); return { data: {} }; },
      delete: async () => { events.push('delete'); return { data: {} }; }
    }
  };
  const payload = { organizationId: 'org-1', groupId: 'group-1', profileId: 'ENR-000001',
    selectedGroupIds: ['group-2'], selectedGroupMap: { 'group-2': 'Replacement' } };
  const result = await integration.actions['delete-action1-endpoint-group'](context, { payload });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ['patch', 'delete', 'save']);
  assert.deepEqual(JSON.parse(saved)[0].monitoredAction1GroupIds, ['group-2']);
});

test('failed Action1 deletion keeps the saved profile unchanged', async () => {
  const saved = JSON.stringify([{
    policyId: 'ENR-000001', name: 'Provisioning', organizationId: 'org-1', organizationName: 'Organization',
    agentId: 'agent-1', profileType: 'enrollmentAndProvisioning', monitoredAction1GroupIds: ['group-1', 'group-2']
  }]);
  let writes = 0;
  const context = {
    settings: { get: async key => key === 'IntuneEnrollmentPolicies' ? saved : '', set: async () => { writes++; } },
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async () => ({ data: { access_token: 'token' } }),
      get: async url => url.includes('/settings/all')
        ? { data: { items: [{ id: 'setting-1', template_id: 'endpoint_custom_attributes', value: '[{"name":"Action1 Provisioning Status"}]' }] } }
        : { data: { id: url.split('/').at(-1), exclude_filter: [{ field_name: 'custom:Action1 Provisioning Status', field_value: 'Completed', mode: 'include' }] } },
      delete: async () => { throw new Error('Cannot delete group'); }
    }
  };
  await assert.rejects(integration.actions['delete-action1-endpoint-group'](context, { payload: {
    organizationId: 'org-1', groupId: 'group-1', profileId: 'ENR-000001', selectedGroupIds: ['group-2']
  } }), /Cannot delete group/);
  assert.equal(writes, 0);
});

test('rejects missing group details and returns Action1 validation errors', async () => {
  const context = {
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async url => {
        if (url.endsWith('/oauth2/token')) return { data: { access_token: 'token' } };
        throw Object.assign(new Error('Bad request'), { response: { data: { user_message: 'Group name already exists.' } } });
      }
    }
  };
  const create = integration.actions['create-action1-endpoint-group'];
  await assert.rejects(create(context, { payload: { name: 'Group' } }), /organization/i);
  await assert.rejects(create(context, { payload: { organizationId: 'org' } }), /name is required/i);
  await assert.rejects(create(context, { payload: { organizationId: 'org', name: 'Group' } }), /Group name already exists/);
});
