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
      jira_project_id: row.jira_project_id,
      jira_project_key: row.jira_project_key,
      jira_project_name: row.jira_project_name,
      jira_issue_type_id: row.jira_issue_type_id,
      jira_issue_type_name: row.jira_issue_type_name,
      enabled: row.enabled ?? 1,
      created_at: row.created_at || '2026-06-24T00:00:00Z',
      updated_at: row.updated_at || '2026-06-24T00:00:00Z'
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
        if (sql.includes('FROM jira_cloud_org_project_mappings')) {
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
        if (sql.startsWith('INSERT INTO jira_cloud_org_project_mappings')) {
          state.rows.push({
            id: state.nextId++,
            action1_org_id: params[0],
            action1_org_name: params[1],
            jira_project_id: params[2],
            jira_project_key: params[3],
            jira_project_name: params[4],
            jira_issue_type_id: params[5],
            jira_issue_type_name: params[6],
            enabled: Number(params[7]),
            created_at: '2026-06-24T00:00:00Z',
            updated_at: '2026-06-24T00:00:00Z'
          });
          return;
        }
        if (sql.startsWith('UPDATE jira_cloud_org_project_mappings')) {
          const row = findById(params[8]);
          if (row) {
            row.action1_org_id = params[0];
            row.action1_org_name = params[1];
            row.jira_project_id = params[2];
            row.jira_project_key = params[3];
            row.jira_project_name = params[4];
            row.jira_issue_type_id = params[5];
            row.jira_issue_type_name = params[6];
            row.enabled = Number(params[7]);
            row.updated_at = '2026-06-24T01:00:00Z';
          }
          return;
        }
        if (sql.startsWith('DELETE FROM jira_cloud_org_project_mappings')) {
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
  const jiraApiPath = require.resolve('../jiraApi');
  delete require.cache[actionsPath];
  delete require.cache[action1ApiPath];
  delete require.cache[mappingActionsPath];
  delete require.cache[mappingStorePath];
  delete require.cache[jiraApiPath];
  return require('../actions').actions;
}

async function testListReturnsRowsSafely() {
  const { db } = createMappingDbContext([
    {
      id: 4,
      action1_org_id: 'org-2',
      action1_org_name: 'beta org',
      jira_project_id: '2002',
      jira_project_key: 'BETA',
      jira_project_name: 'Beta Project',
      jira_issue_type_id: '10002',
      jira_issue_type_name: 'Task',
      enabled: 0
    },
    {
      id: 3,
      action1_org_id: 'org-1',
      action1_org_name: 'Alpha Org',
      jira_project_id: '2001',
      jira_project_key: 'ALPHA',
      jira_project_name: 'Alpha Project',
      jira_issue_type_id: '10001',
      jira_issue_type_name: 'Bug',
      enabled: 1
    },
    {
      id: 7,
      action1_org_id: 'org-3',
      action1_org_name: 'alpha org',
      jira_project_id: '2001',
      jira_project_key: 'ALPHA',
      jira_project_name: 'Alpha Project',
      jira_issue_type_id: '10002',
      jira_issue_type_name: 'Task',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();
  const result = await actions['list-jira-org-project-mappings']({ db }, {});

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
    const result = await actions['save-jira-org-project-mapping']({ db }, {
      payload: {
        action1OrgId: 'org-10',
        action1OrgName: 'Northwind',
        jiraProjectId: '3001',
        jiraProjectKey: 'NORTH',
        jiraProjectName: 'Northwind Project',
        jiraIssueTypeId: '4001',
        jiraIssueTypeName: 'Bug'
      }
    });

    assert.strictEqual(result.ok, true, 'save mapping action should succeed');
    assert.strictEqual(state.rows.length, 1, 'save mapping action should persist a row');
    assert.strictEqual(result.mapping.action1OrgId, 'org-10', 'saved row should be normalized');
    assert.strictEqual(result.mapping.jiraProjectKey, 'NORTH', 'saved project key should persist');
    assert.strictEqual(result.mapping.jiraIssueTypeName, 'Bug', 'saved issue type name should persist');
    assert.strictEqual(result.mapping.enabled, true, 'save mapping action should default mappings to enabled for storage compatibility');
    assert.strictEqual(fetchCalls, 0, 'mapping save should not perform external calls');
  });
}

async function testUniquenessRulesFailSafely() {
  const { db } = createMappingDbContext([
    {
      id: 1,
      action1_org_id: 'org-1',
      action1_org_name: 'Alpha Org',
      jira_project_id: '2001',
      jira_project_key: 'ALPHA',
      jira_project_name: 'Alpha Project',
      jira_issue_type_id: '10001',
      jira_issue_type_name: 'Bug',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();

  const duplicateOrg = await actions['save-jira-org-project-mapping']({ db }, {
    payload: {
      action1OrgId: 'org-1',
      action1OrgName: 'Alpha Org',
      jiraProjectId: '2002',
      jiraProjectKey: 'BETA',
      jiraProjectName: 'Beta Project',
      jiraIssueTypeId: '10002',
      jiraIssueTypeName: 'Task',
      enabled: true
    }
  });
  assert.strictEqual(duplicateOrg.ok, false, 'duplicate Action1 org should fail safely');
  assert(duplicateOrg.message.includes('already mapped'), 'duplicate Action1 org should return actionable error');

  const sameProjectAllowed = await actions['save-jira-org-project-mapping']({ db }, {
    payload: {
      action1OrgId: 'org-2',
      action1OrgName: 'Beta Org',
      jiraProjectId: '2001',
      jiraProjectKey: 'ALPHA',
      jiraProjectName: 'Alpha Project',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug',
      enabled: true
    }
  });
  assert.strictEqual(sameProjectAllowed.ok, true, 'many Action1 orgs should be allowed to share one Jira project and issue type');
}

async function testDeleteBehavesDeterministically() {
  const { db, state } = createMappingDbContext([
    {
      id: 5,
      action1_org_id: 'org-9',
      action1_org_name: 'Delete Me',
      jira_project_id: '9001',
      jira_project_key: 'DEL',
      jira_project_name: 'Delete Project',
      jira_issue_type_id: '9002',
      jira_issue_type_name: 'Task',
      enabled: 1
    }
  ]);
  const actions = await loadFreshActionsModule();

  const deleted = await actions['delete-jira-org-project-mapping']({ db }, { payload: { id: 5 } });
  assert.strictEqual(deleted.ok, true, 'delete mapping action should succeed when row exists');
  assert.strictEqual(deleted.deleted, true, 'delete mapping action should report deleted rows');
  assert.strictEqual(state.rows.length, 0, 'delete mapping action should remove the row');

  const deletedAgain = await actions['delete-jira-org-project-mapping']({ db }, { payload: { id: 5 } });
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

async function testJiraProjectDiscoveryUsesProjectSearchWithFallback() {
  {
    const fetchCalls = [];
    await withMockedFetch(async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('/rest/api/3/project/search')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            values: [
              { id: '100', key: 'OPS', name: 'Operations' }
            ]
          })
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }, async () => {
      const actions = await loadFreshActionsModule();
      const result = await actions['discover-jira-project-mapping-options']({
        settings: createSettingsContext({
          JiraCloudSiteUrl: 'https://example.atlassian.net',
          JiraCloudUserEmail: 'jira-admin@example.com',
          JiraCloudApiToken: 'token'
        })
      }, { settings: {} });

      assert.strictEqual(result.ok, true, 'Jira project discovery should succeed');
      assert.deepStrictEqual(result.jiraProjects, [{ id: '100', key: 'OPS', name: 'Operations' }], 'Jira project discovery should normalize project rows');
      assert(fetchCalls.some((call) => call.url.includes('/rest/api/3/project/search')), 'Jira project discovery should use project/search');
      assert.strictEqual(fetchCalls.some((call) => call.url.endsWith('/rest/api/3/project')), false, 'Jira project discovery should not fall back when project/search succeeds');
      assert(fetchCalls[0].options.headers.Authorization.startsWith('Basic '), 'Jira project discovery should use HTTP Basic auth');
    });
  }

  {
    const fetchCalls = [];
    await withMockedFetch(async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/rest/api/3/project/search')) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ message: 'not found' })
        };
      }
      if (String(url).endsWith('/rest/api/3/project')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ id: '101', key: 'HELP', name: 'Help Desk' }])
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }, async () => {
      const actions = await loadFreshActionsModule();
      const result = await actions['discover-jira-project-mapping-options']({
        settings: createSettingsContext({
          JiraCloudSiteUrl: 'https://example.atlassian.net',
          JiraCloudUserEmail: 'jira-admin@example.com',
          JiraCloudApiToken: 'token'
        })
      }, { settings: {} });

      assert.strictEqual(result.ok, true, 'Jira project discovery should fall back safely');
      assert.deepStrictEqual(result.jiraProjects, [{ id: '101', key: 'HELP', name: 'Help Desk' }], 'Jira project discovery fallback should normalize project rows');
      assert(fetchCalls.some((url) => url.includes('/rest/api/3/project/search')), 'Jira project discovery fallback should still try project/search first');
      assert(fetchCalls.some((url) => url.endsWith('/rest/api/3/project')), 'Jira project discovery fallback should use /project');
    });
  }
}

async function testJiraIssueTypeDiscoveryIsProjectScopedAndSafe() {
  {
    const fetchCalls = [];
    await withMockedFetch(async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/rest/api/3/issuetype/project?projectId=100')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { id: '11', name: 'Bug', subtask: false },
            { id: '12', name: 'Task', subtask: false }
          ])
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }, async () => {
      const actions = await loadFreshActionsModule();
      const result = await actions['discover-jira-issue-type-mapping-options']({
        settings: createSettingsContext({
          JiraCloudSiteUrl: 'https://example.atlassian.net',
          JiraCloudUserEmail: 'jira-admin@example.com',
          JiraCloudApiToken: 'token'
        })
      }, {
        settings: {},
        payload: { jiraProjectId: '100' }
      });

      assert.strictEqual(result.ok, true, 'Jira issue type discovery should succeed');
      assert.deepStrictEqual(result.jiraIssueTypes.map((row) => ({ id: row.id, name: row.name })), [
        { id: '11', name: 'Bug' },
        { id: '12', name: 'Task' }
      ], 'Jira issue type discovery should normalize issue type rows');
      assert(fetchCalls.some((url) => url.includes('/rest/api/3/issuetype/project?projectId=100')), 'Jira issue type discovery should use the selected project ID');
    });
  }

  {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-jira-issue-type-mapping-options']({
      settings: createSettingsContext({
        JiraCloudSiteUrl: 'https://example.atlassian.net',
        JiraCloudUserEmail: 'jira-admin@example.com',
        JiraCloudApiToken: 'token'
      })
    }, {
      settings: {},
      payload: {}
    });

    assert.strictEqual(result.ok, false, 'missing project id should fail safely');
    assert(result.message.includes('Select a Jira project before loading Jira issue types.'), 'missing project id should return clear guidance');
  }

  {
    await withMockedFetch(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        message: 'authorization=Basic abc123 token=top-secret'
      })
    }), async () => {
      const logger = createLoggerContext();
      const actions = await loadFreshActionsModule();
      const result = await actions['discover-jira-issue-type-mapping-options']({
        settings: createSettingsContext({
          JiraCloudSiteUrl: 'https://example.atlassian.net',
          JiraCloudUserEmail: 'jira-admin@example.com',
          JiraCloudApiToken: 'top-secret'
        }),
        logger: logger.logger
      }, {
        settings: {},
        payload: { jiraProjectId: '100' }
      });

      assert.strictEqual(result.ok, false, 'failed Jira issue type discovery should fail safely');
      assert(result.message.includes('Jira issue type discovery failed.'), 'failed Jira issue type discovery should return a short UI message');
      assert.strictEqual(result.jiraProjectId, '100', 'failed Jira issue type discovery should echo the selected project id');
      assert(!result.message.includes('top-secret'), 'failed Jira issue type discovery should not leak tokens');
      assert(!JSON.stringify(result.diagnostics).includes('Authorization'), 'failed Jira issue type discovery diagnostics should not include Authorization headers');
      assert(logger.warnings.some((entry) => entry.includes('Jira Cloud mapping discovery diagnostic')), 'failed Jira issue type discovery should log sanitized diagnostics');
    });
  }
}

async function run() {
  await testPortableOrderingSqlStaysOutOfSQLiteOnlyCollation();
  await testListReturnsRowsSafely();
  await testSavePersistsRowsThroughContextDbWithoutExternalCalls();
  await testUniquenessRulesFailSafely();
  await testDeleteBehavesDeterministically();
  await testAction1OrganizationDiscoveryUsesMarketplaceCredentials();
  await testJiraProjectDiscoveryUsesProjectSearchWithFallback();
  await testJiraIssueTypeDiscoveryIsProjectScopedAndSafe();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
