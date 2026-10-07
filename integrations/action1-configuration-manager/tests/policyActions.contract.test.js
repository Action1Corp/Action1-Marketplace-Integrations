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
        const existing = state.policies.find((entry) => entry.policy_id === params[10]);
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
        existing.enabled = params[9];
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
          action1_automation_id: params[5], action1_automation_action_id: params[6], action1_automation_name: params[7], action1_automation_self: params[8],
          desired_definition_fingerprint: params[9], active: 1, last_applied_at: params[10], last_error: params[11],
          created_at: '2026-08-12T01:00:00.000Z', updated_at: '2026-08-12T01:00:00.000Z'
        });
        return { changes: 1 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_automation_correlations') && sql.includes('SET active = 0')) {
        const row = state.correlations.find((entry) => entry.policy_id === params[1] && entry.automation_group_id === params[2]);
        if (row) { row.active = 0; row.last_error = params[0]; }
        return { changes: row ? 1 : 0 };
      }

      if (sql.includes('UPDATE action1_configuration_manager_automation_correlations') && sql.includes('SET automation_group_version')) {
        const row = state.correlations.find((entry) => entry.policy_id === params[8] && entry.automation_group_id === params[9]);
        if (row) {
          row.automation_group_version = params[0];
          row.control_family_name_snapshot = params[1];
          row.action1_automation_action_id = params[4];
          row.action1_automation_name = params[5];
          row.action1_automation_self = params[6] || row.action1_automation_self;
          row.desired_definition_fingerprint = params[7];
          row.active = 1;
          row.last_applied_at = params[8];
          row.last_error = params[9];
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
    action1: { async getCredentials() { return { baseUrl: 'https://action1.test/api/3.0', apiKey: 'test-key', apiSecret: 'test-secret' }; } },
    async http(options) {
      requests.push(options);
      if (options.method === 'POST' && options.url.includes('/automations/schedules/') && contextOptions.failAutomationAt && ++creationAttempts === contextOptions.failAutomationAt) {
        const error = new Error('Scheduled Automation creation failed'); error.statusCode = 500; throw error;
      }
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      if (options.url.includes('/automations/instances/')) {
        if (contextOptions.instanceError) throw contextOptions.instanceError;
        if (contextOptions.instanceResponse) return contextOptions.instanceResponse;
      }
      if (options.method === 'GET' && /\/automations\/schedules\/[^/]+\/[^/]+$/.test(options.url)) {
        const automationId = decodeURIComponent(options.url.split('/').pop());
        return { status: 200, data: { id: automationId, self: `https://action1.test/api/3.0/automations/schedules/org-acme/${automationId}`, name: 'A1CM - Existing automation' }, headers: {} };
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
