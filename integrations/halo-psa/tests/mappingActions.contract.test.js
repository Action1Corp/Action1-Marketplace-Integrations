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
          assert(sql.includes('ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC'), 'mapping list SQL should use portable case-insensitive ordering');
          return state.rows
            .slice()
            .sort((a, b) => {
              const lowerCompare = a.action1_org_name.toLowerCase().localeCompare(b.action1_org_name.toLowerCase());
              if (lowerCompare !== 0) {
                return lowerCompare;
              }
              if (a.action1_org_name < b.action1_org_name) {
                return -1;
              }
              if (a.action1_org_name > b.action1_org_name) {
                return 1;
              }
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
  const haloApiPath = require.resolve('../haloApi');
  delete require.cache[actionsPath];
  delete require.cache[action1ApiPath];
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
      action1_org_name: 'beta org',
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
    },
    {
      id: 7,
      action1_org_id: 'org-3',
      action1_org_name: 'alpha org',
      halo_client_id: 'client-3',
      halo_client_name: 'Alpha Secondary',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();
  const result = await actions['list-halo-org-client-mappings']({ db }, {});

  assert.strictEqual(result.ok, true, 'list mapping action should succeed');
  assert.strictEqual(result.mappings.length, 3, 'list mapping action should return rows');
  assert.strictEqual(result.mappings[0].action1OrgName, 'Alpha Org', 'list mapping action should order rows safely');
  assert.strictEqual(result.mappings[1].action1OrgName, 'alpha org', 'list mapping action should stay deterministic for case-insensitive matches');
  assert.strictEqual(result.mappings[2].enabled, false, 'enabled flag should be normalized to boolean');
}

async function testPortableOrderingSqlStaysOutOfSQLiteOnlyCollation() {
  const mappingStoreSource = fs.readFileSync(path.join(__dirname, '..', 'mappingStore.js'), 'utf8');
  assert(!mappingStoreSource.includes('COLLATE NOCASE'), 'mapping store should not use SQLite-only COLLATE NOCASE');
  assert(mappingStoreSource.includes('ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC'), 'mapping store should keep portable deterministic ordering');
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
        haloClientName: 'Northwind Client'
      }
    });

    assert.strictEqual(result.ok, true, 'save mapping action should succeed');
    assert.strictEqual(state.rows.length, 1, 'save mapping action should persist a row');
    assert.strictEqual(result.mapping.action1OrgId, 'org-10', 'saved row should be normalized');
    assert.strictEqual(result.mapping.enabled, true, 'save mapping action should default mappings to enabled for storage compatibility');
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

async function testAction1OrganizationDiscoveryUsesMarketplaceCredentials() {
  let credentialsCalls = 0;
  let fetchCalls = [];

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

  {
    const logger = createLoggerContext();
    await withMockedFetch(async (url) => {
      if (String(url).endsWith('/oauth2/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'action1-token', expires_in: 3600 })
        };
      }
      if (String(url).endsWith('/organizations')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: 'forbidden',
            message: 'bearer action1-token'
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
              apiSecret: 'a1-client-secret'
            };
          }
        },
        logger: logger.logger
      }, {});

      assert.strictEqual(result.ok, false, 'Action1 organization fetch failure should fail safely');
      assert(result.diagnostics.tokenAcquired === true, 'Action1 organization fetch failure should report token acquisition success');
      assert(result.diagnostics.response.status === 403, 'Action1 organization fetch failure should report the HTTP status');
      assert(result.diagnostics.request.path === '/organizations', 'Action1 organization fetch failure should report the organizations path');
      assert.strictEqual(result.diagnostics.request.query, '', 'Action1 organization fetch failure should report an empty query string');
      assert.strictEqual(result.diagnostics.response.contentType, '', 'Action1 organization fetch failure should leave content type blank when unavailable');
      assert(result.diagnostics.response.bodyExcerpt.includes('bearer [redacted]'), 'Action1 organization fetch failure should include a sanitized body excerpt');
      assert.strictEqual(result.diagnostics.response.bodyExcerpt.length <= 1000, true, 'Action1 organization fetch failure body excerpt should be truncated safely');
      assert(result.diagnostics.timestamp, 'Action1 organization fetch failure should include a timestamp');
      assert(!result.message.includes('action1-token'), 'Action1 organization fetch failure should not leak tokens');
      assert(logger.warnings.some((entry) => entry.includes('HaloPSA mapping discovery diagnostic')), 'Action1 organization fetch failure should log a searchable diagnostic message');
      assert(logger.warnings.some((entry) => entry.includes('"status":403')), 'Action1 organization fetch failure should log the HTTP status');
      assert(!logger.warnings.some((entry) => entry.includes('action1-token')), 'Action1 organization fetch failure logs should not leak tokens');
    });
  }
}

async function testHaloClientDiscoveryIsReadOnlyAndSanitized() {
  let fetchCalls = [];
  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'TokenTypeX' })
      };
    }
    if (String(url).endsWith('/api/Client')) {
      return {
        ok: true,
        json: async () => ({ clients: [{ id: '17', name: 'Acme Ltd' }] })
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const logger = createLoggerContext();
    const result = await actions['discover-halo-mapping-options']({
      settings: createSettingsContext({
        HaloPsaClientSecret: 'stored-secret-value'
      }),
      logger: logger.logger
    }, {
      settings: {
        HaloPsaResourceServer: 'https://halo.example.com',
        HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
        HaloPsaClientId: 'client-id-123',
        _secretModes: {
          HaloPsaClientSecret: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'Halo client discovery should succeed');
    assert.deepStrictEqual(result.haloClients[0], { id: '17', name: 'Acme Ltd' }, 'Halo client discovery should normalize client rows');
    const tokenCall = fetchCalls.find((call) => call.url.endsWith('/token'));
    assert(tokenCall, 'Halo client discovery should request a Halo token');
    assert(String(tokenCall.options?.body || '').includes('grant_type=client_credentials'), 'Halo token request should keep the client credentials grant');
    assert(String(tokenCall.options?.body || '').includes('scope=all'), 'Halo token request should match standalone scope=all behavior');
    const clientCall = fetchCalls.find((call) => call.url.endsWith('/api/Client'));
    assert(clientCall, 'Halo client discovery should call the standalone /Client endpoint');
    assert.strictEqual(clientCall.url.includes('?$top=200'), false, 'Halo client discovery should not append the Marketplace-only $top query');
    assert.strictEqual(clientCall.options?.headers?.Authorization, 'TokenTypeX halo-token', 'Halo client discovery should preserve the token type from the Halo token response');
    assert.strictEqual(clientCall.options?.headers?.Accept, 'application/json', 'Halo client discovery should request JSON responses');
    assert(!fetchCalls.some((call) => call.url.includes('/Tickets')), 'Halo client discovery must not call Halo ticket write endpoints');
    assert.strictEqual(logger.warnings.length, 0, 'successful Halo client discovery should not log warnings');
  });

  await withMockedFetch(async (url) => {
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }
    if (String(url).endsWith('/api/Client')) {
      return {
        ok: true,
        json: async () => ({ clients: [{ id: '18', name: 'Beta Ltd' }] })
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-halo-mapping-options']({
      settings: createSettingsContext()
    }, {
      settings: {
        HaloPsaResourceServer: 'https://halo.example.com/api',
        HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
        HaloPsaClientId: 'client-id-123',
        HaloPsaClientSecret: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, true, 'Halo client discovery should still succeed when the resource server already includes /api');
  });

  await withMockedFetch(async (url) => {
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }
    if (String(url).endsWith('/api/Client')) {
      return {
        ok: false,
        status: 403,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
          }
        },
        json: async () => ({
          error: 'forbidden',
          message: 'bearer halo-token client_secret stored-secret-value',
          detail: 'X'.repeat(1200)
        })
      };
    }
    return {
      ok: true,
      json: async () => ({})
    };
  }, async () => {
    const actions = await loadFreshActionsModule();
    const logger = createLoggerContext();
    const result = await actions['discover-halo-mapping-options']({
      settings: createSettingsContext(),
      logger: logger.logger
    }, {
      settings: {
        HaloPsaResourceServer: 'https://halo.example.com',
        HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
        HaloPsaClientId: 'client-id-123',
        HaloPsaClientSecret: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, false, 'failed Halo client discovery should fail safely');
    assert.strictEqual(result.message, 'Failed: HaloPSA client discovery failed. Check HaloPSA client-read access and retry.', 'failed Halo client discovery should return a short UI message');
      assert(result.diagnostics.operation === 'halo_client_discovery', 'failed Halo client discovery should include discovery diagnostics');
    assert.strictEqual(result.diagnostics.actionId, 'discover-halo-mapping-options', 'failed Halo client discovery should include the action id');
    assert(result.diagnostics.tokenAcquired === true, 'failed Halo client discovery should report token acquisition success');
    assert(result.diagnostics.request.path === '/Client', 'failed Halo client discovery should include the /Client path');
    assert.strictEqual(result.diagnostics.request.query, '', 'failed Halo client discovery should report the actual empty /Client query');
    assert.strictEqual(result.diagnostics.request.method, 'GET', 'failed Halo client discovery should include the request method');
    assert.strictEqual(result.diagnostics.resolvedResourceServer, 'https://halo.example.com/api', 'failed Halo client discovery should include the resolved Halo resource server');
    assert(result.diagnostics.response.status === 403, 'failed Halo client discovery should report the HTTP status');
    assert.strictEqual(result.diagnostics.response.contentType, 'application/json; charset=utf-8', 'failed Halo client discovery should report the response content type');
    assert.strictEqual(result.diagnostics.response.errorCode, 'forbidden', 'failed Halo client discovery should report the safe Halo error code');
    assert(result.diagnostics.response.errorMessage.includes('bearer [redacted]'), 'failed Halo client discovery should report the sanitized Halo error message');
    assert(result.diagnostics.response.bodyExcerpt.includes('bearer [redacted]'), 'failed Halo client discovery should include a sanitized response body excerpt');
    assert.strictEqual(result.diagnostics.response.bodyExcerpt.length <= 1000, true, 'failed Halo client discovery should truncate the response body excerpt');
    assert(result.diagnostics.timestamp, 'failed Halo client discovery should include a timestamp');
    assert(!result.message.includes('halo-token'), 'failed Halo client discovery should not leak tokens');
    assert(!result.message.includes('stored-secret-value'), 'failed Halo client discovery should not leak secrets');
    assert(logger.warnings.some((entry) => entry.includes('HaloPSA mapping discovery diagnostic')), 'failed Halo client discovery should log a searchable diagnostic message');
    assert(logger.warnings.some((entry) => entry.includes('"operation":"halo_client_discovery"')), 'failed Halo client discovery should log sanitized discovery diagnostics');
    assert(logger.warnings.some((entry) => entry.includes('"path":"/Client"')), 'failed Halo client discovery should log the /Client path');
    assert(!logger.warnings.some((entry) => entry.includes('halo-token')), 'failed Halo client discovery logs should not leak tokens');
    assert(!logger.warnings.some((entry) => entry.includes('stored-secret-value')), 'failed Halo client discovery logs should not leak secrets');
    assert(!JSON.stringify(result.diagnostics).includes('Authorization'), 'failed Halo client discovery diagnostics should not include Authorization headers');
  });
}

async function run() {
  await testPortableOrderingSqlStaysOutOfSQLiteOnlyCollation();
  await testListReturnsRowsSafely();
  await testSavePersistsRowsThroughContextDbWithoutExternalCalls();
  await testDuplicateCollisionFailsSafely();
  await testDeleteBehavesDeterministically();
  await testAction1OrganizationDiscoveryUsesMarketplaceCredentials();
  await testAction1OrganizationDiscoveryFailsSafely();
  await testHaloClientDiscoveryIsReadOnlyAndSanitized();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
