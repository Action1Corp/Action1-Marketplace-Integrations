const assert = require('node:assert/strict');
const test = require('node:test');
const { AUTOMATION_TYPES, CREATABLE_AUTOMATION_TYPE_IDS, automationListItem, buildAutomationEditUrl, buildAutomationPayload, hasConfiguredAction, hasSavedActionConfiguration, hourlyScheduleSettings } = require('./action1Automation');
const { normalizeAction1AutomationSchedule } = require('./validate');
const integration = require('./index');

test('creates only the three provisioning automation types and still recognizes existing types', () => {
  assert.deepEqual(CREATABLE_AUTOMATION_TYPE_IDS, ['deploy-software', 'deploy-updates', 'run-script']);
  assert.deepEqual(Object.keys(AUTOMATION_TYPES), [
    'deploy-software',
    'deploy-updates',
    'reboot',
    'run-script',
    'uninstall-software'
  ]);
  assert.equal(Object.values(AUTOMATION_TYPES).some(type => type.templateId === 'update_ring'), false);
});

test('builds a disabled draft linked to unique endpoint groups', () => {
  const payload = buildAutomationPayload({
    name: '  Provision laptops  ',
    typeId: 'deploy-software',
    endpointGroupIds: ['group-a', 'group-a', ' group-b ']
  });

  assert.equal(payload.name, 'Provision laptops');
  assert.match(payload.settings, /^DISABLED EVERY:60 AT:00-00-00 DATE:\d{4}-\d{2}-\d{2}$/);
  assert.equal(payload.retry_minutes, '60');
  assert.deepEqual(payload.endpoints, [
    { id: 'group-a', type: 'EndpointGroup' },
    { id: 'group-b', type: 'EndpointGroup' }
  ]);
  assert.equal(payload.actions[0].template_id, 'deploy_package');
  assert.deepEqual(payload.actions[0].params.packages, [{ '': '' }]);
});

test('run-script drafts use Bash on Mac and Linux', () => {
  for (const [platform, expected] of [['macos', 'Mac'], ['linux', 'Linux']]) {
    const payload = buildAutomationPayload({ name: 'Configure', typeId: 'run-script', endpointGroupIds: ['group-a'], platform });
    assert.equal(payload.actions[0].params.platform, expected);
    assert.equal(payload.actions[0].params.run_script_language, 'Bash');
    assert.equal(payload.actions[0].params.condition_script_language, 'Bash');
  }
  assert.throws(() => buildAutomationPayload({ name: 'Configure', typeId: 'run-script', endpointGroupIds: ['group-a'], platform: 'android' }), /script platform/);
});

test('rejects missing names, groups, and unsupported automation types', () => {
  assert.throws(() => buildAutomationPayload({ typeId: 'run-script', endpointGroupIds: ['group-a'] }), /name is required/i);
  assert.throws(() => buildAutomationPayload({ name: 'Test', typeId: 'run-script', endpointGroupIds: [] }), /at least one/i);
  assert.throws(() => buildAutomationPayload({ name: 'Test', typeId: 'update-ring', endpointGroupIds: ['group-a'] }), /supported/i);
  for (const typeId of ['reboot', 'uninstall-software']) {
    assert.throws(() => buildAutomationPayload({ name: 'Test', typeId, endpointGroupIds: ['group-a'] }), /supported/i);
  }
});

test('builds type-specific editor URLs for regional Action1 hosts', () => {
  assert.equal(
    buildAutomationEditUrl('https://app.eu.action1.com/api/3.0', 'org 1', 'automation/1', 'run-script'),
    'https://app.eu.action1.com/console/new-policy-run-script/step-1?id=automation%2F1&org=org+1'
  );
});

test('normalizes an Action1 schedule for the created-automations list', () => {
  const schedule = normalizeAction1AutomationSchedule({
    id: 'schedule-1',
    name: 'Install baseline',
    settings: 'DISABLED',
    endpoints: [{ id: 'group-1', type: 'EndpointGroup' }],
    actions: [{ template_id: 'deploy_package' }]
  });
  assert.equal(schedule.enabled, false);
  assert.deepEqual(schedule.endpointGroupIds, ['group-1']);
  assert.deepEqual(schedule.templateIds, ['deploy_package']);
  assert.deepEqual(automationListItem(schedule, 'https://app.action1.com/api/3.0', 'org-1'), {
    id: 'schedule-1',
    name: 'Install baseline',
    typeLabel: 'Deploy Software',
    enabled: false,
    configurationReady: false,
    endpointGroupIds: ['group-1'],
    editUrl: 'https://app.action1.com/console/new-policy-deploy-package/step-1?id=schedule-1&org=org-1'
  });
});

test('does not list update rings as provisioning automations', () => {
  assert.equal(automationListItem({ id: 'ring', templateIds: ['update_ring'] }, 'https://app.action1.com/api/3.0', 'org'), null);
});

test('builds the enabled hourly schedule from the enable time in UTC', () => {
  assert.equal(hourlyScheduleSettings(true, new Date('2026-09-22T20:37:18Z')), 'ENABLED EVERY:60 AT:20-37-18 DATE:2026-09-22');
  assert.equal(hourlyScheduleSettings(false, new Date('2026-09-22T20:37:18Z')), 'DISABLED EVERY:60 AT:00-00-00 DATE:2026-09-22');
});

test('does not treat blank package or script placeholders as saved configuration', () => {
  for (const typeId of ['deploy-software', 'run-script']) {
    const draft = buildAutomationPayload({ name: 'Draft', typeId, endpointGroupIds: ['group-1'] });
    assert.equal(hasConfiguredAction(draft), false, typeId);
  }
  assert.equal(hasConfiguredAction({ actions: [{ template_id: 'deploy_package', params: {
    packages: [{ package_id: '1.0' }]
  } }] }), true);
  assert.equal(hasConfiguredAction({ actions: [{ template_id: 'run_script', params: {
    run_script_id: 'library-script'
  } }] }), true);
});

test('requires an Action1 save for the default update draft', () => {
  const draft = buildAutomationPayload({ name: 'Draft', typeId: 'deploy-updates', endpointGroupIds: ['group-1'] });
  assert.equal(hasConfiguredAction(draft), true);
  assert.equal(hasSavedActionConfiguration(draft), false);
  assert.equal(hasSavedActionConfiguration({ ...draft, settings: 'DISABLED' }), true);
});

test('delete only removes a supported automation linked to the selected group', async () => {
  const requests = [];
  const context = {
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async () => ({ data: { access_token: 'token' } }),
      get: async () => ({ data: {
        id: 'schedule-1', name: 'Baseline', settings: 'DISABLED',
        endpoints: [{ id: 'group-1', type: 'EndpointGroup' }],
        actions: [{ template_id: 'deploy_package', name: 'Deploy Software', params: { packages: [{ package: '1.0' }] } }]
      } }),
      delete: async url => { requests.push(url); return { data: {} }; }
    }
  };
  await assert.rejects(integration.actions['delete-provisioning-automation'](context, {
    payload: { organizationId: 'org', automationId: 'schedule-1', endpointGroupIds: ['group-2'] }
  }), /not linked/i);
  assert.equal(requests.length, 0);
  await integration.actions['delete-provisioning-automation'](context, {
    payload: { organizationId: 'org', automationId: 'schedule-1', endpointGroupIds: ['group-1'] }
  });
  assert.equal(requests.length, 1);
});

test('enables hourly only for an automation linked to the selected group', async () => {
  const patches = [];
  const context = {
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async () => ({ data: { access_token: 'token' } }),
      get: async () => ({ data: {
        id: 'schedule-1', name: 'Baseline', settings: 'DISABLED', retry_minutes: '480', randomize_start: false,
        endpoints: [{ id: 'group-1', type: 'EndpointGroup' }],
        actions: [{ template_id: 'deploy_package', name: 'Deploy Software', params: { packages: [{ package: '1.0' }] } }]
      } }),
      patch: async (url, payload) => { patches.push({ url, payload }); return { data: {} }; }
    }
  };
  await assert.rejects(integration.actions['enable-hourly-provisioning-automation'](context, {
    payload: { organizationId: 'org', automationId: 'schedule-1', endpointGroupIds: ['group-2'] }
  }), /not linked/i);
  assert.equal(patches.length, 0);
  const result = await integration.actions['enable-hourly-provisioning-automation'](context, {
    payload: { organizationId: 'org', automationId: 'schedule-1', endpointGroupIds: ['group-1'] }
  });
  assert.equal(result.enabled, true);
  assert.equal(patches.length, 1);
  assert.match(patches[0].payload.settings, /^ENABLED EVERY:60 AT:\d{2}-\d{2}-\d{2} DATE:\d{4}-\d{2}-\d{2}$/);
  assert.equal(patches[0].payload.retry_minutes, '480');
  assert.equal(patches[0].payload.settings_timezone, 'UTC');
  assert.equal(Object.hasOwn(patches[0].payload, 'randomize_start'), false);
  assert.equal(patches[0].payload.name, 'Baseline');
  assert.deepEqual(patches[0].payload.endpoints, [{ id: 'group-1', type: 'EndpointGroup' }]);
  assert.equal(patches[0].payload.actions[0].params.packages[0].package, '1.0');
});

test('cannot enable a blank automation draft', async () => {
  let patched = false;
  const context = {
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async () => ({ data: { access_token: 'token' } }),
      get: async () => ({ data: {
        id: 'schedule-1', name: 'Draft', settings: 'DISABLED',
        endpoints: [{ id: 'group-1', type: 'EndpointGroup' }],
        actions: [{ template_id: 'deploy_package', params: { packages: [{ '': '' }] } }]
      } }),
      patch: async () => { patched = true; }
    }
  };
  await assert.rejects(integration.actions['enable-hourly-provisioning-automation'](context, {
    payload: { organizationId: 'org', automationId: 'schedule-1', endpointGroupIds: ['group-1'] }
  }), /Finish configuring and saving/i);
  assert.equal(patched, false);
});

test('creates an Action1 schedule and returns its editor URL', async () => {
  const requests = [];
  const context = {
    action1: {
      getCredentials: async () => ({
        apiKey: 'client-id',
        apiSecret: 'client-secret',
        baseUrl: 'https://app.uk.action1.com/api/3.0'
      })
    },
    http: {
      post: async (url, data, options) => {
        requests.push({ url, data, options });
        if (url.endsWith('/oauth2/token')) return { data: { access_token: 'test-token' } };
        return { data: { id: 'automation-123' } };
      }
    }
  };

  const result = await integration.actions['create-action1-automation'](context, {
    payload: {
      organizationId: 'org-123',
      endpointGroupIds: ['group-123'],
      automationType: 'run-script',
      name: 'Run provisioning script'
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, 'https://app.uk.action1.com/api/3.0/automations/schedules/org-123');
  assert.equal(requests[1].data.actions[0].template_id, 'run_script');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-token');
  assert.equal(result.editUrl, 'https://app.uk.action1.com/console/new-policy-run-script/step-1?id=automation-123&org=org-123');
});

test('returns the Action1 validation message when schedule creation fails', async () => {
  const context = {
    action1: { getCredentials: async () => ({ apiKey: 'id', apiSecret: 'secret' }) },
    http: {
      post: async url => {
        if (url.endsWith('/oauth2/token')) return { data: { access_token: 'token' } };
        throw Object.assign(new Error('Request failed with status code 400'), {
          response: { data: { user_message: 'Select a software package.' } }
        });
      }
    }
  };

  await assert.rejects(
    integration.actions['create-action1-automation'](context, {
      payload: { organizationId: 'org', endpointGroupIds: ['group'], automationType: 'deploy-software', name: 'Test' }
    }),
    /Select a software package\./
  );
});


test('ETP creates a pending batch without direct HTTP writes or a false automation ID', async () => {
  const plans = [];
  const context = {
    action1: {
      getCredentials: async () => ({ apiKey: 'test', apiSecret: 'test', etpMode: 'etp' }),
      provisioner: { prepareSchedules: async plan => { plans.push(plan); return { ok: true, outcome: 'awaiting_signature', batchId: 'test', digest: 'test-digest' }; } }
    },
    http: { post: () => { throw new Error('ETP must not use direct HTTP'); } }
  };
  const result = await integration.actions['create-action1-automation'](context, { payload: {
    organizationId: 'org', name: 'Provision', automationType: 'run-script', endpointGroupIds: ['group'], idempotencyKey: 'intent-1'
  } });
  assert.equal(result.outcome, 'awaiting_signature');
  assert.equal(result.automationId, undefined);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].idempotencyKey, 'intent-1');
  assert.match(plans[0].schedules[0].payload.settings, /^DISABLED/);
});

test('API 4 schedule normalization preserves resource identity and disabled configuration', () => {
 const schedule = normalizeAction1AutomationSchedule({
  id:'resource', endpoints:[{id:'group',type:'EndpointGroup'}],
  configuration:{id:'configuration',name:'API4 example',settings:'DISABLED',actions:[{id:'action',template_id:'run_script',params:{run_script_text:'Write-Output 1'}}]}
 });
 assert.equal(schedule.id,'resource');
 assert.equal(schedule.name,'API4 example');
 assert.equal(schedule.enabled,false);
 assert.deepEqual(schedule.templateIds,['run_script']);
 assert.deepEqual(schedule.endpointGroupIds,['group']);
 assert.ok(!buildAutomationEditUrl('https://app.test.action1.com/api/4.0','org','resource','run-script').includes('/api/4.0'));
});

test('API 4 without ETP creation also uses the shared provisioner', async () => {
 let prepared;
 const context = {action1:{getCredentials:async()=>({apiKey:'test',apiSecret:'test',baseUrl:'https://app.test.action1.com/api/4.0',etpEnabled:false}),provisioner:{prepareSchedules:async plan=>{prepared=plan;return {outcome:'awaiting_approval',batchId:'batch'};}}},http:{post:()=>{throw Error('no direct write');}}};
 const result=await integration.actions['create-action1-automation'](context,{payload:{organizationId:'org',name:'Test',automationType:'run-script',endpointGroupIds:['group'],idempotencyKey:'intent'}});
 assert.equal(result.outcome,'awaiting_approval');
 assert.equal(prepared.schedules.length,1);
});

test('API 4 enable is blocked before any write while update validation is pending', async () => {
 const context={action1:{getCredentials:async()=>({baseUrl:'https://app.test.action1.com/api/4.0'})},http:{patch:()=>{throw Error('must not write');}}};
 await assert.rejects(()=>integration.actions['enable-hourly-provisioning-automation'](context,{}), /schedule updates are being validated/);
});
