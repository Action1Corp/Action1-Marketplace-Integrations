const assert = require('assert');

const originalFetch = global.fetch;

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
  const jiraApiPath = require.resolve('../jiraApi');
  const validatePath = require.resolve('../validate');
  delete require.cache[actionsPath];
  delete require.cache[jiraApiPath];
  delete require.cache[validatePath];
  return require('../actions').actions;
}

async function testMissingSettingsReturnsFailureWithoutHttp() {
  let fetchCalls = 0;
  await withMockedFetch(async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called when config is incomplete');
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext()
    }, {
      settings: {}
    });

    assert(result && typeof result === 'object', 'validate-configuration should return an object');
    assert.strictEqual(result.ok, false, 'missing settings should fail validation');
    assert(result.message.includes('Missing required Jira Cloud settings'), 'missing settings should return a clear required-fields message');
    assert.strictEqual(fetchCalls, 0, 'missing settings should not trigger external HTTP calls');
  });
}

async function testStoredSecretFallbackAndSuccessfulValidation() {
  const calls = [];
  await withMockedFetch(async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).endsWith('/rest/api/3/myself')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          accountId: 'abc123',
          displayName: 'Jira Admin',
          emailAddress: 'jira-admin@example.com'
        })
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext({
        JiraCloudApiToken: 'stored-secret-value'
      })
    }, {
      settings: {
        JiraCloudSiteUrl: 'https://example.atlassian.net/',
        JiraCloudUserEmail: 'jira-admin@example.com',
        _secretModes: {
          JiraCloudApiToken: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'valid Jira settings should pass validation');
    assert(result.message.includes('Connected'), 'successful validation should return a connected message');
    assert.strictEqual(calls.length, 1, 'successful validation should perform one read-only Jira call');
    assert(calls[0].url.endsWith('/rest/api/3/myself'), 'validation should call /rest/api/3/myself');
    assert.strictEqual(String(calls[0].options.method || '').toUpperCase(), 'GET', 'validation should use GET');
    assert(calls[0].options.headers.Authorization.startsWith('Basic '), 'validation should use HTTP Basic auth');
    assert(!calls[0].url.includes('/issue'), 'validation must not call Jira issue endpoints');
  });
}

async function testBadAuthReturnsSafeFailure() {
  await withMockedFetch(async (url) => {
    assert(String(url).endsWith('/rest/api/3/myself'), 'bad-auth test should call /rest/api/3/myself');
    return {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        errorMessages: ['Authorization: Basic abc123secret token invalid']
      })
    };
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext()
    }, {
      settings: {
        JiraCloudSiteUrl: 'https://example.atlassian.net',
        JiraCloudUserEmail: 'jira-admin@example.com',
        JiraCloudApiToken: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, false, 'bad auth should fail validation');
    assert(result.message.startsWith('Failed:'), 'bad auth should return a safe failure prefix');
    assert(!result.message.includes('stored-secret-value'), 'failure message must not leak API token');
    assert(!result.message.includes('abc123secret'), 'failure message must not leak Authorization material');
    assert(!result.message.toLowerCase().includes('basic '), 'failure message must not leak raw Basic authorization');
  });
}

async function testLogsDoNotLeakSecrets() {
  const logs = [];
  await withMockedFetch(async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({
      message: 'authorization=Basic abc123 api_token=stored-secret-value'
    })
  }), async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext()
    }, {
      settings: {
        JiraCloudSiteUrl: 'https://example.atlassian.net',
        JiraCloudUserEmail: 'jira-admin@example.com',
        JiraCloudApiToken: 'stored-secret-value'
      },
      run: {
        appendLog: async (message) => logs.push(String(message))
      }
    });

    assert.strictEqual(result.ok, false, 'sanitized failure fixture should fail validation');
    assert.strictEqual(logs.some((entry) => entry.includes('stored-secret-value')), false, 'run logs must not leak API tokens');
    assert.strictEqual(logs.some((entry) => entry.includes('Basic abc123')), false, 'run logs must not leak Authorization values');
  });
}

async function run() {
  await testMissingSettingsReturnsFailureWithoutHttp();
  await testStoredSecretFallbackAndSuccessfulValidation();
  await testBadAuthReturnsSafeFailure();
  await testLogsDoNotLeakSecrets();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
