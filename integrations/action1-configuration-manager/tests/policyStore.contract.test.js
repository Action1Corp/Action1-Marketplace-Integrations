const assert = require('assert');
const path = require('path');

function createFakeDb(options = {}) {
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

  function normalizeBoolean(value) {
    return value ? 1 : 0;
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
      enabled: normalizeBoolean(params[16]),
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
        const policyId = params[10];
        const existing = state.policies.find((entry) => entry.policy_id === policyId);
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
        existing.enabled = normalizeBoolean(params[9]);
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

        existing.enabled = normalizeBoolean(params[0]);
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
          parameters_json: params[5],
          created_at: '2026-08-12T00:00:00.000Z',
          updated_at: '2026-08-12T00:00:00.000Z'
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
          endpoint_group_id: params[3],
          created_at: '2026-08-12T00:00:00.000Z'
        });
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO action1_configuration_manager_automation_correlations')) {
        state.correlations.push({
          policy_id: params[0], automation_group_id: params[1], automation_group_version: params[2],
          control_family_name_snapshot: params[3], action1_organization_id: params[4],
          action1_automation_id: params[5], action1_automation_name: params[6], action1_automation_self: params[7],
          desired_definition_fingerprint: params[8], last_applied_at: params[9], last_error: params[10],
          created_at: '2026-08-12T01:00:00.000Z', updated_at: '2026-08-12T01:00:00.000Z'
        });
        return { changes: 1 };
      }

      if (sql.includes('DELETE FROM action1_configuration_manager_automation_correlations')) {
        state.correlations = state.correlations.filter((entry) => entry.policy_id !== params[0]);
        return { changes: 1 };
      }

      if (sql.includes('DELETE FROM action1_configuration_manager_policies')) {
        const before = state.policies.length;
        state.policies = state.policies.filter((entry) => entry.policy_id !== params[0]);
        return { changes: before === state.policies.length ? 0 : 1 };
      }

      throw new Error(`Unhandled SQL in fake db.run: ${sql}`);
    },

    async get(sql, params = []) {
      if (options.throwOnSqliteSequence && sql.includes('sqlite_sequence')) {
        throw new Error('relation "sqlite_sequence" does not exist');
      }

      if (sql.includes('SELECT MAX(policy_sequence) AS max_sequence')) {
        const sequences = state.policies.map((entry) => entry.policy_sequence).filter((value) => Number(value) > 0);
        return { max_sequence: sequences.length ? Math.max(...sequences) : null };
      }

      if (sql.includes('SELECT seq AS last_sequence FROM sqlite_sequence WHERE name = ?')) {
        return state.lastPolicySequence ? { last_sequence: state.lastPolicySequence } : null;
      }

      if (sql.includes('FROM action1_configuration_manager_policies') && sql.includes('WHERE policy_id = ?')) {
        return clone(state.policies.find((entry) => entry.policy_id === params[0]) || null);
      }

      throw new Error(`Unhandled SQL in fake db.get: ${sql}`);
    },

    async all(sql, params = []) {
      if (sql.includes('FROM action1_configuration_manager_policies') && sql.includes('ORDER BY')) {
        return clone(
          [...state.policies].sort((left, right) => left.display_name.localeCompare(right.display_name))
        );
      }

      if (sql.includes('FROM action1_configuration_manager_policy_controls') && sql.includes('WHERE policy_id = ?')) {
        return clone(state.controls.filter((entry) => entry.policy_id === params[0]));
      }

      if (sql.includes('FROM action1_configuration_manager_scope_reservations') && sql.includes('WHERE organization_id = ?')) {
        return clone(state.reservations.filter((entry) => entry.organization_id === params[0]));
      }

      if (sql.includes('FROM action1_configuration_manager_automation_correlations') && sql.includes('WHERE policy_id = ?')) {
        return clone(state.correlations.filter((entry) => entry.policy_id === params[0]));
      }

      throw new Error(`Unhandled SQL in fake db.all: ${sql}`);
    },

    _state: state
  };
}

function createFakeContext(options = {}) {
  let automationNumber = 0;
  return {
    db: createFakeDb(options),
    action1: { async getCredentials() { return { baseUrl: 'https://action1.test/api/3.0', apiKey: 'test-key', apiSecret: 'test-secret' }; } },
    async http(options) {
      if (options.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token', expires_in: 3600 }, headers: {} };
      automationNumber += 1;
      return { status: 201, data: { id: `auto-${automationNumber}`, self: `https://action1.test/api/3.0/automations/schedules/org-action/auto-${automationNumber}`, name: `A1CM - Workstation Security - Finance - ${automationNumber}` }, headers: {} };
    },
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  };
}

function createValidInput(overrides = {}) {
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
    ],
    ...overrides
  };
}

async function run() {
  const { createDbPolicyStore } = require(path.join(__dirname, '..', 'policyStore.js'));
  const { savePolicyAction } = require(path.join(__dirname, '..', 'policyActions.js'));
  const context = createFakeContext();
  const store = createDbPolicyStore(context);

  const saved = await store.savePolicy(createValidInput());
  assert.strictEqual(saved.policyId, 'POL-000001');
  assert.strictEqual(saved.displayName, 'Workstation Security - Finance Workstations');
  assert.strictEqual(saved.selectedControls[0].parameters.minimumLength, 14);
  assert.deepStrictEqual(saved.action1Automations, []);

  const listed = await store.listPolicies();
  assert.strictEqual(listed.length, 1, 'listPolicies should return the saved policy');
  assert.strictEqual(listed[0].policyId, 'POL-000001', 'listPolicies should preserve stable policy ids');

  const actionContext = createFakeContext();
  const actionSaved = await savePolicyAction(actionContext, {
    payload: { draft: createValidInput({ organizationId: 'org-action', organizationName: 'Action Org', endpointGroupId: 'group-action', endpointGroupName: 'Action Group' }) }
  });
  assert.strictEqual(actionSaved.ok, true, 'save-policy should persist a valid complete draft');
  assert.deepStrictEqual(actionSaved.policy.selectedControls[0].parameters, { minimumLength: 14 });

  const beforeRejectedAction = JSON.stringify(actionContext.db._state);
  const rejectedAction = await savePolicyAction(actionContext, {
    payload: { draft: createValidInput({ organizationId: 'org-rejected', endpointGroupId: 'group-rejected', endpointGroupName: 'Rejected Group', selectedControls: [{ controlId: 'identity.password.minimum-length', controlVersion: '0.1.0', automationGroupId: 'identity.password-policy', automationGroupVersion: '0.1.0', parameters: { minimumLength: 999 } }] }) }
  });
  assert.strictEqual(rejectedAction.ok, false, 'save-policy should reject invalid catalog values');
  assert.strictEqual(JSON.stringify(actionContext.db._state), beforeRejectedAction, 'rejected save-policy must not mutate durable state');

  await assert.rejects(
    () => store.savePolicy(createValidInput({ baseName: 'Second Policy' })),
    /already reserved/i
  );

  const allEndpointsStore = createDbPolicyStore(createFakeContext());
  await allEndpointsStore.savePolicy(createValidInput({ scopeType: 'ALL_ENDPOINTS', endpointGroupId: '', endpointGroupName: '' }));
  await assert.rejects(
    () => allEndpointsStore.savePolicy(createValidInput({ baseName: 'Endpoint Group Policy' })),
    /all endpoints/i
  );

  const groupFirstStore = createDbPolicyStore(createFakeContext());
  await groupFirstStore.savePolicy(createValidInput());
  await assert.rejects(
    () => groupFirstStore.savePolicy(createValidInput({ baseName: 'All Endpoints Policy', scopeType: 'ALL_ENDPOINTS', endpointGroupId: '', endpointGroupName: '' })),
    /all endpoints/i
  );

  await assert.rejects(
    () => store.savePolicy(createValidInput({ organizationId: '' })),
    /Organization is required/
  );
  await assert.rejects(
    () => store.savePolicy(createValidInput({ controlPackVersion: '0.1.0' })),
    /released Control Pack/i
  );
  await assert.rejects(
    () => store.savePolicy(createValidInput({ selectedControls: [] })),
    /Select at least one Control/i
  );

  const updated = await store.savePolicy({
    ...saved,
    mode: 'edit',
    baseName: 'Workstation Security Updated',
    description: 'Updated description',
    policyMode: 'ASSESS_AND_REMEDIATE',
    selectedControls: [
      {
        controlId: 'identity.password.minimum-length',
        controlVersion: '0.1.0',
        automationGroupId: 'identity.password-policy',
        automationGroupVersion: '0.1.0',
        parameters: { minimumLength: 12 }
      }
    ]
  });
  assert.strictEqual(updated.baseName, 'Workstation Security Updated');
  assert.strictEqual(updated.policyMode, 'ASSESS_AND_REMEDIATE');
  assert.strictEqual(updated.selectedControls[0].parameters.minimumLength, 12);

  await assert.rejects(
    () => store.savePolicy({
      ...updated,
      mode: 'edit',
      endpointGroupId: 'group-hr',
      endpointGroupName: 'HR Workstations'
    }),
    /immutable/i
  );

  const disabled = await store.setPolicyEnabled('POL-000001', false);
  assert.strictEqual(disabled.enabled, false, 'setPolicyEnabled should persist the enabled flag');

  const availability = await store.getOrganizationTargetAvailability('org-acme');
  assert.strictEqual(availability.allEndpointsAvailable, false, 'group reservations should make all-endpoints unavailable');
  assert.strictEqual(
    availability.reservedPolicyIdByEndpointGroupId['group-finance'],
    'POL-000001',
    'group reservations should be returned by endpoint-group id'
  );

  const createAvailability = await store.getOrganizationTargetAvailability('org-acme', { excludePolicyId: 'POL-000001' });
  assert.strictEqual(
    createAvailability.allEndpointsAvailable,
    true,
    'excluding the current policy should allow edit-time availability calculations without releasing durable reservations'
  );
  assert.deepStrictEqual(
    createAvailability.reservedPolicyIdByEndpointGroupId,
    {},
    'excluding the current policy should remove its own reservation from the availability map'
  );

  const deletion = await store.deletePolicy('POL-000001');
  assert.strictEqual(deletion.deleted, true, 'deletePolicy should delete existing policies');
  assert.strictEqual(await store.getPolicy('POL-000001'), null, 'deleted policy should no longer load by id');

  const replacement = await store.savePolicy(createValidInput({ baseName: 'Replacement Policy' }));
  assert.strictEqual(replacement.policyId, 'POL-000002', 'policy sequence should remain monotonic after delete');

  const marketplaceLikeStore = createDbPolicyStore(createFakeContext({ throwOnSqliteSequence: true }));
  const postgresLikeSaved = await marketplaceLikeStore.savePolicy(createValidInput({ baseName: 'Postgres Save' }));
  assert.strictEqual(
    postgresLikeSaved.policyId,
    'POL-000001',
    'savePolicy should derive its stable policy id from the inserted row identity without querying sqlite_sequence'
  );
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
