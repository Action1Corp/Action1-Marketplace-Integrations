const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createMappingActionHandlers } = require('../mappingActions');
const { createProviderDispatcher } = require('../providerRegistry');
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');

const originalFetch = global.fetch;
const DEFAULT_PROVIDER_ID = 'provider-a';
const PRODUCTION_PROVIDER_ID = 'connectwise-psa';
const diagnosticLogDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'halo-mapping-logs-'));
process.env.HALO_PSA_LOG_DIR = diagnosticLogDir;
function diagnosticText() { try { return fs.readFileSync(path.join(diagnosticLogDir, 'action1-ticketing-runtime.log'), 'utf8'); } catch { return ''; } }

function jsonResponse(status, payload, headers = {}) {
  const normalizedHeaders = {
    'content-type': 'application/json',
    ...headers
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] || null;
      },
      forEach(callback) {
        for (const [key, value] of Object.entries(normalizedHeaders)) {
          callback(value, key);
        }
      }
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function createMappingDbContext(initialRows = []) {
  const state = {
    rows: initialRows.map((row, index) => ({
      id: row.id ?? index + 1,
      provider_id: row.provider_id || DEFAULT_PROVIDER_ID,
      action1_org_id: row.action1_org_id,
      action1_org_name: row.action1_org_name,
      destination_id: row.destination_id || row.halo_client_id,
      destination_name: row.destination_name || row.halo_client_name,
      enabled: row.enabled ?? 1,
      created_at: row.created_at || '2026-06-10T00:00:00Z',
      updated_at: row.updated_at || '2026-06-10T00:00:00Z'
    })),
    nextId: initialRows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1
  };

  function findById(providerId, id) {
    return state.rows.find((row) => row.provider_id === providerId && row.id === Number(id)) || null;
  }

  function findByAction1OrgId(providerId, action1OrgId) {
    return state.rows.find((row) => row.provider_id === providerId && row.action1_org_id === String(action1OrgId)) || null;
  }

  function findByDestinationId(providerId, destinationId) {
    return state.rows.find((row) => row.provider_id === providerId && row.destination_id === String(destinationId)) || null;
  }

  return {
    state,
    db: {
      async all(sql, params = []) {
        if (sql.includes('FROM action1_ticketing_org_client_mappings')) {
          assert(sql.includes('ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC'), 'mapping list SQL should use portable case-insensitive ordering');
          return state.rows
            .filter((row) => row.provider_id === params[0])
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
        if (sql.includes('WHERE provider_id = ? AND id = ?')) {
          return findById(params[0], params[1]);
        }
        if (sql.includes('WHERE provider_id = ? AND action1_org_id = ?')) {
          return findByAction1OrgId(params[0], params[1]);
        }
        if (sql.includes('WHERE provider_id = ? AND destination_id = ?')) {
          return findByDestinationId(params[0], params[1]);
        }
        throw new Error(`Unexpected get() SQL: ${sql}`);
      },
      async run(sql, params = []) {
        if (sql.startsWith('INSERT INTO action1_ticketing_org_client_mappings')) {
          state.rows.push({
            id: state.nextId++,
            provider_id: params[0],
            action1_org_id: params[1],
            action1_org_name: params[2],
            destination_id: params[3],
            destination_name: params[4],
            enabled: Number(params[5]),
            created_at: '2026-06-10T00:00:00Z',
            updated_at: '2026-06-10T00:00:00Z'
          });
          return;
        }
        if (sql.startsWith('UPDATE action1_ticketing_org_client_mappings')) {
          const row = findById(params[5], params[6]);
          if (row) {
            row.provider_id = params[0];
            row.action1_org_id = params[1];
            row.action1_org_name = params[2];
            row.destination_id = params[3];
            row.destination_name = params[4];
            row.enabled = Number(params[5]);
            row.updated_at = '2026-06-10T01:00:00Z';
          }
          return;
        }
        if (sql.startsWith('DELETE FROM action1_ticketing_org_client_mappings')) {
          state.rows = state.rows.filter((row) => !(row.provider_id === params[0] && row.id === Number(params[1])));
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
  const actions = { ...require('../actions').actions };
  const registry = Object.fromEntries(['provider-a', 'provider-b'].map((providerId) => [providerId, {
    providerId,
    label: providerId,
    contractMajor: 1,
    adapter: syntheticAdapter()
  }]));
  const definitions = Object.fromEntries(Object.keys(registry).map((providerId) => [providerId, {
    providerId, label: providerId, available: true, fields: [], accountSelectors: []
  }]));
  const scoped = createMappingActionHandlers({ registry, definitions, dispatcher: createProviderDispatcher(registry) });
  actions['list-ticketing-org-destination-mappings'] = scoped.listHaloOrgClientMappings;
  actions['save-ticketing-org-destination-mapping'] = scoped.saveHaloOrgClientMapping;
  actions['delete-ticketing-org-destination-mapping'] = scoped.deleteHaloOrgClientMapping;
  actions['discover-ticketing-mapping-options'] = scoped.discoverHaloMappingOptions;
  return actions;
}

async function loadProductionActionsModule() {
  const actionsPath = require.resolve('../actions');
  const action1ApiPath = require.resolve('../action1Api');
  const mappingActionsPath = require.resolve('../mappingActions');
  delete require.cache[actionsPath];
  delete require.cache[action1ApiPath];
  delete require.cache[mappingActionsPath];
  return require('../actions').actions;
}

function syntheticAdapter(onDiscover = async () => ({ options: [] }), onOperation = () => {}) {
  return {
    validateConfiguration: async () => ({ ok: true, errors: [] }),
    testConnection: async () => ({ ok: true }),
    discover: async (args) => { onOperation('discover'); return onDiscover(args); },
    prepareTicket: async () => { onOperation('prepareTicket'); return { payload: {}, comparisonValue: '', comparisonVersion: '1' }; },
    getTicket: async () => { onOperation('getTicket'); return { state: 'missing', confirmed: true }; },
    createTicket: async () => { onOperation('createTicket'); return { externalTicketRef: { id: 'fixture-ticket' } }; },
    updateTicket: async () => { onOperation('updateTicket'); return { ok: true }; }
  };
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
  const result = await actions['list-ticketing-org-destination-mappings']({ db }, { providerId: DEFAULT_PROVIDER_ID });

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
    const result = await actions['save-ticketing-org-destination-mapping']({ db }, {
      providerId: DEFAULT_PROVIDER_ID,
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

  const duplicateOrg = await actions['save-ticketing-org-destination-mapping']({ db }, {
    providerId: DEFAULT_PROVIDER_ID,
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

  const duplicateClient = await actions['save-ticketing-org-destination-mapping']({ db }, {
    providerId: DEFAULT_PROVIDER_ID,
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

  const deleted = await actions['delete-ticketing-org-destination-mapping']({ db }, { providerId: DEFAULT_PROVIDER_ID, payload: { id: 5 } });
  assert.strictEqual(deleted.ok, true, 'delete mapping action should succeed when row exists');
  assert.strictEqual(deleted.deleted, true, 'delete mapping action should report deleted rows');
  assert.strictEqual(state.rows.length, 0, 'delete mapping action should remove the row');

  const deletedAgain = await actions['delete-ticketing-org-destination-mapping']({ db }, { providerId: DEFAULT_PROVIDER_ID, payload: { id: 5 } });
  assert.strictEqual(deletedAgain.ok, true, 'delete mapping action should stay deterministic when row is missing');
  assert.strictEqual(deletedAgain.deleted, false, 'delete mapping action should report already-absent rows');
}

async function testAction1OrganizationDiscoveryUsesMarketplaceCredentials() {
  let credentialsCalls = 0;
  let fetchCalls = [];

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).endsWith('/oauth2/token')) {
      return jsonResponse(200, { access_token: 'action1-token', expires_in: 3600 });
    }
    if (String(url).endsWith('/organizations')) {
      return jsonResponse(200, {
        organizations: [
          { id: 'org-1', name: 'Alpha Org' },
          { org_id: 'org-2', org_name: 'Beta Org' }
        ]
      });
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
            apiSecret: 'a1-client-secret',
            organizationId: 'org-tenant',
            baseUrl: 'https://app.na-2.action1.com/api/3.0/'
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
    assert(fetchCalls.every((call) => call.url.startsWith('https://app.na-2.action1.com/api/3.0/')), 'Action1 mapping discovery should use the Marketplace regional API base URL');
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
    assert(diagnosticText().includes('"operation":"action1_org_discovery"'), 'missing credentials should log sanitized Action1 diagnostics');
  }

  {
    const logger = createLoggerContext();
    await withMockedFetch(async (url) => {
      if (String(url).endsWith('/oauth2/token')) {
        return {
          ...jsonResponse(401, {
            error: 'invalid_client',
            error_description: 'client_secret stored-secret-value'
          }),
          ok: false
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
              apiSecret: 'stored-secret-value',
              baseUrl: 'https://app.na-2.action1.com/api/3.0'
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
      assert(diagnosticText().includes('"path":"/oauth2/token"'), 'Action1 token failure should log the token path');
      assert(!diagnosticText().includes('stored-secret-value'), 'Action1 token failure logs should not leak secrets');
    });
  }

  {
    const logger = createLoggerContext();
    await withMockedFetch(async (url) => {
      if (String(url).endsWith('/oauth2/token')) {
        return {
          ...jsonResponse(200, { access_token: 'action1-token', expires_in: 3600 }),
          ok: true
        };
      }
      if (String(url).endsWith('/organizations')) {
        return {
          ok: false,
          status: 403,
          async text() {
            return JSON.stringify({
              error: 'forbidden',
              message: 'bearer action1-token'
            });
          }
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
              apiSecret: 'a1-client-secret',
              baseUrl: 'https://app.na-2.action1.com/api/3.0'
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
      assert(diagnosticText().includes('Action1 Ticketing mapping discovery diagnostic'), 'Action1 organization fetch failure should log a searchable diagnostic message');
      assert(diagnosticText().includes('"status":403'), 'Action1 organization fetch failure should log the HTTP status');
      assert(!diagnosticText().includes('action1-token'), 'Action1 organization fetch failure logs should not leak tokens');
    });
  }
}

async function testProductionDestinationDiscoveryIsUnavailableBeforeTransport() {
  let fetchCalls = 0;
  await withMockedFetch(async () => { fetchCalls += 1; throw new Error('Production mapping discovery must not contact Halo.'); }, async () => {
    const actions = await loadProductionActionsModule();
    let dbCalls = 0;
    const context = {
      db: new Proxy({}, { get() { return async () => { dbCalls += 1; throw new Error('Unavailable provider must stop before persistence.'); }; } }),
      settings: createSettingsContext()
    };
    const result = await actions['discover-ticketing-mapping-options'](context, { providerId: PRODUCTION_PROVIDER_ID });
    assert.strictEqual(result.ok, false, 'the production provider remains unavailable');
    assert.deepStrictEqual(result.destinationOptions, [], 'unavailable destination discovery returns no options');
    assert.match(result.message, /not available/i);
    assert.strictEqual(fetchCalls, 0, 'unavailable provider fails before any destination transport');
    for (const actionId of [
      'list-ticketing-org-destination-mappings',
      'save-ticketing-org-destination-mapping',
      'delete-ticketing-org-destination-mapping'
    ]) {
      const response = await actions[actionId](context, { providerId: PRODUCTION_PROVIDER_ID, payload: { id: 1 } });
      assert.strictEqual(response.ok, false, `${actionId} rejects unavailable providers`);
    }
    assert.strictEqual(dbCalls, 0, 'unavailable mapping actions stop before persistence');
  });
}

async function testLegacyHaloActionPayloadCannotSelectDestinationTransport() {
  let fetchCalls = 0;
  await withMockedFetch(async () => { fetchCalls += 1; throw new Error('No Halo call is permitted.'); }, async () => {
    const actions = await loadProductionActionsModule();
    const result = await actions['discover-ticketing-mapping-options']({ settings: createSettingsContext() }, {
      providerId: PRODUCTION_PROVIDER_ID,
      settings: {
        TicketingResourceServer: 'https://halo.example.com',
        TicketingAuthorisationServer: 'https://halo.example.com/auth',
        TicketingClientId: 'synthetic-client',
        TicketingClientSecret: 'synthetic-secret'
      }
    });
    assert.strictEqual(result.ok, false, 'Halo-shaped settings cannot make the unavailable provider usable');
    assert.strictEqual(fetchCalls, 0, 'legacy Halo settings do not reach destination transport');
  });
}
async function testProviderScopedMappingActionsUseReadOnlyAdapterDiscovery() {
  const { context, tables } = createInMemoryTicketingDb();
  const calls = [];
  const operations = [];
  const registry = Object.fromEntries(['provider-a', 'provider-b'].map((providerId) => [providerId, {
    providerId,
    label: providerId,
    contractMajor: 1,
    adapter: syntheticAdapter((args) => {
      calls.push({ providerId, args });
      return { options: [{ id: 'dest-shared', label: `${providerId} Destination` }] };
    }, (operation) => operations.push(operation))
  }]));
  const definitions = Object.fromEntries(Object.keys(registry).map((providerId) => [providerId, {
    providerId, label: providerId, available: true, fields: [], accountSelectors: []
  }]));
  const handlers = createMappingActionHandlers({ registry, definitions, dispatcher: createProviderDispatcher(registry) });

  const savedA = await handlers.saveHaloOrgClientMapping(context, {
    providerId: 'provider-a',
    payload: { providerId: 'provider-b', action1OrgId: 'org-shared', action1OrgName: 'Shared', destinationId: 'dest-shared', destinationName: 'A Destination' }
  });
  const savedB = await handlers.saveHaloOrgClientMapping(context, {
    providerId: 'provider-b',
    payload: { providerId: 'provider-a', action1OrgId: 'org-shared', action1OrgName: 'Shared', destinationId: 'dest-shared', destinationName: 'B Destination' }
  });
  assert.strictEqual(savedA.ok, true, JSON.stringify(savedA));
  assert.strictEqual(savedB.ok, true);
  assert.strictEqual(savedA.mapping.providerId, 'provider-a', 'row payload cannot change the server-selected owner');
  assert.strictEqual(savedB.mapping.providerId, 'provider-b');
  assert.notStrictEqual(savedA.mapping.id, savedB.mapping.id);
  const listA = await handlers.listHaloOrgClientMappings(context, { providerId: 'provider-a' });
  const listB = await handlers.listHaloOrgClientMappings(context, { providerId: 'provider-b' });
  assert.deepStrictEqual(listA.mappings.map((row) => row.destinationName), ['A Destination']);
  assert.deepStrictEqual(listB.mappings.map((row) => row.destinationName), ['B Destination']);
  const crossProviderUpdate = await handlers.saveHaloOrgClientMapping(context, {
    providerId: 'provider-a',
    payload: { id: savedB.mapping.id, action1OrgId: 'org-shared', action1OrgName: 'Tampered', destinationId: 'dest-shared', destinationName: 'Tampered' }
  });
  assert.strictEqual(crossProviderUpdate.ok, false, 'provider A cannot update a provider B mapping ID');
  const crossProviderDelete = await handlers.deleteHaloOrgClientMapping(context, { providerId: 'provider-a', payload: { id: savedB.mapping.id } });
  assert.strictEqual(crossProviderDelete.deleted, false, 'provider A cannot delete a provider B mapping ID');
  assert.strictEqual((await handlers.listHaloOrgClientMappings(context, { providerId: 'provider-b' })).mappings[0].destinationName, 'B Destination');

  const discoveryA = await handlers.discoverHaloMappingOptions(context, { providerId: 'provider-a' });
  const discoveryB = await handlers.discoverHaloMappingOptions(context, { providerId: 'provider-b' });
  assert.deepStrictEqual(discoveryA.destinationOptions, [{ id: 'dest-shared', name: 'provider-a Destination' }]);
  assert.deepStrictEqual(discoveryB.destinationOptions, [{ id: 'dest-shared', name: 'provider-b Destination' }]);
  assert.deepStrictEqual(calls.map((call) => call.providerId), ['provider-a', 'provider-b']);
  assert(calls.every((call) => call.args.input.kind === 'mapping-destinations'));
  assert(calls.every((call) => Object.keys(call.args).sort().join(',') === 'connection,input,logger,transport'), 'adapter receives only the contract input boundary');
  assert.deepStrictEqual(operations, ['discover', 'discover'], 'Mapping invokes discovery only and never ticket operations');
  assert.strictEqual(Object.keys(tables.get('action1_ticketing_org_client_mappings')).length, 2);

  const productionActions = await loadProductionActionsModule();
  const unavailable = await productionActions['discover-ticketing-mapping-options'](context, { providerId: PRODUCTION_PROVIDER_ID });
  assert.strictEqual(unavailable.ok, false, 'production ConnectWise remains unavailable');
  assert.strictEqual(unavailable.destinationOptions.length, 0);
  assert(!JSON.stringify(unavailable).includes('Halo'));
}

async function run() {
  await testPortableOrderingSqlStaysOutOfSQLiteOnlyCollation();
  await testListReturnsRowsSafely();
  await testSavePersistsRowsThroughContextDbWithoutExternalCalls();
  await testDuplicateCollisionFailsSafely();
  await testDeleteBehavesDeterministically();
  await testAction1OrganizationDiscoveryUsesMarketplaceCredentials();
  await testAction1OrganizationDiscoveryFailsSafely();
  await testProductionDestinationDiscoveryIsUnavailableBeforeTransport();
  await testLegacyHaloActionPayloadCannotSelectDestinationTransport();
  await testProviderScopedMappingActionsUseReadOnlyAdapterDiscovery();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
