const assert = require('assert');
const fs = require('fs');
const path = require('path');

function createFakeDb() {
  const state = {
    policies: [],
    controls: [],
    reservations: [],
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

      throw new Error(`Unhandled SQL in fake db.all: ${sql}`);
    }
  };
}

function createFakeContext() {
  return {
    db: createFakeDb(),
    logger: {
      info() {},
      warn() {},
      error() {}
    }
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
    selectedControls: [
      {
        controlId: 'identity.password.minimum-length',
        controlVersion: '0.1.0',
        automationGroupId: 'identity.password-policy',
        automationGroupVersion: '0.1.0',
        parameters: { minimumLength: 14 }
      }
    ]
  };
}

async function run() {
  const manifest = require(path.join(__dirname, '..', 'manifest.json'));
  const actionIds = manifest.actions.map((action) => action.id);

  assert(actionIds.includes('list-policies'));
  assert(actionIds.includes('save-policy'));
  assert(manifest.actions.filter((action) => action.history === false).length >= 5);

  const source = fs.readFileSync(path.join(__dirname, '..', 'policyActions.js'), 'utf8');
  assert.strictEqual(source.includes('context.action1.getCredentials'), false);
  assert.strictEqual(source.includes('run_script_text'), false);
  assert.strictEqual(source.includes('request.run'), false);

  const actions = require(path.join(__dirname, '..', 'actions.js')).actions;
  const context = createFakeContext();

  const saveResult = await actions['save-policy'](context, { payload: { draft: createValidDraft() } });
  assert.strictEqual(saveResult.ok, true);
  assert.strictEqual(saveResult.policy.policyId, 'POL-000001');

  const listResult = await actions['list-policies'](context, {});
  assert.strictEqual(listResult.ok, true);
  assert.strictEqual(listResult.policies.length, 1);

  const getResult = await actions['get-policy'](context, { payload: { policyId: 'POL-000001' } });
  assert.strictEqual(getResult.ok, true);
  assert.strictEqual(getResult.policy.displayName, 'Workstation Security — Finance Workstations');

  const toggleResult = await actions['set-policy-enabled'](context, { payload: { policyId: 'POL-000001', enabled: false } });
  assert.strictEqual(toggleResult.ok, true);
  assert.strictEqual(toggleResult.policy.enabled, false);

  const deleteResult = await actions['delete-policy'](context, { payload: { policyId: 'POL-000001' } });
  assert.strictEqual(deleteResult.ok, true);
  assert.strictEqual(deleteResult.deleted, true);

  const validationFailure = await actions['save-policy'](context, { payload: { draft: { ...createValidDraft(), organizationId: '' } } });
  assert.strictEqual(validationFailure.ok, false);
  assert(/organization is required/i.test(validationFailure.message));
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
