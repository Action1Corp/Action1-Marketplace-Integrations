const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { withIsolatedControlPackRuntime } = require('./isolatedControlPackRuntime');
let activePack;

function selectedControl(control) {
  const group = activePack.catalog.automationGroups.find((entry) => entry.automationGroupId === control.automationGroupId);
  return {
    controlId: control.controlId, controlVersion: control.version,
    automationGroupId: control.automationGroupId, automationGroupVersion: group.version,
    parameters: Object.fromEntries((control.parameters || []).map((parameter) => [parameter.id, parameter.defaultValue]))
  };
}

function differentFamilyControl(draft) {
  const selectedGroups = new Set(draft.selectedControls.map((control) => control.automationGroupId));
  return selectedControl(activePack.catalog.controls.find((control) => !selectedGroups.has(control.automationGroupId)));
}

function changedParameters(control) {
  const definition = activePack.catalog.controls.find((entry) => entry.controlId === control.controlId);
  const parameter = definition.parameters[0];
  const next = { ...control.parameters };
  if (parameter.type === 'integer') next[parameter.id] = Number(control.parameters[parameter.id]) < parameter.maximum ? Number(control.parameters[parameter.id]) + 1 : Number(control.parameters[parameter.id]) - 1;
  else if (parameter.type === 'enum') next[parameter.id] = parameter.options.find((option) => option.value !== control.parameters[parameter.id]).value;
  else if (parameter.type === 'boolean') next[parameter.id] = !control.parameters[parameter.id];
  else next[parameter.id] = `${control.parameters[parameter.id]} changed`;
  return next;
}

function createFakeDb() {
  const state = {
    policies: [],
    controls: [],
    reservations: [],
    correlations: [],
    nextPolicyRowId: 1,
    nextControlRowId: 1,
    nextReservationRowId: 1,
    lastPolicySequence: 0
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createPolicyRow(params) {
    return {
      id: state.nextPolicyRowId++,
      policy_sequence: params[0],
      policy_id: params[1],
      base_name: params[2],
      display_name: params[3],
      description: params[4],
      organization_id: params[5],
      organization_name_snapshot: params[6],
      scope_type: params[7],
      endpoint_group_id: params[8],
      endpoint_group_name_snapshot: params[9],
      policy_mode: params[10],
      run_every_hours: params[11],
      start_date: params[12],
      start_time: params[13],
      timezone: params[14],
      completion_deadline_minutes: params[15],
      enabled: params[16],
      control_pack_id: params[17],
      control_pack_version: params[18],
      created_at: '2026-08-12T00:00:00.000Z',
      updated_at: '2026-08-12T00:00:00.000Z'
    };
  }

  return {
    raw: { provider: 'sqlite' },
    state,
    state,
    async run(sql, params = []) {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
        return { changes: 0 };
      }

      if (sql.includes('INSERT INTO action1_configuration_manager_policies')) {
        state.lastPolicySequence = params[0];
        state.policies.push(createPolicyRow(params));
        return { changes: 1, lastID: state.policies[state.policies.length - 1].id };
      }

      if (sql.includes('UPDATE action1_configuration_manager_policies') && sql.includes('SET base_name = ?')) {
        const existing = state.policies.find((entry) => entry.policy_id === params[12]);
        if (!existing) {
          return { changes: 0 };
        }

        existing.base_name = params[0];
        existing.display_name = params[1];
        existing.description = params[2];
        existing.policy_mode = params[3];
        existing.run_every_hours = params[4];
        existing.start_date = params[5];
        existing.start_time = params[6];
        existing.timezone = params[7];
        existing.completion_deadline_minutes = params[8];
        existing.control_pack_id = params[9];
        existing.control_pack_version = params[10];
        existing.enabled = params[11];
        existing.updated_at = '2026-08-12T01:00:00.000Z';
        return { changes: 1 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_policies') && sql.includes('SET policy_sequence = ?')) {
        const existing = state.policies.find((entry) => entry.id === params[2]);
        if (!existing) {
          return { changes: 0 };
        }

        state.lastPolicySequence = params[0];
        existing.policy_sequence = params[0];
        existing.policy_id = params[1];
        existing.updated_at = '2026-08-12T00:30:00.000Z';
        return { changes: 1 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_policies') && sql.includes('SET enabled = ?')) {
        const existing = state.policies.find((entry) => entry.policy_id === params[1]);
        if (!existing) {
          return { changes: 0 };
        }
        existing.enabled = params[0];
        existing.updated_at = '2026-08-12T01:00:00.000Z';
        return { changes: 1 };
      }

      if (sql.includes('DELETE FROM action1_configuration_manager_policy_controls')) {
        state.controls = state.controls.filter((entry) => entry.policy_id !== params[0]);
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO action1_configuration_manager_policy_controls')) {
        state.controls.push({
          id: state.nextControlRowId++,
          policy_id: params[0],
          control_id: params[1],
          control_version: params[2],
          automation_group_id: params[3],
          automation_group_version: params[4],
          parameters_json: params[5]
        });
        return { changes: 1 };
      }

      if (sql.includes('DELETE FROM action1_configuration_manager_scope_reservations')) {
        state.reservations = state.reservations.filter((entry) => entry.policy_id !== params[0]);
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO action1_configuration_manager_scope_reservations')) {
        state.reservations.push({
          id: state.nextReservationRowId++,
          policy_id: params[0],
          organization_id: params[1],
          scope_type: params[2],
          endpoint_group_id: params[3]
        });
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO action1_configuration_manager_automation_correlations')) {
        state.correlations.push({
          policy_id: params[0], automation_group_id: params[1], automation_group_version: params[2],
          control_family_name_snapshot: params[3], action1_organization_id: params[4],
          action1_automation_id: params[5], action1_automation_configuration_id: params[6], action1_automation_action_id: params[7], action1_automation_name: params[8], action1_automation_self: params[9],
          desired_definition_fingerprint: params[10], active: 1, last_applied_at: params[11], last_error: params[12],
          created_at: '2026-08-12T01:00:00.000Z', updated_at: '2026-08-12T01:00:00.000Z'
        });
        return { changes: 1 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_automation_correlations') && sql.includes('SET active = 0')) {
        const row = state.correlations.find((entry) => entry.policy_id === params[1] && entry.automation_group_id === params[2]);
        if (row) { row.active = 0; row.last_error = params[0]; }
        return { changes: row ? 1 : 0 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_automation_correlations') && sql.includes('SET action1_automation_configuration_id')) {
        const row = state.correlations.find((entry) => entry.policy_id === params[1] && entry.automation_group_id === params[2]);
        if (row) row.action1_automation_configuration_id = params[0];
        return { changes: row ? 1 : 0 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_automation_correlations') && sql.includes('SET automation_group_version')) {
        if (sql.includes('action1_organization_id = ?')) {
          const row = state.correlations.find(entry => entry.policy_id === params[10] && entry.automation_group_id === params[11]);
          if (row) Object.assign(row, { automation_group_version: params[0], control_family_name_snapshot: params[1],
            action1_organization_id: params[2], action1_automation_id: params[3], action1_automation_configuration_id: params[4],
            action1_automation_action_id: params[5], action1_automation_name: params[6], action1_automation_self: params[7],
            desired_definition_fingerprint: params[8], last_applied_at: params[9], active: 1, last_error: null });
          return { changes: row ? 1 : 0 };
        }
        const row = state.correlations.find((entry) => entry.policy_id === params[7] && entry.automation_group_id === params[8]);
        if (row) {
          row.automation_group_version = params[0];
          row.control_family_name_snapshot = params[1];
          row.action1_automation_name = params[2];
          row.action1_automation_self = params[3] || row.action1_automation_self;
          row.desired_definition_fingerprint = params[4];
          row.active = 1;
          row.last_applied_at = params[5];
          row.last_error = params[6];
        }
        return { changes: row ? 1 : 0 };
      }

      if (sql.includes('DELETE FROM action1_configuration_manager_automation_correlations')) {
        state.correlations = state.correlations.filter((entry) => entry.policy_id !== params[0]);
        return { changes: 1 };
      }

      if (sql.includes('DELETE FROM action1_configuration_manager_policies')) {
        state.policies = state.policies.filter((entry) => entry.policy_id !== params[0]);
        return { changes: 1 };
      }

      throw new Error(`Unhandled SQL in fake db.run: ${sql}`);
    },

    async get(sql, params = []) {
      if (sql.includes('sqlite_sequence')) {
        return state.lastPolicySequence ? { last_sequence: state.lastPolicySequence } : null;
      }

      if (sql.includes('SELECT MAX(policy_sequence) AS max_sequence')) {
        const sequences = state.policies.map((entry) => entry.policy_sequence).filter((value) => Number(value) > 0);
        return { max_sequence: sequences.length ? Math.max(...sequences) : null };
      }

      if (sql.includes('FROM action1_configuration_manager_policies') && sql.includes('WHERE policy_id = ?')) {
        return clone(state.policies.find((entry) => entry.policy_id === params[0]) || null);
      }

      throw new Error(`Unhandled SQL in fake db.get: ${sql}`);
    },

    async all(sql, params = []) {
      if (sql.includes('FROM action1_configuration_manager_policies') && sql.includes('ORDER BY')) {
        return clone([...state.policies]);
      }

      if (sql.includes('FROM action1_configuration_manager_policy_controls') && sql.includes('WHERE policy_id = ?')) {
        return clone(state.controls.filter((entry) => entry.policy_id === params[0]));
      }

      if (sql.includes('FROM action1_configuration_manager_scope_reservations') && sql.includes('WHERE organization_id = ?')) {
        return clone(state.reservations.filter((entry) => entry.organization_id === params[0]));
      }

      if (sql.includes('FROM action1_configuration_manager_automation_correlations') && sql.includes('WHERE policy_id = ?')) {
        return clone(state.correlations.filter((entry) => entry.policy_id === params[0] && (!sql.includes('AND active = 1') || entry.active === 1)));
      }

      throw new Error(`Unhandled SQL in fake db.all: ${sql}`);
    }
  };
}

function createFakeContext(contextOptions = {}) {
  let automationNumber = 0;
  let creationAttempts = 0;
  const requests = [];
  return {
    db: createFakeDb(),
    action1: { async getCredentials() { return { baseUrl: contextOptions.api4 ? 'https://action1.test/api/4.0' : 'https://action1.test/api/3.0', apiKey: 'test-key', apiSecret: 'test-secret', etpEnabled: false }; } },
    async http(options) {
      requests.push(options);
      if (options.method === 'POST' && options.url.includes('/automations/schedules/') && contextOptions.failAutomationAt && ++creationAttempts === contextOptions.failAutomationAt) {
        const error = new Error('Scheduled Automation creation failed'); error.statusCode = 500; throw error;
      }
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      if (options.url.includes('/automations/instances/')) {
        if (contextOptions.instanceError) throw contextOptions.instanceError;
        if (contextOptions.instanceResponse) return contextOptions.instanceResponse;
        if (contextOptions.api4) return { status: 201, data: { id: 'cleanup-instance', type: 'AutomationInstance', actions: options.data.configuration.actions }, headers: {} };
      }
      if (options.method === 'GET' && /\/automations\/schedules\/[^/]+\/[^/]+$/.test(options.url)) {
        const automationId = decodeURIComponent(options.url.split('/').pop());
        if (contextOptions.api4) {
          if (contextOptions.invalidRecovery) return { status: 200, data: { id: automationId, type: 'AutomationSchedule', configuration: { type: 'AutomationScheduleConfiguration', organization_id: 'org-acme', name: 'A1CM - Existing automation', actions: [] } }, headers: {} };
          return { status: 200, data: { id: automationId, type: 'AutomationSchedule', configuration: { id: contextOptions.configurationId || 'recovered-configuration-id', type: 'AutomationScheduleConfiguration', organization_id: 'org-acme', name: 'A1CM - Existing automation', actions: [{ id: 'recovered-action-id', template_id: 'run_script' }] }, endpoints: [{ id: 'group-finance', type: 'EndpointGroup' }] }, headers: {} };
        }
        return { status: 200, data: { id: automationId, self: `https://action1.test/api/3.0/automations/schedules/org-acme/${automationId}`, name: 'A1CM - Existing automation' }, headers: {} };
      }
      if (contextOptions.api4 && options.method === 'POST' && options.url.includes('/automations/schedules/')) {
        automationNumber += 1;
        const configuration = options.data.configuration;
        return { status: 201, data: { id: `auto-${automationNumber}`, type: 'AutomationSchedule', configuration: { ...configuration, organization_id: 'org-acme' }, endpoints: configuration ? options.data.endpoints : [] }, headers: { 'content-type': 'application/json' } };
      }
      if (contextOptions.api4 && options.method === 'PATCH' && options.url.includes('/automations/schedules/')) {
        const resourceId = decodeURIComponent(options.url.split('/').pop());
        return { status: 200, data: { id: resourceId, type: 'AutomationSchedule', configuration: options.data.configuration, endpoints: options.data.endpoints }, headers: { 'content-type': 'application/json' } };
      }
      automationNumber += 1;
      return { status: 201, data: { id: `auto-${automationNumber}`, self: `https://action1.test/api/3.0/automations/schedules/org-acme/auto-${automationNumber}`, name: `A1CM - Workstation Security - Finance Workstations - ${automationNumber}`, actions: [{ name: 'Run PowerShell', template_id: 'run_script', id: `Run_PowerShell_${automationNumber}` }] }, headers: {} };
    },
    raw: { provider: 'sqlite' },
    logger: {
      info() {},
      warn() {},
      error() {}
    },
    requests
  };
}

function createValidDraft() {
  return {
    mode: 'create',
    enabled: true,
    baseName: 'Workstation Security',
    description: '',
    organizationId: 'org-acme',
    organizationName: 'Acme Corp',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupId: 'group-finance',
    endpointGroupName: 'Finance Workstations',
    policyMode: 'ASSESS_ONLY',
    runSchedule: {
      runEveryHours: 24,
      startDate: '2026-08-12',
      startTime: '09:30',
      timezone: 'America/Los_Angeles'
    },
    completionDeadlineMinutes: 1440,
    selectedControls: [selectedControl(activePack.catalog.controls[0])]
  };
}

async function run() {
  await withIsolatedControlPackRuntime(async ({ fixture }) => {
  activePack = { ...fixture, baselinesArtifact: { baselines: fixture.baselines } };
  const manifest = require(path.join(__dirname, '..', 'manifest.json'));
  const actionIds = manifest.actions.map((action) => action.id);

  assert(actionIds.includes('list-policies'));
  assert(actionIds.includes('save-policy'));
  assert(manifest.actions.filter((action) => action.history === false).length >= 5);

  const source = fs.readFileSync(path.join(__dirname, '..', 'policyActions.js'), 'utf8');
  assert.strictEqual(source.includes('context.action1.getCredentials'), false);
  assert.strictEqual(source.includes('run_script_text'), false);
  assert(source.includes('request.run'), 'Create/Delete should append progress checkpoints to the tracked Marketplace action run');

  const actions = require(path.join(__dirname, '..', 'actions.js')).actions;
  const etpContext = createFakeContext({ api4: true });
  etpContext.integrationId = 'action1-configuration-manager';
  const originalCredentials = etpContext.action1.getCredentials;
  etpContext.action1.getCredentials = async () => ({ ...await originalCredentials(), etpEnabled: true, etpMode: 'etp', etpCapabilitySource: 'marketplace-setting' });
  let signingJob;
  const compareDigest = (value) => {
    const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
    return require('node:crypto').createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
  };
  etpContext.action1.provisioner = {
    async prepareSigning(input) {
      if (!signingJob) signingJob = { id: require('node:crypto').randomUUID(), integrationId: etpContext.integrationId,
        state: 'awaiting_signature', purpose: 'sign-only', digest: 'synthetic-digest', expiresAt: Date.now() + 60000,
        origin: new URL((await originalCredentials()).baseUrl).origin, objects: JSON.parse(JSON.stringify(input.objects)) };
      assert.deepStrictEqual(input.objects, signingJob.objects);
      return { ok: true, outcome: signingJob.state, signingId: signingJob.id, digest: signingJob.digest };
    },
    async getSigning() { return signingJob; }
  };
  const unsignedAlias = await actions['save-policy'](etpContext, { payload: { draft: createValidDraft() } });
  assert.strictEqual(unsignedAlias.ok, false, 'ETP aliases must not create unsigned schedules');
  assert.strictEqual(etpContext.requests.length, 0);
  const signingPayload = { operation: 'create', intentId: '22222222-2222-4222-8222-222222222222', draft: createValidDraft() };
  const etpPrepared = await actions['prepare-policy-signing'](etpContext, { payload: signingPayload });
  assert.strictEqual(etpPrepared.ok, true, etpPrepared.message);
  assert.strictEqual(etpPrepared.signingRequired, true);
  assert.strictEqual(etpContext.db.state.policies[0].enabled, 0, 'Only a disabled local intent exists before the popup');
  assert.strictEqual(etpContext.requests.length, 0, 'Preparation must perform no Action1 mutations');
  signingJob.state = 'signed';
  signingJob.results = signingJob.objects.map(o => ({ id: o.id, configurationDigest: compareDigest(o.configuration),
    signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-signature' } }));
  const etpCompletion = { ...signingPayload, policyId: etpPrepared.policyId, signingId: etpPrepared.signingId, digest: etpPrepared.digest };
  const originalHttp = etpContext.http;
  let releasePost, enteredPost;
  const waitForPost = new Promise(resolve => { enteredPost = resolve; });
  const postGate = new Promise(resolve => { releasePost = resolve; });
  etpContext.http = async input => {
    if (input.method === 'POST' && input.url.includes('/automations/schedules/')) { enteredPost(); await postGate; }
    return originalHttp(input);
  };
  const firstCompletion = actions['create-policy'](etpContext, { payload: etpCompletion });
  await waitForPost;
  const concurrentCompletion = actions['save-policy'](etpContext, { payload: { ...etpCompletion, policyId: ` ${etpCompletion.policyId} ` } });
  await new Promise(resolve => setImmediate(resolve));
  releasePost();
  const [etpCreated, duplicateCompletion] = await Promise.all([firstCompletion, concurrentCompletion]);
  etpContext.http = originalHttp;
  assert.strictEqual(duplicateCompletion.ok, false, 'Concurrent completion through an alias must not replay signed POSTs');
  assert.strictEqual(etpCreated.ok, true, etpCreated.message);
  assert.strictEqual(etpCreated.policy.enabled, true);
  const etpPost = etpContext.requests.find(r => r.url.includes('/automations/schedules/') && r.method === 'POST');
  assert.deepStrictEqual(etpPost.data.configuration, signingJob.objects[0].configuration);
  assert.deepStrictEqual(etpPost.data.signatures[0].object_signature, signingJob.results[0].signature);
  const replayedCreate = await actions['create-policy'](etpContext, { payload: etpCompletion });
  assert.strictEqual(replayedCreate.ok, false);
  assert.strictEqual(etpContext.requests.filter(r => r.url.includes('/automations/schedules/') && r.method === 'POST').length, 1);
  const etpEdited = await actions['update-policy'](etpContext, { payload: { draft: { ...etpCreated.policy, mode: 'edit', baseName: 'Changed' } } });
  assert.strictEqual(etpEdited.ok, false);
  assert.strictEqual(etpContext.db.state.policies[0].base_name, etpCreated.policy.baseName, 'Unsupported ETP editing must not persist changes');
  const remoteSchedules = new Map([[etpContext.db.state.correlations[0].action1_automation_id,
    { id: etpContext.db.state.correlations[0].action1_automation_id, type: 'AutomationSchedule', ...structuredClone(etpPost.data) }]]);
  const beforeEditHttp = etpContext.http;
  etpContext.http = async input => {
    if (input.method === 'GET' && input.url.includes('/automations/schedules/')) {
      etpContext.requests.push(input);
      return { status: 200, data: structuredClone(remoteSchedules.get(input.url.split('/').pop())) };
    }
    const response = await beforeEditHttp(input);
    if (['POST', 'PATCH'].includes(input.method) && input.url.includes('/automations/schedules/')) remoteSchedules.set(response.data.id, structuredClone(response.data));
    return response;
  };
  signingJob = null;
  const editPayload = { operation: 'edit', intentId: require('node:crypto').randomUUID(),
    draft: { ...etpCreated.policy, mode: 'edit', baseName: 'Signed Policy edit' } };
  const editStart = etpContext.requests.length;
  const preparedEdit = await actions['prepare-policy-signing'](etpContext, { payload: editPayload });
  assert.strictEqual(preparedEdit.ok, true, preparedEdit.message);
  assert.strictEqual(etpContext.db.state.policies[0].base_name, etpCreated.policy.baseName, 'Preparation leaves desired Policy state untouched');
  const editCompletionPayload = { ...editPayload, policyId: preparedEdit.policyId, signingId: preparedEdit.signingId, digest: preparedEdit.digest };
  const notSigned = await actions['update-policy'](etpContext, { payload: editCompletionPayload });
  assert.strictEqual(notSigned.ok, false);
  assert(etpContext.requests.slice(editStart).every(r => r.method === 'GET' || r.url.endsWith('/oauth2/token')));
  assert(!etpContext.requests.slice(editStart).some(r => ['PATCH', 'DELETE'].includes(r.method)));
  signingJob.state = 'signed';
  signingJob.results = signingJob.objects.map(o => ({ id: o.id, configurationDigest: compareDigest(o.configuration),
    signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-edit-signature' } }));
  const appliedEdit = await actions['update-policy'](etpContext, { payload: editCompletionPayload });
  assert.strictEqual(appliedEdit.ok, true, appliedEdit.message);
  assert.strictEqual(etpContext.db.state.policies[0].base_name, 'Signed Policy edit');
  assert.deepStrictEqual(etpContext.requests.find(r => r.method === 'PATCH').data.configuration, signingJob.objects[0].configuration);
  assert.strictEqual(etpContext.db.state.correlations[0].action1_automation_configuration_id, etpPost.data.configuration.id);
  assert.strictEqual(etpContext.db.state.correlations[0].action1_automation_action_id, etpPost.data.configuration.actions[0].id);
  const beforeNoop = etpContext.requests.length;
  const noopPrepared = await actions['prepare-policy-signing'](etpContext, { payload: { ...editPayload, intentId: require('node:crypto').randomUUID() } });
  assert.strictEqual(noopPrepared.ok, true, noopPrepared.message);
  assert.strictEqual(noopPrepared.signingRequired, false);
  const noopEdit = await actions['update-policy'](etpContext, { payload: { draft: editPayload.draft } });
  assert.strictEqual(noopEdit.ok, true, noopEdit.message);
  assert(etpContext.requests.slice(beforeNoop).every(r => r.method === 'GET' || r.url.endsWith('/oauth2/token')), 'No-op edits need no signature or resource mutation');
  const etpDeleted = await actions['delete-policy'](etpContext, { payload: { policyId: etpCreated.policy.policyId } });
  assert.strictEqual(etpDeleted.ok, false);
  assert.strictEqual(etpContext.requests.some(r => r.method === 'DELETE'), false, 'Do not delete schedules before unsupported cleanup signing');
  const beforeEnableConfiguration = etpContext.db.state.correlations[0].action1_automation_configuration_id;
  const etpDisabled = await actions['disable-policy'](etpContext, { payload: { policyId: etpCreated.policy.policyId, enabled: false } });
  assert.strictEqual(etpDisabled.ok, true, etpDisabled.message);
  assert.strictEqual(etpDisabled.policy.enabled, false);
  assert.strictEqual(etpContext.requests.some(r => r.url.includes('/automations/instances/')), false);
  const etpEnableAlias = await actions['set-policy-enabled'](etpContext, { payload: { policyId: etpCreated.policy.policyId, enabled: true } });
  assert.strictEqual(etpEnableAlias.ok, false);
  signingJob = null;
  const enablePayload = { operation: 'enable', policyId: etpCreated.policy.policyId, enabled: true, intentId: require('node:crypto').randomUUID() };
  const preparedEnable = await actions['prepare-policy-signing'](etpContext, { payload: enablePayload });
  assert.strictEqual(preparedEnable.ok, true, preparedEnable.message);
  signingJob.state = 'signed';
  signingJob.results = signingJob.objects.map(o => ({ id: o.id, configurationDigest: compareDigest(o.configuration),
    signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-enable-signature' } }));
  const etpEnabled = await actions['enable-policy'](etpContext, { payload: { ...enablePayload, signingId: preparedEnable.signingId, digest: preparedEnable.digest } });
  assert.strictEqual(etpEnabled.ok, true, etpEnabled.message);
  assert.strictEqual(etpEnabled.policy.enabled, true);
  assert.strictEqual(etpContext.db.state.correlations.length, 1, 'Enable replaces the existing correlation');
  assert.strictEqual(etpContext.db.state.correlations[0].active, 1);
  assert.notStrictEqual(etpContext.db.state.correlations[0].action1_automation_configuration_id, beforeEnableConfiguration);
  assert.deepStrictEqual(etpContext.requests.filter(r => r.method === 'POST' && r.url.includes('/automations/schedules/')).at(-1).data.configuration, signingJob.objects[0].configuration);
  const partialETP = createFakeContext({ api4: true, failAutomationAt: 2 });
  partialETP.integrationId = etpContext.integrationId;
  const partialCredentials = partialETP.action1.getCredentials;
  partialETP.action1.getCredentials = async () => ({ ...await partialCredentials(), etpEnabled: true, etpMode: 'etp' });
  partialETP.action1.provisioner = etpContext.action1.provisioner;
  signingJob = null;
  const partialDraft = createValidDraft();
  partialDraft.selectedControls.push(differentFamilyControl(partialDraft));
  const partialPayload = { operation: 'create', intentId: require('node:crypto').randomUUID(), draft: partialDraft };
  const partialPrepared = await actions['prepare-policy-signing'](partialETP, { payload: partialPayload });
  assert.strictEqual(partialPrepared.ok, true, partialPrepared.message);
  signingJob.state = 'signed';
  signingJob.results = signingJob.objects.map(o => ({ id: o.id, configurationDigest: compareDigest(o.configuration),
    signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-signature' } }));
  const partialResult = await actions['create-policy'](partialETP, { payload: { ...partialPayload, policyId: partialPrepared.policyId,
    signingId: partialPrepared.signingId, digest: partialPrepared.digest } });
  assert.strictEqual(partialResult.ok, false);
  assert.strictEqual(partialETP.db.state.policies[0].enabled, 0);
  assert.strictEqual(partialETP.db.state.correlations.length, 1, 'A later failed POST preserves the accepted schedule correlation');
  assert.strictEqual(partialETP.db.state.correlations[0].action1_automation_configuration_id, signingJob.objects[0].configuration.id);
  const partialReplan = await actions['prepare-policy-signing'](partialETP, { payload: { operation: 'enable', policyId: partialPrepared.policyId, intentId: require('node:crypto').randomUUID() } });
  assert.strictEqual(partialReplan.ok, false, 'Do not blindly prepare a full replacement set over a partial apply');
  assert.strictEqual(partialETP.requests.filter(r => r.method === 'POST' && r.url.includes('/automations/schedules/')).length, 2);

  // Delete preparation and completion use the real handlers and DB cleanup.
  // A failed instance POST keeps the Policy/reservation and successful schedule deletions.
  signingJob = null;
  const deletePayload = { operation: 'delete', policyId: etpCreated.policy.policyId, intentId: require('node:crypto').randomUUID() };
  const beforeDelete = etpContext.requests.length;
  const preparedDelete = await actions['prepare-policy-signing'](etpContext, { payload: deletePayload });
  assert.strictEqual(preparedDelete.ok, true, preparedDelete.message);
  const deleteCompletion = { ...deletePayload, signingId: preparedDelete.signingId, digest: preparedDelete.digest };
  const cancelledDelete = await actions['delete-policy'](etpContext, { payload: deleteCompletion });
  assert.strictEqual(cancelledDelete.ok, false);
  assert(etpContext.requests.slice(beforeDelete).every(r => r.method === 'GET' || r.url.endsWith('/oauth2/token')));
  assert.strictEqual(etpContext.db.state.policies.length, 1);
  const approve = () => {
    signingJob.state = 'signed';
    signingJob.results = signingJob.objects.map(o => ({ id: o.id, configurationDigest: compareDigest(o.configuration),
      signature: { alg: 'synthetic-alg', iat: 1, kid: 'synthetic-key', value: 'synthetic-cleanup-signature' } }));
  };
  approve();
  const getApprovedSigning = etpContext.action1.provisioner.getSigning;
  const originalDescription = etpContext.db.state.policies[0].description;
  etpContext.action1.provisioner.getSigning = async () => {
    etpContext.db.state.policies[0].description = 'Changed during approval retrieval';
    return signingJob;
  };
  const changedDuringRetrieval = await actions['delete-policy'](etpContext, { payload: deleteCompletion });
  assert.strictEqual(changedDuringRetrieval.ok, false, 'Policy must be revalidated after retrieving approval');
  assert(etpContext.requests.slice(beforeDelete).every(r => r.method === 'GET' || r.url.endsWith('/oauth2/token')));
  etpContext.db.state.policies[0].description = originalDescription;
  etpContext.action1.provisioner.getSigning = getApprovedSigning;
  const deleteHttp = etpContext.http;
  etpContext.http = async input => {
    if (input.method === 'POST' && input.url.includes('/automations/instances/')) throw new Error('Cleanup unavailable');
    return deleteHttp(input);
  };
  const failedDelete = await actions['delete-policy'](etpContext, { payload: deleteCompletion });
  assert.strictEqual(failedDelete.ok, false);
  assert.strictEqual(etpContext.db.state.policies.length, 1, 'Cleanup failure retains Policy');
  assert.strictEqual(etpContext.db.state.correlations[0].active, 0, 'Accepted schedule DELETE remains inactive');
  etpContext.http = deleteHttp;
  const staleDelete = await actions['delete-policy'](etpContext, { payload: deleteCompletion });
  assert.strictEqual(staleDelete.ok, false, 'Changed correlations require a new reviewed signing intent');
  const disableAfterFailure = await actions['disable-policy'](etpContext, { payload: { policyId: deletePayload.policyId, enabled: false } });
  assert.strictEqual(disableAfterFailure.ok, true, disableAfterFailure.message);
  assert.strictEqual(disableAfterFailure.policy.enabled, false);
  signingJob = null;
  const retryPayload = { ...deletePayload, intentId: require('node:crypto').randomUUID() };
  const retryDelete = await actions['prepare-policy-signing'](etpContext, { payload: retryPayload });
  assert.strictEqual(retryDelete.ok, true, retryDelete.message);
  approve();
  const acceptedDelete = await actions['delete-policy'](etpContext, { payload: { ...retryPayload, signingId: retryDelete.signingId, digest: retryDelete.digest } });
  assert.strictEqual(acceptedDelete.ok, true, acceptedDelete.message);
  assert.strictEqual(etpContext.db.state.policies.length, 0);
  assert.strictEqual(etpContext.db.state.correlations.length, 0);
  const instancePost = etpContext.requests.find(r => r.method === 'POST' && r.url.includes('/automations/instances/'));
  assert.deepStrictEqual(instancePost.data.configuration, signingJob.objects[0].configuration);
  assert.deepStrictEqual(instancePost.data.signatures[0].object_reference, { type: 'AutomationScheduleConfiguration',
    id: signingJob.objects[0].configuration.id, organization_id: 'org-acme' });

  const disabledPolicy = (await actions['get-policy'](partialETP, { payload: { policyId: partialPrepared.policyId } })).policy;
  const etpDisabledEdit = { operation: 'edit', intentId: require('node:crypto').randomUUID(),
    draft: { ...disabledPolicy, mode: 'edit', selectedControls: disabledPolicy.selectedControls.slice(0, 1) } };
  signingJob = null;
  const beforeDisabledEdit = partialETP.requests.length;
  const disabledPrepared = await actions['prepare-policy-signing'](partialETP, { payload: etpDisabledEdit });
  assert.strictEqual(disabledPrepared.ok, true, disabledPrepared.message);
  assert.strictEqual(signingJob.objects.length, 1, 'Disabled removal signs only cleanup');
  const disabledCompletion = { ...etpDisabledEdit, policyId: disabledPolicy.policyId,
    signingId: disabledPrepared.signingId, digest: disabledPrepared.digest };
  const cancelledRemoval = await actions['update-policy'](partialETP, { payload: disabledCompletion });
  assert.strictEqual(cancelledRemoval.ok, false);
  assert.strictEqual(partialETP.requests.length, beforeDisabledEdit, 'Cancelled disabled edit has no API requests');
  assert.strictEqual((await actions['get-policy'](partialETP, { payload: { policyId: disabledPolicy.policyId } })).policy.selectedControls.length, 2);
  approve();
  const disabledRemoval = await actions['update-policy'](partialETP, { payload: disabledCompletion });
  assert.strictEqual(disabledRemoval.ok, true, disabledRemoval.message);
  assert.strictEqual(disabledRemoval.policy.enabled, false);
  assert.strictEqual(disabledRemoval.policy.selectedControls.length, 1);
  assert.deepStrictEqual(partialETP.requests.slice(beforeDisabledEdit).filter(r => !r.url.endsWith('/oauth2/token')).map(r => r.method), ['POST']);
  assert.strictEqual(partialETP.db.state.correlations.length, 1, 'Disabled edits retain existing schedule correlations');
  const beforeDisabledNoop = partialETP.requests.length;
  const disabledNoop = await actions['prepare-policy-signing'](partialETP, { payload: { ...etpDisabledEdit,
    intentId: require('node:crypto').randomUUID(), draft: { ...disabledRemoval.policy, mode: 'edit', baseName: 'Disabled local edit' } } });
  assert.strictEqual(disabledNoop.signingRequired, false);
  assert.strictEqual(partialETP.requests.length, beforeDisabledNoop);

  assert.strictEqual(manifest.actions.find((action) => action.id === 'delete-policy').history, true);
  for (const policyId of [undefined, null, '', '   ', 64, {}, [], true]) {
    const invalidContext = createFakeContext();
    invalidContext.db.get = async () => { throw new Error('Invalid ID reached Policy lookup'); };
    const result = await actions['delete-policy'](invalidContext, { payload: { policyId } });
    assert.strictEqual(result.ok, false, `Invalid ID must fail: ${JSON.stringify(policyId)}`);
    assert.match(result.message, /Policy id.*(required|invalid)/i);
    assert.strictEqual(typeof result.details, 'string');
    assert.strictEqual(invalidContext.requests.length, 0);
  }
  const bareRequest = await actions['delete-policy'](createFakeContext(), { policyId: 'POL-000001' });
  assert.strictEqual(bareRequest.ok, false, 'The payload envelope is required');
  const unknown = await actions['delete-policy'](createFakeContext(), { payload: { policyId: 'POL-999999' } });
  assert.strictEqual(unknown.ok, true);
  assert.strictEqual(unknown.deleted, false);
  assert.strictEqual(unknown.policy, null);

  for (const failure of [{ instanceError: Object.assign(new Error('socket timeout after POST'), { code: 'ETIMEDOUT' }) }, { instanceResponse: { status: 400, data: { message: 'cleanup rejected' }, headers: {} } }]) {
    const failingContext = createFakeContext(failure);
    const created = await actions['create-policy'](failingContext, { payload: { draft: createValidDraft() } });
    assert.strictEqual(created.ok, true, created.message);
    const failed = await actions['delete-policy'](failingContext, { payload: { policyId: created.policy.policyId } });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual((await actions['get-policy'](failingContext, { payload: { policyId: created.policy.policyId } })).ok, true);
    assert.strictEqual((await failingContext.db.all('SELECT * FROM action1_configuration_manager_scope_reservations WHERE organization_id = ?', ['org-acme'])).length, 1);
    assert.strictEqual(failingContext.requests.filter((request) => request.url.includes('/automations/instances/')).length, 1);
  }
  const authoritativeContext = createFakeContext();
  const authoritative = await actions['create-policy'](authoritativeContext, { payload: { draft: createValidDraft() } });
  const requestStart = authoritativeContext.requests.length;
  const removed = await actions['delete-policy'](authoritativeContext, { payload: {
    policyId: ` ${authoritative.policy.policyId} `, organizationId: 'wrong-org', scopeType: 'ALL_ENDPOINTS',
    endpointGroupId: 'wrong-group', automationIds: ['wrong-auto'], correlationIds: ['wrong'], cleanup: { retry_minutes: 1 }
  } });
  assert.strictEqual(removed.ok, true);
  assert.strictEqual(removed.deleted, true);
  const mutations = authoritativeContext.requests.slice(requestStart).filter((request) => request.method === 'DELETE' || request.url.includes('/automations/instances/'));
  assert.deepStrictEqual(mutations.map((request) => request.method), ['DELETE', 'POST']);
  assert(mutations.every((request) => request.url.includes('/org-acme')));
  assert.deepStrictEqual(mutations[1].data.endpoints, [{ id: 'group-finance', type: 'EndpointGroup' }]);
  assert.strictEqual(mutations[1].data.retry_minutes, '10080');
  assert.strictEqual((await authoritativeContext.db.all('SELECT * FROM action1_configuration_manager_scope_reservations WHERE organization_id = ?', ['org-acme'])).length, 0);
  assert.strictEqual((await actions['list-policies'](authoritativeContext)).policies.length, 0);
  const context = createFakeContext();

  const api4Context = createFakeContext({ api4: true });
  const api4Created = await actions['create-policy'](api4Context, { payload: { draft: createValidDraft() } });
  assert.strictEqual(api4Created.ok, true, api4Created.message);
  assert(api4Context.db.state.correlations[0].action1_automation_id);
  assert(api4Context.db.state.correlations[0].action1_automation_configuration_id, 'API 4 initial creation must persist configuration ID');
  assert(api4Context.db.state.correlations[0].action1_automation_action_id);
  const api4MultiContext = createFakeContext({ api4: true });
  const api4MultiDraft = createValidDraft();
  api4MultiDraft.selectedControls = [...api4MultiDraft.selectedControls, differentFamilyControl(api4MultiDraft)];
  const api4MultiCreated = await actions['create-policy'](api4MultiContext, { payload: { draft: api4MultiDraft } });
  const api4ConfigurationIds = api4MultiContext.db.state.correlations.map((row) => row.action1_automation_configuration_id);
  assert.strictEqual(api4MultiCreated.ok, true, api4MultiCreated.message);
  assert.strictEqual(new Set(api4ConfigurationIds).size, 2, 'Each API 4 automation must retain its own configuration ID');
  const api4EditDraft = { ...api4Created.policy, mode: 'edit', enabled: true, selectedControls: api4Created.policy.selectedControls.map((control) => ({ ...control, parameters: changedParameters(control) })) };
  const api4Edit = await actions['save-policy'](api4Context, { payload: { draft: api4EditDraft } });
  assert.strictEqual(api4Edit.ok, true, api4Edit.message);
  const api4Patch = api4Context.requests.find((request) => request.method === 'PATCH' && request.url.includes('/automations/schedules/'));
  assert(api4Patch);
  assert.strictEqual(api4Patch.data.configuration.id, api4Context.db.state.correlations[0].action1_automation_configuration_id);
  api4Context.db.state.correlations[0].action1_automation_configuration_id = null;
  const recoveryRequestStart = api4Context.requests.length;
  const recoveredEdit = await actions['save-policy'](api4Context, { payload: { draft: { ...api4Edit.policy, mode: 'edit', enabled: true, baseName: `${api4Edit.policy.baseName} Recovery` } } });
  assert.strictEqual(recoveredEdit.ok, true, `${recoveredEdit.message} ${JSON.stringify(recoveredEdit.details)}`);
  const recoveryRequests = api4Context.requests.slice(recoveryRequestStart);
  assert(recoveryRequests.some((request) => request.method === 'GET' && request.url.includes('/automations/schedules/')));
  const recoveredPatch = recoveryRequests.find((request) => request.method === 'PATCH' && request.url.includes('/automations/schedules/'));
  assert(recoveredPatch);
  assert.strictEqual(recoveredPatch.data.configuration.id, 'recovered-configuration-id');
  assert.strictEqual(api4Context.db.state.correlations[0].action1_automation_configuration_id, 'recovered-configuration-id');

  const invalidRecoveryContext = createFakeContext({ api4: true, invalidRecovery: true });
  const invalidCreated = await actions['create-policy'](invalidRecoveryContext, { payload: { draft: createValidDraft() } });
  invalidRecoveryContext.db.state.correlations[0].action1_automation_configuration_id = null;
  const invalidEdit = await actions['save-policy'](invalidRecoveryContext, { payload: { draft: { ...invalidCreated.policy, mode: 'edit', enabled: true, baseName: `${invalidCreated.policy.baseName} Invalid Recovery` } } });
  assert.strictEqual(invalidEdit.ok, false);
  assert.strictEqual(invalidRecoveryContext.requests.some((request) => request.method === 'PATCH' && request.url.includes('/automations/schedules/')), false);

  const saveResult = await actions['save-policy'](context, { payload: { draft: createValidDraft() } });
  assert.strictEqual(saveResult.ok, true);
  assert.strictEqual(saveResult.policy.policyId, 'POL-000001');

  const listResult = await actions['list-policies'](context, {});
  assert.strictEqual(listResult.ok, true);
  assert.strictEqual(listResult.policies.length, 1);

  const getResult = await actions['get-policy'](context, { payload: { policyId: 'POL-000001' } });
  assert.strictEqual(getResult.ok, true);
  assert.strictEqual(getResult.policy.displayName, 'Workstation Security - Finance Workstations');

  const toggleResult = await actions['set-policy-enabled'](context, { payload: { policyId: 'POL-000001', enabled: false } });
  assert.strictEqual(toggleResult.ok, true);
  assert.strictEqual(toggleResult.policy.enabled, false);
  assert.strictEqual(context.requests.filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/')).length, 0, 'Disable action must not clean selected Control state');

  const deleteResult = await actions['delete-policy'](context, { payload: { policyId: 'POL-000001' } });
  assert.strictEqual(deleteResult.ok, true);
  assert.strictEqual(deleteResult.deleted, true);
  const cleanupRequests = context.requests.filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/org-acme'));
  assert.strictEqual(cleanupRequests.length, 1, 'Delete should create exactly one cleanup instance');
  assert.strictEqual(cleanupRequests[0].data.retry_minutes, '10080');
  assert.strictEqual(cleanupRequests[0].data.settings, undefined, 'cleanup instance must not be scheduled');
  assert.deepStrictEqual(Object.keys(cleanupRequests[0].data.actions[0].params).sort(), [
    'condition_script_language',
    'condition_script_text',
    'display_summary',
    'run_script_language',
    'run_script_params',
    'run_script_text'
  ]);
  assert.strictEqual(cleanupRequests[0].data.actions[0].params.condition_script_text, '');
  assert.strictEqual(cleanupRequests[0].data.actions[0].params.condition_script_language, 'PowerShell');
  assert.strictEqual(cleanupRequests[0].data.actions[0].params.run_script_language, 'PowerShell');

  const validationFailure = await actions['save-policy'](context, { payload: { draft: { ...createValidDraft(), organizationId: '' } } });
  assert.strictEqual(validationFailure.ok, false);
  assert(/organization is required/i.test(validationFailure.message));

  const multiContext = createFakeContext();
  const multiDraft = createValidDraft();
  multiDraft.baseName = 'Multi Family Policy';
  multiDraft.selectedControls = [...multiDraft.selectedControls, differentFamilyControl(multiDraft)];
  const multiResult = await actions['save-policy'](multiContext, { payload: { draft: multiDraft } });
  assert.strictEqual(multiResult.ok, true);
  assert.strictEqual(multiResult.policy.enabled, true);
  assert.strictEqual(multiResult.policy.action1Automations.length, 2, 'initial apply should persist one correlation per selected family');
  assert(multiResult.policy.action1Automations.every((automation) => automation.action1AutomationActionId), 'initial apply must persist every Action1 action ID');
  const { formatPolicyDetails } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyViewModel.js')).href);
  const { loadReleasedControlCatalog } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js')).href);
  const projected = formatPolicyDetails(multiResult.policy, loadReleasedControlCatalog({ packId: activePack.packId, packVersion: activePack.packVersion, catalog: activePack.catalog, baselines: activePack.baselinesArtifact.baselines }));
  assert.strictEqual(projected.controlFamilyGroups.length, 2, 'hydrated family correlations should project one group per selected family');
  assert(projected.controlFamilyGroups.every((group) => group.automationLink?.automationId && group.automationLink?.action1Url), 'hydrated correlations should expose real Action1 ids and self links');

  const progressContext = createFakeContext();
  const progressLogs = [];
  const operationId = '11111111-2222-4333-8444-555555555555';
  const progressDraft = { ...multiDraft, baseName: 'Progress Policy' };
  const progressCreate = await actions['create-policy'](progressContext, {
    payload: { draft: progressDraft, progressOperationId: operationId },
    run: { async appendLog(message) {
      progressLogs.push({ message, correlations: progressContext.db.state.correlations.length });
    } }
  });
  assert.strictEqual(progressCreate.ok, true);
  const createCheckpoints = progressLogs.map(({ message }) => parseProgressCheckpoint(message)).filter(Boolean);
  assert.deepStrictEqual(createCheckpoints.map(({ operation, completed, total }) => [operation, completed, total]), [
    ['create', 0, 2], ['create', 1, 2], ['create', 2, 2]
  ], 'Create denominator must come from backend definitions and advance after each persisted correlation');
  assert.deepStrictEqual(progressLogs.map(({ correlations }) => correlations), [0, 1, 2], 'Create checkpoints must follow correlation persistence');
  assert(createCheckpoints.every((checkpoint) => checkpoint.operationId === operationId));
  assert(createCheckpoints.every((checkpoint) => !Object.keys(checkpoint).some((key) => /policy|endpoint|automation.?id|secret|token/i.test(key))));

  const failingProgressContext = createFakeContext({ failAutomationAt: 2 });
  const failedProgressLogs = [];
  const failedProgress = await actions['create-policy'](failingProgressContext, {
    payload: { draft: progressDraft, progressOperationId: operationId },
    run: { async appendLog(message) { failedProgressLogs.push(message); } }
  });
  assert.strictEqual(failedProgress.ok, false, 'Existing Create failure result must remain unchanged');
  assert.deepStrictEqual(failedProgressLogs.map(parseProgressCheckpoint).filter(Boolean).map(({ completed }) => completed), [0, 1], 'A failed Automation must not increment completed');

  const deleteProgressContext = createFakeContext();
  const deleteProgressInitial = await actions['create-policy'](deleteProgressContext, { payload: { draft: progressDraft } });
  deleteProgressContext.db.state.correlations.push({ ...deleteProgressContext.db.state.correlations[0], policy_id: deleteProgressInitial.policy.policyId, automation_group_id: 'inactive-family', active: 0 });
  deleteProgressContext.db.state.correlations.push({ ...deleteProgressContext.db.state.correlations[0], policy_id: 'OTHER-POLICY', automation_group_id: 'other-family', active: 1 });
  let absentDeleteHandled = false;
  const deleteProgressLogs = [];
  const deleteProgressAction = require(path.join(__dirname, '..', 'policyActions.js'));
  const deleteProgressResult = await deleteProgressAction.deletePolicyAction({
    ...deleteProgressContext,
    async http(options) {
      if (options.method === 'DELETE' && !absentDeleteHandled) {
        absentDeleteHandled = true;
        const automationId = decodeURIComponent(options.url.split('/').pop());
        return { status: 400, data: { message: `Automation with id=${automationId} does not exists` }, headers: { 'content-type': 'application/json' } };
      }
      return deleteProgressContext.http(options);
    }
  }, {
    payload: { policyId: deleteProgressInitial.policy.policyId, progressOperationId: operationId },
    run: { async appendLog(message) {
      deleteProgressLogs.push({ message, inactive: deleteProgressContext.db.state.correlations.filter((entry) => entry.policy_id === deleteProgressInitial.policy.policyId && entry.active === 0).length });
    } }
  });
  assert.strictEqual(deleteProgressResult.ok, true, `Already-absent Automations remain successfully processed: ${deleteProgressResult.message}`);
  assert.deepStrictEqual(deleteProgressLogs.map(({ message }) => parseProgressCheckpoint(message)).filter(Boolean).map(({ operation, completed, total }) => [operation, completed, total]), [
    ['delete', 0, 2], ['delete', 1, 2], ['delete', 2, 2]
  ], 'Delete total must include active owned correlations only, with absent remotes counted after successful inactive marking');
  assert.deepStrictEqual(deleteProgressLogs.map((entry) => entry.inactive), [1, 2, 3], 'Delete checkpoints must follow successful remote-delete handling and correlation inactivation; the preexisting inactive correlation remains excluded');

  const editDraft = {
    ...multiResult.policy,
    mode: 'edit',
    enabled: true,
    selectedControls: multiResult.policy.selectedControls.map((control, index) => index === 0 ? { ...control, parameters: changedParameters(control) } : control)
  };
  const editResult = await actions['save-policy'](multiContext, { payload: { draft: editDraft } });
  assert.strictEqual(editResult.ok, true, editResult.message);
  assert.strictEqual(editResult.policy.enabled, true);
  assert.strictEqual(multiContext.requests.filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/')).length, 0, 'Unchanged selected Controls must not create cleanup');
  const firstPatch = multiContext.requests.find((request) => request.method === 'PATCH' && request.url.includes('/automations/schedules/'));
  assert(firstPatch, 'Policy edit must PATCH the existing scheduled Automation');
  assert.strictEqual(firstPatch.data.actions.length, 1);
  const patchedAutomationId = decodeURIComponent(firstPatch.url.split('/').pop());
  assert.strictEqual(firstPatch.data.actions[0].id, `Run_PowerShell_${patchedAutomationId.replace('auto-', '')}`);

  const removeControlDraft = {
    ...editResult.policy,
    mode: 'edit',
    enabled: true,
    selectedControls: [editResult.policy.selectedControls[0]]
  };
  const editRemoveResult = await actions['save-policy'](multiContext, { payload: { draft: removeControlDraft } });
  assert.strictEqual(editRemoveResult.ok, true, editRemoveResult.message);
  const enabledCleanupRequests = multiContext.requests.filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/org-acme'));
  assert.strictEqual(enabledCleanupRequests.length, 1, 'Enabled deselection should create one cleanup instance');
  assert.strictEqual(enabledCleanupRequests[0].data.retry_minutes, '10080');
  const lastEnabledMutationIndex = Math.max(...multiContext.requests
    .map((request, index) => ({ request, index }))
    .filter(({ request }) => request.method === 'PATCH' || request.method === 'DELETE')
    .map(({ index }) => index));
  assert(multiContext.requests.indexOf(enabledCleanupRequests[0]) > lastEnabledMutationIndex, 'Enabled cleanup must be submitted after lifecycle mutations');

  const disabledContext = createFakeContext();
  const disabledInitial = await actions['save-policy'](disabledContext, { payload: { draft: multiDraft } });
  assert.strictEqual(disabledInitial.ok, true, disabledInitial.message);
  const disabled = await actions['set-policy-enabled'](disabledContext, { payload: { policyId: disabledInitial.policy.policyId, enabled: false } });
  assert.strictEqual(disabled.ok, true, disabled.message);
  assert.strictEqual(disabled.policy.enabled, false);
  const disabledEditRequestStart = disabledContext.requests.length;
  const disabledEditDraft = {
    ...disabled.policy,
    mode: 'edit',
    enabled: false,
    selectedControls: [disabled.policy.selectedControls[0]]
  };
  const disabledEdit = await actions['save-policy'](disabledContext, { payload: { draft: disabledEditDraft } });
  assert.strictEqual(disabledEdit.ok, true, disabledEdit.message);
  const disabledEditRequests = disabledContext.requests.slice(disabledEditRequestStart);
  assert.strictEqual(disabledEditRequests.filter((request) => request.method === 'PATCH' || request.method === 'DELETE').length, 0, 'Disabled Edit must not mutate regular automations');
  assert.strictEqual(disabledEditRequests.filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/org-acme')).length, 1, 'Disabled deselection should create one cleanup instance');
  const disabledCleanupRequest = disabledEditRequests.find((request) => request.method === 'POST' && request.url.includes('/automations/instances/org-acme'));
  assert.strictEqual(disabledCleanupRequest.data.retry_minutes, '10080');
  assert.strictEqual(disabledCleanupRequest.data.settings, undefined);
  assert.strictEqual(disabledCleanupRequest.data.actions[0].params.run_script_language, 'PowerShell');
  const unchangedDisabledRequestStart = disabledContext.requests.length;
  const unchangedDisabledEdit = await actions['save-policy'](disabledContext, {
    payload: { draft: { ...disabledEdit.policy, mode: 'edit', enabled: false } }
  });
  assert.strictEqual(unchangedDisabledEdit.ok, true, unchangedDisabledEdit.message);
  assert.strictEqual(disabledContext.requests.slice(unchangedDisabledRequestStart)
    .filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/')).length, 0);

  const failedCleanupContext = createFakeContext({
    instanceResponse: { status: 500, data: { message: 'cleanup rejected' }, headers: {} }
  });
  const failedInitial = await actions['save-policy'](failedCleanupContext, { payload: { draft: multiDraft } });
  const failedEdit = await actions['save-policy'](failedCleanupContext, {
    payload: { draft: { ...failedInitial.policy, mode: 'edit', selectedControls: [failedInitial.policy.selectedControls[0]] } }
  });
  assert.strictEqual(failedEdit.ok, false, 'Definitive cleanup failure must not report clean success');

  const ambiguousError = Object.assign(new Error('socket timeout after POST'), { code: 'ETIMEDOUT' });
  const ambiguousCleanupContext = createFakeContext({ instanceError: ambiguousError });
  const ambiguousInitial = await actions['save-policy'](ambiguousCleanupContext, { payload: { draft: multiDraft } });
  const ambiguousEdit = await actions['save-policy'](ambiguousCleanupContext, {
    payload: { draft: { ...ambiguousInitial.policy, mode: 'edit', selectedControls: [ambiguousInitial.policy.selectedControls[0]] } }
  });
  assert.strictEqual(ambiguousEdit.ok, false, 'Ambiguous cleanup outcome must not report clean success');
  assert.strictEqual(ambiguousCleanupContext.requests.filter((request) => request.method === 'POST' && request.url.includes('/automations/instances/')).length, 1, 'Ambiguous cleanup POST must not be blindly retried');
  const enabled = await actions['set-policy-enabled'](disabledContext, { payload: { policyId: disabledInitial.policy.policyId, enabled: true } });
  assert.strictEqual(enabled.ok, true, enabled.message);
  assert.strictEqual(enabled.policy.enabled, true);
  });
}

function parseProgressCheckpoint(message) {
  const match = String(message).match(/^A1CM_PROGRESS_V1 (\{.*\})$/);
  return match ? JSON.parse(match[1]) : null;
}

try {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
