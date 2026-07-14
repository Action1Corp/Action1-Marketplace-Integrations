const assert = require('assert');
const fs = require('fs');
const path = require('path');

const originalFetch = global.fetch;

function createMappingDbContext(initialRows = []) {
  const state = {
    rows: initialRows.map((row, index) => ({
      id: row.id ?? index + 1,
      action1_org_id: row.action1_org_id,
      action1_org_name: row.action1_org_name,
      created_at: row.created_at || '2026-07-10T00:00:00Z',
      updated_at: row.updated_at || '2026-07-10T00:00:00Z'
    })),
    nextId: initialRows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1
  };

  function findById(id) {
    return state.rows.find((row) => row.id === Number(id)) || null;
  }

  function findByAction1OrgId(action1OrgId) {
    return state.rows.find((row) => row.action1_org_id === String(action1OrgId)) || null;
  }

  return {
    state,
    db: {
      async all(sql) {
        if (sql.includes('FROM entra_id_org_mappings')) {
          assert(sql.includes('ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC'), 'mapping list SQL should use portable case-insensitive ordering');
          return state.rows
            .slice()
            .sort((a, b) => {
              const lowerCompare = a.action1_org_name.toLowerCase().localeCompare(b.action1_org_name.toLowerCase());
              if (lowerCompare !== 0) {
                return lowerCompare;
              }
              if (a.action1_org_name < b.action1_org_name) return -1;
              if (a.action1_org_name > b.action1_org_name) return 1;
              return a.id - b.id;
            });
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
        throw new Error(`Unexpected get() SQL: ${sql}`);
      },
      async run(sql, params = []) {
        if (sql.startsWith('INSERT INTO entra_id_org_mappings')) {
          state.rows.push({
            id: state.nextId++,
            action1_org_id: params[0],
            action1_org_name: params[1],
            created_at: '2026-07-10T00:00:00Z',
            updated_at: '2026-07-10T00:00:00Z'
          });
          return;
        }
        if (sql.startsWith('UPDATE entra_id_org_mappings')) {
          const row = findById(params[2]);
          if (row) {
            row.action1_org_id = params[0];
            row.action1_org_name = params[1];
            row.updated_at = '2026-07-10T01:00:00Z';
          }
          return;
        }
        if (sql.startsWith('DELETE FROM entra_id_org_mappings')) {
          state.rows = state.rows.filter((row) => row.id !== Number(params[0]));
          return;
        }
        throw new Error(`Unexpected run() SQL: ${sql}`);
      }
    }
  };
}

function createLoggerContext() {
  const warnings = [];
  return {
    warnings,
    logger: {
      warn(message) {
        warnings.push(String(message || ''));
      }
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
  const action1ApiPath = require.resolve('../action1Api');
  const mappingActionsPath = require.resolve('../mappingActions');
  const mappingStorePath = require.resolve('../mappingStore');
  delete require.cache[actionsPath];
  delete require.cache[action1ApiPath];
  delete require.cache[mappingActionsPath];
  delete require.cache[mappingStorePath];
  return require('../actions').actions;
}

async function testPortableOrderingSqlStaysOutOfSQLiteOnlyCollation() {
  const mappingStoreSource = fs.readFileSync(path.join(__dirname, '..', 'mappingStore.js'), 'utf8');
  assert(!mappingStoreSource.includes('COLLATE NOCASE'), 'mapping store should not use SQLite-only COLLATE NOCASE');
  assert(mappingStoreSource.includes('ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC'), 'mapping store should keep portable deterministic ordering');
}

async function testListReturnsRowsSafely() {
  const { db } = createMappingDbContext([
    { id: 4, action1_org_id: 'org-2', action1_org_name: 'beta org' },
    { id: 3, action1_org_id: 'org-1', action1_org_name: 'Alpha Org' },
    { id: 7, action1_org_id: 'org-3', action1_org_name: 'alpha org' }
  ]);
  const actions = await loadFreshActionsModule();
  const result = await actions['list-entra-org-mappings']({ db }, {});

  assert.strictEqual(result.ok, true, 'list mapping action should succeed');
  assert.strictEqual(result.mappings.length, 3, 'list mapping action should return rows');
  assert.strictEqual(result.mappings[0].action1OrgName, 'Alpha Org', 'list mapping action should order rows safely');
  assert.strictEqual(result.mappings[1].action1OrgName, 'alpha org', 'list mapping action should stay deterministic for case-insensitive matches');
}

async function testSavePersistsRowsThroughContextDbWithoutExternalCalls() {
  const { db, state } = createMappingDbContext();
  let fetchCalls = 0;

  await withMockedFetch(async () => {
    fetchCalls += 1;
    throw new Error('mapping save should not call fetch');
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['save-entra-org-mapping']({ db }, {
      payload: {
        action1OrgId: 'org-10',
        action1OrgName: 'Northwind'
      }
    });

    assert.strictEqual(result.ok, true, 'save mapping action should succeed');
    assert.strictEqual(state.rows.length, 1, 'save mapping action should persist a row');
    assert.strictEqual(result.mapping.action1OrgId, 'org-10', 'saved row should be normalized');
    assert.strictEqual(fetchCalls, 0, 'mapping save should not perform external calls');
  });
}

async function testDbUniquenessFailsSafely() {
  const { db } = createMappingDbContext([
    { id: 1, action1_org_id: 'org-1', action1_org_name: 'Alpha Org' }
  ]);
  const actions = await loadFreshActionsModule();

  const duplicateOrg = await actions['save-entra-org-mapping']({ db }, {
    payload: {
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha Org'
    }
  });
  assert.strictEqual(duplicateOrg.ok, false, 'duplicate Action1 org should fail safely');
  assert(duplicateOrg.message.includes('already mapped'), 'duplicate Action1 org should return actionable error');
}

async function testDeleteOnlyBehavesDeterministically() {
  const { db, state } = createMappingDbContext([
    { id: 5, action1_org_id: 'org-9', action1_org_name: 'Delete Me' }
  ]);
  const actions = await loadFreshActionsModule();

  const deleted = await actions['delete-entra-org-mapping']({ db }, { payload: { id: 5 } });
  assert.strictEqual(deleted.ok, true, 'delete mapping action should succeed when row exists');
  assert.strictEqual(deleted.deleted, true, 'delete mapping action should report deleted rows');
  assert.strictEqual(state.rows.length, 0, 'delete mapping action should remove the row');

  const deletedAgain = await actions['delete-entra-org-mapping']({ db }, { payload: { id: 5 } });
  assert.strictEqual(deletedAgain.ok, true, 'delete mapping action should stay deterministic when row is missing');
  assert.strictEqual(deletedAgain.deleted, false, 'delete mapping action should report already-absent rows');
}

async function testAction1OrganizationDiscoveryUsesMarketplaceCredentials() {
  let credentialsCalls = 0;
  const fetchCalls = [];

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).endsWith('/oauth2/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'action1-token', expires_in: 3600 })
      };
    }
    if (String(url).endsWith('/organizations')) {
      return {
        ok: true,
        json: async () => ({
          organizations: [
            { id: 'org-1', name: 'Alpha Org' },
            { org_id: 'org-2', org_name: 'Beta Org' }
          ]
        })
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-action1-mapping-options']({
      action1: {
        async getCredentials() {
          credentialsCalls += 1;
          return {
            apiKey: 'a1-client-id',
            apiSecret: 'a1-client-secret'
          };
        }
      },
      logger: { warn() {} }
    }, {});

    assert.strictEqual(result.ok, true, 'Action1 organization discovery should succeed');
    assert.strictEqual(credentialsCalls, 1, 'Action1 organization discovery should use Marketplace-owned credentials');
    assert.deepStrictEqual(result.action1Organizations, [
      { id: 'org-1', name: 'Alpha Org' },
      { id: 'org-2', name: 'Beta Org' }
    ], 'Action1 organization discovery should normalize organization rows');
    assert(fetchCalls.some((call) => call.url.endsWith('/oauth2/token')), 'Action1 organization discovery should request a token');
    assert(fetchCalls.some((call) => call.url.endsWith('/organizations')), 'Action1 organization discovery should fetch organizations');
  });
}

async function testAction1OrganizationDiscoveryFailsSafely() {
  {
    const logger = createLoggerContext();
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-action1-mapping-options']({
      action1: {
        async getCredentials() {
          return {
            apiKey: '',
            apiSecret: ''
          };
        }
      },
      logger: logger.logger
    }, {});

    assert.strictEqual(result.ok, false, 'missing Action1 credentials should fail safely');
    assert(result.message.includes('Action1 organization discovery failed.'), 'missing credentials should return a short Action1 UI message');
    assert.strictEqual(Array.isArray(result.action1Organizations), true, 'missing credentials should still return an organization array');
    assert.strictEqual(result.action1Organizations.length, 0, 'missing credentials should return no organizations');
    assert(result.diagnostics.operation === 'action1_org_discovery', 'missing credentials should include Action1 discovery diagnostics');
    assert(result.diagnostics.tokenAcquired === false, 'missing credentials should show token acquisition failed');
    assert(logger.warnings.some((entry) => entry.includes('"operation":"action1_org_discovery"')), 'missing credentials should log sanitized Action1 diagnostics');
  }

  {
    const logger = createLoggerContext();
    await withMockedFetch(async (url) => {
      if (String(url).endsWith('/oauth2/token')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: 'invalid_client',
            error_description: 'client_secret stored-secret-value'
          })
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }, async () => {
      const actions = await loadFreshActionsModule();
      const result = await actions['discover-action1-mapping-options']({
        action1: {
          async getCredentials() {
            return {
              apiKey: 'a1-client-id',
              apiSecret: 'stored-secret-value'
            };
          }
        },
        logger: logger.logger
      }, {});

      assert.strictEqual(result.ok, false, 'Action1 token failure should fail safely');
      assert(result.message.includes('Action1 organization discovery failed.'), 'Action1 token failure should return a short UI message');
      assert(result.diagnostics.tokenAcquired === false, 'Action1 token failure should report token acquisition failure');
      assert(result.diagnostics.response.status === 401, 'Action1 token failure should report the HTTP status');
      assert(!result.message.includes('stored-secret-value'), 'Action1 token failure should not leak secrets');
      assert(logger.warnings.some((entry) => entry.includes('"path":"/oauth2/token"')), 'Action1 token failure should log the token path');
      assert(!logger.warnings.some((entry) => entry.includes('stored-secret-value')), 'Action1 token failure logs should not leak secrets');
    });
  }
}

async function run() {
  await testPortableOrderingSqlStaysOutOfSQLiteOnlyCollation();
  await testListReturnsRowsSafely();
  await testSavePersistsRowsThroughContextDbWithoutExternalCalls();
  await testDbUniquenessFailsSafely();
  await testDeleteOnlyBehavesDeterministically();
  await testAction1OrganizationDiscoveryUsesMarketplaceCredentials();
  await testAction1OrganizationDiscoveryFailsSafely();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
