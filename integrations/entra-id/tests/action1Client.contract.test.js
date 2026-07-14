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

  await runRateLimitRetryTest(action1Client);
  await run401RefreshRetryTest(action1Client);
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
