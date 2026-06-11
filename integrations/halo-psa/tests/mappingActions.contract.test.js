const assert = require('assert');

const originalFetch = global.fetch;

function createMappingDbContext(initialRows = []) {
  const state = {
    rows: initialRows.map((row, index) => ({
      id: row.id ?? index + 1,
      action1_org_id: row.action1_org_id,
      action1_org_name: row.action1_org_name,
      halo_client_id: row.halo_client_id,
      halo_client_name: row.halo_client_name,
      enabled: row.enabled ?? 1,
      created_at: row.created_at || '2026-06-10T00:00:00Z',
      updated_at: row.updated_at || '2026-06-10T00:00:00Z'
    })),
    nextId: initialRows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1
  };

  function findById(id) {
    return state.rows.find((row) => row.id === Number(id)) || null;
  }

  function findByAction1OrgId(action1OrgId) {
    return state.rows.find((row) => row.action1_org_id === String(action1OrgId)) || null;
  }

  function findByHaloClientId(haloClientId) {
    return state.rows.find((row) => row.halo_client_id === String(haloClientId)) || null;
  }

  return {
    state,
    db: {
      async all(sql) {
        if (sql.includes('FROM halo_psa_org_client_mappings')) {
          return state.rows
            .slice()
            .sort((a, b) => a.action1_org_name.localeCompare(b.action1_org_name) || a.id - b.id);
        }
        throw new Error(`Unexpected all() SQL: ${sql}`);
      },
      async get(sql, params = []) {
        if (sql.includes('WHERE id = ?')) {
          return findById(params[0]);
        }
        if (sql.includes('WHERE action1_org_id = ?')) {
          return findByAction1OrgId(params[0]);
        }
        if (sql.includes('WHERE halo_client_id = ?')) {
          return findByHaloClientId(params[0]);
        }
        throw new Error(`Unexpected get() SQL: ${sql}`);
      },
      async run(sql, params = []) {
        if (sql.startsWith('INSERT INTO halo_psa_org_client_mappings')) {
          state.rows.push({
            id: state.nextId++,
            action1_org_id: params[0],
            action1_org_name: params[1],
            halo_client_id: params[2],
            halo_client_name: params[3],
            enabled: Number(params[4]),
            created_at: '2026-06-10T00:00:00Z',
            updated_at: '2026-06-10T00:00:00Z'
          });
          return;
        }
        if (sql.startsWith('UPDATE halo_psa_org_client_mappings')) {
          const row = findById(params[5]);
          if (row) {
            row.action1_org_id = params[0];
            row.action1_org_name = params[1];
            row.halo_client_id = params[2];
            row.halo_client_name = params[3];
            row.enabled = Number(params[4]);
            row.updated_at = '2026-06-10T01:00:00Z';
          }
          return;
        }
        if (sql.startsWith('DELETE FROM halo_psa_org_client_mappings')) {
          state.rows = state.rows.filter((row) => row.id !== Number(params[0]));
          return;
        }
        throw new Error(`Unexpected run() SQL: ${sql}`);
      }
    }
  };
}

function createSettingsContext(stored = {}) {
  return {
    values: { ...stored },
    async get(key) {
      return this.values[key] || '';
    }
  };
}

async function withMockedFetch(mock, worker) {
  global.fetch = mock;
  try {
    await worker();
  } finally {
    global.fetch = originalFetch;
  }
}

async function loadFreshActionsModule() {
  const actionsPath = require.resolve('../actions');
  const mappingActionsPath = require.resolve('../mappingActions');
  const mappingStorePath = require.resolve('../mappingStore');
  const haloApiPath = require.resolve('../haloApi');
  delete require.cache[actionsPath];
  delete require.cache[mappingActionsPath];
  delete require.cache[mappingStorePath];
  delete require.cache[haloApiPath];
  return require('../actions').actions;
}

async function testListReturnsRowsSafely() {
  const { db } = createMappingDbContext([
    {
      id: 4,
      action1_org_id: 'org-2',
      action1_org_name: 'Beta Org',
      halo_client_id: 'client-2',
      halo_client_name: 'Beta Client',
      enabled: 0
    },
    {
      id: 3,
      action1_org_id: 'org-1',
      action1_org_name: 'Alpha Org',
      halo_client_id: 'client-1',
      halo_client_name: 'Alpha Client',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();
  const result = await actions['list-halo-org-client-mappings']({ db }, {});

  assert.strictEqual(result.ok, true, 'list mapping action should succeed');
  assert.strictEqual(result.mappings.length, 2, 'list mapping action should return rows');
  assert.strictEqual(result.mappings[0].action1OrgName, 'Alpha Org', 'list mapping action should order rows safely');
  assert.strictEqual(result.mappings[1].enabled, false, 'enabled flag should be normalized to boolean');
}

async function testSavePersistsRowsThroughContextDbWithoutExternalCalls() {
  const { db, state } = createMappingDbContext();
  let fetchCalls = 0;

  await withMockedFetch(async () => {
    fetchCalls += 1;
    throw new Error('mapping save should not call fetch');
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['save-halo-org-client-mapping']({ db }, {
      payload: {
        action1OrgId: 'org-10',
        action1OrgName: 'Northwind',
        haloClientId: 'client-9',
        haloClientName: 'Northwind Client',
        enabled: true
      }
    });

    assert.strictEqual(result.ok, true, 'save mapping action should succeed');
    assert.strictEqual(state.rows.length, 1, 'save mapping action should persist a row');
    assert.strictEqual(result.mapping.action1OrgId, 'org-10', 'saved row should be normalized');
    assert.strictEqual(fetchCalls, 0, 'mapping save should not perform external calls');
  });
}

async function testDuplicateCollisionFailsSafely() {
  const { db } = createMappingDbContext([
    {
      id: 1,
      action1_org_id: 'org-1',
      action1_org_name: 'Alpha Org',
      halo_client_id: 'client-1',
      halo_client_name: 'Alpha Client',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();

  const duplicateOrg = await actions['save-halo-org-client-mapping']({ db }, {
    payload: {
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha Org',
      haloClientId: 'client-2',
      haloClientName: 'Second Client',
      enabled: true
    }
  });
  assert.strictEqual(duplicateOrg.ok, false, 'duplicate Action1 org should fail safely');
  assert(duplicateOrg.message.includes('already mapped'), 'duplicate Action1 org should return actionable error');

  const duplicateClient = await actions['save-halo-org-client-mapping']({ db }, {
    payload: {
      action1OrgId: 'org-2',
      action1OrgName: 'Beta Org',
      haloClientId: 'client-1',
      haloClientName: 'Alpha Client',
      enabled: true
    }
  });
  assert.strictEqual(duplicateClient.ok, false, 'duplicate Halo client should fail safely');
  assert(duplicateClient.message.includes('already mapped'), 'duplicate Halo client should return actionable error');
}

async function testDeleteBehavesDeterministically() {
  const { db, state } = createMappingDbContext([
    {
      id: 5,
      action1_org_id: 'org-9',
      action1_org_name: 'Delete Me',
      halo_client_id: 'client-9',
      halo_client_name: 'Delete Client',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();

  const deleted = await actions['delete-halo-org-client-mapping']({ db }, { payload: { id: 5 } });
  assert.strictEqual(deleted.ok, true, 'delete mapping action should succeed when row exists');
  assert.strictEqual(deleted.deleted, true, 'delete mapping action should report deleted rows');
  assert.strictEqual(state.rows.length, 0, 'delete mapping action should remove the row');

  const deletedAgain = await actions['delete-halo-org-client-mapping']({ db }, { payload: { id: 5 } });
  assert.strictEqual(deletedAgain.ok, true, 'delete mapping action should stay deterministic when row is missing');
  assert.strictEqual(deletedAgain.deleted, false, 'delete mapping action should report already-absent rows');
}

async function testHaloClientDiscoveryIsReadOnlyAndSanitized() {
  let fetchCalls = [];
  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }
    if (String(url).includes('/api/Client?$top=200')) {
      return {
        ok: true,
        json: async () => ({ clients: [{ id: '17', name: 'Acme Ltd' }] })
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-halo-mapping-options']({
      settings: createSettingsContext({
        HaloClientSecret: 'stored-secret-value'
      })
    }, {
      settings: {
        HaloResourceServer: 'https://halo.example.com',
        HaloAuthorisationServer: 'https://halo.example.com/auth',
        HaloClientId: 'client-id-123',
        _secretModes: {
          HaloClientSecret: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'Halo client discovery should succeed');
    assert.deepStrictEqual(result.haloClients[0], { id: '17', name: 'Acme Ltd' }, 'Halo client discovery should normalize client rows');
    assert(!fetchCalls.some((call) => call.url.includes('/Tickets')), 'Halo client discovery must not call Halo ticket write endpoints');
  });

  await withMockedFetch(async (url) => {
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }
    if (String(url).includes('/api/Client?$top=200')) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'bearer halo-token client_secret stored-secret-value' })
      };
    }
    return {
      ok: true,
      json: async () => ({})
    };
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-halo-mapping-options']({
      settings: createSettingsContext()
    }, {
      settings: {
        HaloResourceServer: 'https://halo.example.com',
        HaloAuthorisationServer: 'https://halo.example.com/auth',
        HaloClientId: 'client-id-123',
        HaloClientSecret: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, false, 'failed Halo client discovery should fail safely');
    assert(!result.message.includes('halo-token'), 'failed Halo client discovery should not leak tokens');
    assert(!result.message.includes('stored-secret-value'), 'failed Halo client discovery should not leak secrets');
  });
}

async function run() {
  await testListReturnsRowsSafely();
  await testSavePersistsRowsThroughContextDbWithoutExternalCalls();
  await testDuplicateCollisionFailsSafely();
  await testDeleteBehavesDeterministically();
  await testHaloClientDiscoveryIsReadOnlyAndSanitized();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
