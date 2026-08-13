const assert = require('assert');
const fs = require('fs');
const path = require('path');

function createFakeDb() {
  const reservations = [
    {
      policy_id: 'POL-000010',
      organization_id: 'org-acme',
      scope_type: 'ENDPOINT_GROUP',
      endpoint_group_id: 'group-reserved'
    }
  ];

  return {
    async all(sql, params = []) {
      if (sql.includes('FROM action1_configuration_manager_scope_reservations') && sql.includes('WHERE organization_id = ?')) {
        return reservations.filter((entry) => entry.organization_id === params[0]);
      }
      throw new Error(`Unhandled SQL in fake db.all: ${sql}`);
    },
    async get() {
      return null;
    },
    async run() {
      return { changes: 0 };
    }
  };
}

function createFakeContext(options = {}) {
  const loggerCalls = [];
  return {
    db: createFakeDb(),
    action1: {
      async getCredentials() {
        return options.credentials || { apiKey: 'client-id', apiSecret: 'client-secret' };
      }
    },
    http: async (requestOptions = {}) => {
      if (typeof options.http === 'function') {
        return options.http(requestOptions);
      }
      throw new Error(`Unexpected request: ${requestOptions.method || 'GET'} ${requestOptions.url || ''}`);
    },
    logger: {
      warn(entry) {
        loggerCalls.push(entry);
      },
      info() {},
      error() {}
    },
    __loggerCalls: loggerCalls
  };
}

function httpJsonResponse(statusCode, payload) {
  return {
    statusCode,
    payload,
    headers: {}
  };
}

async function run() {
  const manifest = require(path.join(__dirname, '..', 'manifest.json'));
  const actionIds = manifest.actions.map((action) => action.id);
  assert(actionIds.includes('discover-policy-organizations'));
  assert(actionIds.includes('discover-policy-endpoint-groups'));
  assert(manifest.actions.filter((action) => action.history === false).length >= 7);

  const source = fs.readFileSync(path.join(__dirname, '..', 'policyDiscoveryActions.js'), 'utf8');
  assert.strictEqual(source.includes('request.run'), false);
  assert.strictEqual(source.includes('createAutomation'), false);

  const actions = require(path.join(__dirname, '..', 'actions.js')).actions;

  {
    const context = createFakeContext({
      http: async (requestOptions = {}) => {
        const url = String(requestOptions.url || '');
        if (url.endsWith('/oauth2/token')) {
          return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
        }
        if (url.endsWith('/organizations')) {
          return httpJsonResponse(200, {
            organizations: [
              { id: 'org-acme', name: 'Acme Corp' },
              { id: 'org-fabrikam', name: 'Fabrikam' }
            ]
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });

    const result = await actions['discover-policy-organizations'](context, {});
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.organizations, [
      { organizationId: 'org-acme', organizationName: 'Acme Corp' },
      { organizationId: 'org-fabrikam', organizationName: 'Fabrikam' }
    ]);
  }

  {
    const context = createFakeContext({
      http: async (requestOptions = {}) => {
        const url = String(requestOptions.url || '');
        if (url.endsWith('/oauth2/token')) {
          return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
        }
        if (url.includes('/endpoints/groups/org-acme?limit=500&from=0')) {
          return httpJsonResponse(200, {
            items: [
              { id: 'group-reserved', name: 'Reserved Group', endpoint_count: 10 },
              { id: 'group-open', name: 'Open Group', endpoint_count: 12 }
            ]
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });

    const result = await actions['discover-policy-endpoint-groups'](context, {
      payload: { organizationId: 'org-acme' }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.organizationId, 'org-acme');
    assert.strictEqual(result.allEndpointsAvailable, false);
    assert.deepStrictEqual(result.endpointGroups, [
      { organizationId: 'org-acme', endpointGroupId: 'group-open', endpointGroupName: 'Open Group', endpointCount: 12 }
    ]);
  }

  {
    const context = createFakeContext({
      http: async (requestOptions = {}) => {
        const url = String(requestOptions.url || '');
        if (url.endsWith('/oauth2/token')) {
          return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
        }
        if (url.includes('/endpoints/groups/org-acme?limit=500&from=0')) {
          return httpJsonResponse(200, {
            items: [{ id: 'group-reserved', name: 'Reserved Group', endpoint_count: 10 }]
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });

    const result = await actions['discover-policy-endpoint-groups'](context, {
      payload: { organizationId: 'org-acme', policyId: 'POL-000010' }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.allEndpointsAvailable, true);
    assert.deepStrictEqual(result.endpointGroups, [
      { organizationId: 'org-acme', endpointGroupId: 'group-reserved', endpointGroupName: 'Reserved Group', endpointCount: 10 }
    ]);
  }

  {
    const context = createFakeContext({
      http: async (requestOptions = {}) => {
        const url = String(requestOptions.url || '');
        if (url.endsWith('/oauth2/token')) {
          return httpJsonResponse(200, {
            error_description: 'access_token=super-secret-token client_secret=sensitive-secret'
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });

    const result = await actions['discover-policy-organizations'](context, {});
    assert.strictEqual(result.ok, false);
    assert(/Unable to load Action1 organizations/i.test(result.message));
    const diagnosticText = JSON.stringify(context.__loggerCalls[0] || {});
    assert.strictEqual(/super-secret-token|sensitive-secret/i.test(diagnosticText), false, 'logged diagnostics must be sanitized');
  }
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
