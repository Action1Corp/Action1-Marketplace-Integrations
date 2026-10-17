const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'core', 'action1', 'action1Client.mjs')
  ).href;
  return import(moduleUrl);
}

async function run() {
  const action1Client = await loadModule();

  await runTokenReuseBeforeExpiryTest(action1Client);
  await runTokenRefreshAfterExpiryTest(action1Client);
  await runRateLimitRetryTest(action1Client);
  await run401RefreshRetryTest(action1Client);
  await runRegionalReadWriteAndTrailingSlashTest(action1Client);
  await runRegionalPaginationCharacterizationTest(action1Client);
  await runInvalidBaseUrlTest(action1Client);
}

async function runRegionalReadWriteAndTrailingSlashTest(action1Client) {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/oauth2/token')) {
      return jsonResponse(200, { access_token: 'regional-token', expires_in: 3600 });
    }
    if (String(url).includes('/endpoints/managed/org-regional?')) {
      return jsonResponse(200, { items: [{ id: 'endpoint-regional', name: 'Regional Endpoint' }] });
    }
    if (String(url).endsWith('/endpoints/managed/org-regional/endpoint-regional')) {
      return jsonResponse(200, { id: 'endpoint-regional' });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const config = {
      apiBaseUrl: 'https://app.na-2.action1.com/api/3.0/',
      clientId: 'regional-client',
      clientSecret: 'regional-secret'
    };
    const token = await action1Client.getAccessToken(config, silentLogger());
    await action1Client.listManagedEndpoints(config, token, 'org-regional', { limit: 50 }, silentLogger());
    await action1Client.patchManagedEndpoint(config, token, 'org-regional', 'endpoint-regional', { 'custom:Entra Groups': 'Group A' }, silentLogger());

    assert.deepStrictEqual(requests.map((entry) => entry.url), [
      'https://app.na-2.action1.com/api/3.0/oauth2/token',
      'https://app.na-2.action1.com/api/3.0/endpoints/managed/org-regional?limit=50&fields=*',
      'https://app.na-2.action1.com/api/3.0/endpoints/managed/org-regional/endpoint-regional'
    ], 'regional Action1 token, read, and write requests should preserve the API base path without double slashes');
    assert.strictEqual(requests.some((entry) => entry.url.includes('app.action1.com/api/3.0')), false, 'main Action1 requests must not use the historical region');
  } finally {
    global.fetch = originalFetch;
  }
}

async function runInvalidBaseUrlTest(action1Client) {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return jsonResponse(200, { access_token: 'should-not-be-requested' });
  };

  try {
    await assert.rejects(
      () => action1Client.getAccessToken({ apiBaseUrl: 'not-a-url', clientId: 'client', clientSecret: 'secret' }, silentLogger()),
      /valid|config/i,
      'invalid Action1 base URLs should fail before HTTP execution'
    );
    assert.strictEqual(fetchCalls, 0, 'invalid Action1 base URLs must not send HTTP requests');
  } finally {
    global.fetch = originalFetch;
  }
}

async function runRegionalPaginationCharacterizationTest(action1Client) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/oauth2/token')) {
      return jsonResponse(200, { access_token: 'regional-page-token', expires_in: 3600 });
    }
    if (String(url).includes('from=1')) {
      return jsonResponse(200, { items: [{ id: 'endpoint-2' }] });
    }
    return jsonResponse(200, {
      items: [{ id: 'endpoint-1' }],
      next_page: 'https://app.na-2.action1.com/api/3.0/endpoints/managed/org-page?limit=50&fields=*&from=1'
    });
  };

  try {
    const config = {
      apiBaseUrl: 'https://app.na-2.action1.com/api/3.0',
      clientId: 'regional-page-client',
      clientSecret: 'regional-page-secret'
    };
    const token = await action1Client.getAccessToken(config, silentLogger());
    const rows = await action1Client.listManagedEndpoints(
      config,
      token,
      'org-page',
      { limit: 50 },
      silentLogger()
    );
    assert.deepStrictEqual(rows, [{ id: 'endpoint-1' }, { id: 'endpoint-2' }], 'existing Action1 pagination should collect regional pages');
    assert.strictEqual(requests[2], 'https://app.na-2.action1.com/api/3.0/endpoints/managed/org-page?limit=50&fields=*&from=1', 'existing pagination should retain the regional API base');
  } finally {
    global.fetch = originalFetch;
  }
}

async function runTokenReuseBeforeExpiryTest(action1Client) {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).endsWith('/oauth2/token')) {
      return jsonResponse(200, {
        access_token: 'cached-action1-token',
        expires_in: 3600
      });
    }

    return jsonResponse(200, {
      items: [{ id: 'ep-1', name: 'Endpoint One' }]
    });
  };

  try {
    const action1Config = {
      apiBaseUrl: 'https://app.action1.test/api/3.0',
      clientId: 'cache-client',
      clientSecret: 'cache-secret'
    };

    await action1Client.listOrganizations(action1Config, null, silentLogger());
    await action1Client.listOrganizations(action1Config, null, silentLogger());

    assert.strictEqual(
      requests.filter((entry) => entry.url.endsWith('/oauth2/token')).length,
      1,
      'Action1 OAuth tokens should be reused before expiry when cached state is still valid'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function runTokenRefreshAfterExpiryTest(action1Client) {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  const requests = [];
  let now = 1_000_000;
  let endpointCalls = 0;
  let tokenCalls = 0;

  Date.now = () => now;
  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).endsWith('/oauth2/token')) {
      tokenCalls += 1;
      return jsonResponse(200, {
        access_token: tokenCalls === 1 ? 'first-action1-token' : 'second-action1-token',
        expires_in: 3600
      });
    }

    endpointCalls += 1;
    if (endpointCalls === 1) {
      now += 3_500_000;
    }

    return jsonResponse(200, {
      items: [{ id: 'ep-1', name: 'Endpoint One' }]
    });
  };

  try {
    const action1Config = {
      apiBaseUrl: 'https://app.action1.test/api/3.0',
      clientId: 'expiry-client',
      clientSecret: 'expiry-secret'
    };

    await action1Client.listOrganizations(action1Config, null, silentLogger());
    await action1Client.listOrganizations(action1Config, null, silentLogger());

    assert.strictEqual(
      tokenCalls,
      2,
      'Action1 OAuth tokens should be reacquired after the cached token reaches the refresh window'
    );
  } finally {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  }
}

async function runRateLimitRetryTest(action1Client) {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const delays = [];
  let attempts = 0;

  global.setTimeout = (handler, delay, ...args) => {
    delays.push(Number(delay));
    handler(...args);
    return 0;
  };

  global.fetch = async (url) => {
    attempts += 1;
    if (attempts < 3) {
      return jsonResponse(
        429,
        { developer_message: 'rate limited' },
        { 'retry-after': '0' }
      );
    }

    return jsonResponse(200, {
      items: [{ id: 'ep-1', name: 'Endpoint One' }]
    });
  };

  try {
    const rows = await action1Client.listManagedEndpoints(
      {
        apiBaseUrl: 'https://app.action1.test/api/3.0',
        clientId: 'rate-client',
        clientSecret: 'rate-secret'
      },
      'provided-token',
      'org-1',
      { limit: 50 },
      silentLogger()
    );

    assert.deepStrictEqual(rows, [{ id: 'ep-1', name: 'Endpoint One' }]);
    assert.deepStrictEqual(
      delays,
      [8000, 16000],
      '429 backoff should preserve the standalone Action1 exponential delays'
    );
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
}

async function run401RefreshRetryTest(action1Client) {
  const originalFetch = global.fetch;
  const requests = [];
  let endpointAttempts = 0;

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).endsWith('/oauth2/token')) {
      return jsonResponse(200, {
        access_token: 'refreshed-token',
        expires_in: 3600
      });
    }

    endpointAttempts += 1;
    if (endpointAttempts === 1) {
      return jsonResponse(401, {
        developer_message: 'expired token'
      });
    }

    return jsonResponse(200, {
      items: [{ id: 'ep-2', name: 'Endpoint Two' }]
    });
  };

  try {
    const rows = await action1Client.listManagedEndpoints(
      {
        apiBaseUrl: 'https://app.action1.test/api/3.0',
        clientId: 'refresh-client',
        clientSecret: 'refresh-secret'
      },
      'stale-token',
      'org-2',
      { limit: 50 },
      silentLogger()
    );

    assert.deepStrictEqual(rows, [{ id: 'ep-2', name: 'Endpoint Two' }]);
    assert.strictEqual(
      requests.filter((entry) => entry.url.endsWith('/oauth2/token')).length,
      1,
      '401 recovery should fetch one replacement OAuth token'
    );
    const endpointGets = requests.filter((entry) => entry.url.includes('/endpoints/managed/org-2'));
    assert.deepStrictEqual(
      endpointGets.map((entry) => entry.authorization),
      ['Bearer stale-token', 'Bearer refreshed-token'],
      '401 recovery should retry the same endpoint call with the refreshed bearer token'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === String(name).toLowerCase());
        return key ? headers[key] : null;
      }
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function silentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
