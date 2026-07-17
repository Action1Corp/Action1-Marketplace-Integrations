const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'core', 'entra', 'entraClient.mjs')
  ).href;
  return import(moduleUrl);
}

async function run() {
  const entraClient = await loadModule();
  await runTokenReuseBeforeExpiryTest(entraClient);
  await runTokenRefreshAfterExpiryTest(entraClient);
  await runValidateGraphConnectionSuccessTest(entraClient);
  await runValidateGraphConnection401RetryTest(entraClient);
}

async function runTokenReuseBeforeExpiryTest(entraClient) {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(200, {
        access_token: 'graph-token-reused',
        expires_in: 3600
      });
    }

    if (String(url).includes('/memberOf/')) {
      return jsonResponse(200, {
        value: []
      });
    }

    return jsonResponse(200, {
      value: [
        { id: 'device-1', displayName: 'Device One' },
        { id: 'device-2', displayName: 'Device Two' }
      ]
    });
  };

  try {
    const result = await entraClient.listDevicesWithGroups({
      tenantId: 'tenant-id-123',
      clientId: 'client-id-123',
      clientSecret: 'client-secret-123'
    }, silentLogger());

    assert.strictEqual(result.length, 2, 'device collection should still complete');
    assert.strictEqual(
      requests.filter((entry) => entry.url.includes('/oauth2/v2.0/token')).length,
      1,
      'Graph access tokens should be reused before expiry across the device/memberOf collection flow'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function runTokenRefreshAfterExpiryTest(entraClient) {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  const requests = [];
  let now = 1_000_000;
  let graphCalls = 0;
  let tokenCalls = 0;

  Date.now = () => now;
  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      tokenCalls += 1;
      return jsonResponse(200, {
        access_token: tokenCalls === 1 ? 'graph-token-initial' : 'graph-token-refreshed',
        expires_in: 3600
      });
    }

    graphCalls += 1;
    if (graphCalls === 1) {
      now += 3_500_000;
      return jsonResponse(200, {
        value: [{ id: 'device-1', displayName: 'Device One' }]
      });
    }

    return jsonResponse(200, {
      value: []
    });
  };

  try {
    const result = await entraClient.listDevicesWithGroups({
      tenantId: 'tenant-id-123',
      clientId: 'client-id-123',
      clientSecret: 'client-secret-123'
    }, silentLogger());

    assert.strictEqual(result.length, 1, 'device collection should still complete after a proactive token refresh');
    assert.strictEqual(tokenCalls, 2, 'Graph access tokens should be reacquired after the cached token nears expiry');
  } finally {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  }
}

async function runValidateGraphConnectionSuccessTest(entraClient) {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(200, {
        access_token: 'graph-token-1',
        expires_in: 3600
      });
    }

    return jsonResponse(200, {
      value: [{ id: 'device-1' }]
    });
  };

  try {
    const result = await entraClient.validateGraphConnection({
      tenantId: 'tenant-id-123',
      clientId: 'client-id-123',
      clientSecret: 'client-secret-123'
    }, silentLogger());

    assert.strictEqual(result.ok, true, 'minimal validation probe should succeed for valid credentials');
    assert.strictEqual(
      requests.filter((entry) => entry.url.includes('/oauth2/v2.0/token')).length,
      1,
      'validation probe should acquire one Graph access token'
    );
    const graphReads = requests.filter((entry) => entry.url.startsWith('https://graph.microsoft.com/v1.0/devices?'));
    assert.strictEqual(graphReads.length, 1, 'validation probe should make one minimal read-only Graph request');
    assert.strictEqual(
      graphReads[0].url.includes('$top=1'),
      true,
      'validation probe should constrain the Graph read to the smallest page size'
    );
    assert.strictEqual(
      graphReads[0].authorization,
      'Bearer graph-token-1',
      'validation probe should authorize the Graph read with the acquired bearer token'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function runValidateGraphConnection401RetryTest(entraClient) {
  const originalFetch = global.fetch;
  const requests = [];
  let graphAttempts = 0;
  let tokenRequests = 0;

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers?.Authorization || options.headers?.authorization || null
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      tokenRequests += 1;
      return jsonResponse(200, {
        access_token: tokenRequests === 1 ? 'stale-graph-token' : 'fresh-graph-token',
        expires_in: 3600
      });
    }

    graphAttempts += 1;
    if (graphAttempts === 1) {
      return jsonResponse(401, {
        error: {
          code: 'InvalidAuthenticationToken',
          message: 'Access token expired'
        }
      });
    }

    return jsonResponse(200, {
      value: [{ id: 'device-2' }]
    });
  };

  try {
    const result = await entraClient.validateGraphConnection({
      tenantId: 'tenant-id-123',
      clientId: 'client-id-123',
      clientSecret: 'client-secret-123'
    }, silentLogger());

    assert.strictEqual(result.ok, true, 'validation probe should recover from one Graph 401');
    assert.strictEqual(tokenRequests, 2, 'Graph 401 should force one token reacquisition');
    const graphReads = requests.filter((entry) => entry.url.startsWith('https://graph.microsoft.com/v1.0/devices?'));
    assert.deepStrictEqual(
      graphReads.map((entry) => entry.authorization),
      ['Bearer stale-graph-token', 'Bearer fresh-graph-token'],
      'Graph 401 should retry the same minimal read with the refreshed bearer token'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
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
