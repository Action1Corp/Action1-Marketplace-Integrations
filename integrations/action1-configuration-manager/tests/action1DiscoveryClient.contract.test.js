const assert = require('assert');
const path = require('path');

function httpJsonResponse(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers,
    payload
  };
}

function createRateLimitedError(options = {}) {
  const error = new Error(options.message || 'Too many requests');
  error.statusCode = options.statusCode === undefined ? 429 : options.statusCode;
  error.code = options.code || 'RATE_LIMITED';
  error.retryAfterMs = options.retryAfterMs;
  error.responseHeaders = options.responseHeaders || {};
  error.payload = options.payload;
  return error;
}

function createFakeContext(options = {}) {
  const loggerCalls = {
    info: [],
    warn: [],
    error: []
  };
  const runtimeCalls = { debug: [], info: [], warn: [], error: [] };

  return {
    action1: {
      async getCredentials() {
        return options.credentials || {
          baseUrl: 'https://app.action1.com/api/3.0',
          apiKey: 'client-id',
          apiSecret: 'client-secret'
        };
      }
    },
    http: async (requestOptions = {}) => {
      if (typeof options.http === 'function') {
        return options.http(requestOptions);
      }
      throw new Error(`Unexpected request: ${requestOptions.method || 'GET'} ${requestOptions.url || ''}`);
    },
    logger: {
      info(entry) {
        loggerCalls.info.push(entry);
      },
      warn(entry) {
        loggerCalls.warn.push(entry);
      },
      error(entry) {
        loggerCalls.error.push(entry);
      }
    },
    action1ConfigurationManagerRuntimeLogger: Object.fromEntries(Object.keys(runtimeCalls).map((level) => [level, (message) => runtimeCalls[level].push(message)])),
    __runtimeCalls: runtimeCalls,
    __loggerCalls: loggerCalls
  };
}

async function run() {
  const {
    computeAction1RateLimitDelayMs,
    createAction1DiscoveryClient,
    resolveAction1ConsoleOrigin,
    resolveRetryAfterMs
  } = require(path.join(__dirname, '..', 'action1DiscoveryClient.js'));

  await assert.rejects(
    () =>
      createAction1DiscoveryClient(
        createFakeContext({
          credentials: { apiKey: ' ', apiSecret: '' }
        })
      ).listOrganizations(),
    /marketplace action1 credentials are incomplete/i
  );

  {
    const calls = [];
    const context = createFakeContext({
        credentials: { apiKey: 'client-id', apiSecret: 'client-secret' },
        http: async (requestOptions = {}) => {
          calls.push(requestOptions);
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
          }
          if (url.endsWith('/organizations')) {
            return httpJsonResponse(200, {
              organizations: [
                { id: 'org-1', name: 'Alpha Org' },
                { org_id: ' org-2 ', org_name: ' Beta Org ' },
                { id: 'org-2', name: 'Beta Org' },
                { id: '', name: 'Missing Id' }
              ]
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
    const client = createAction1DiscoveryClient(context);

    const rows = await client.listOrganizations();
    assert.deepStrictEqual(rows, [
      { organizationId: 'org-1', organizationName: 'Alpha Org' },
      { organizationId: 'org-2', organizationName: 'Beta Org' }
    ]);
    const runtimeText = context.__runtimeCalls.debug.join('\n');
    assert(runtimeText.includes('Action1 request') && runtimeText.includes('operation=organizations'), 'request diagnostics should use runtime DEBUG with operation identity');
    assert(runtimeText.includes('Action1 response') && runtimeText.includes('status=200'), 'response diagnostics should use runtime DEBUG');

    const tokenCall = calls.find((entry) => String(entry.url).endsWith('/oauth2/token'));
    assert(tokenCall, 'token request should be issued');
    assert.strictEqual(tokenCall.url, 'https://app.action1.com/api/3.0/oauth2/token');
    assert.strictEqual(tokenCall.method, 'POST');
    assert.strictEqual(tokenCall.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.strictEqual(
      String(tokenCall.data),
      'grant_type=client_credentials&client_id=client-id&client_secret=client-secret'
    );

    const orgCall = calls.find((entry) => String(entry.url).endsWith('/organizations'));
    assert(orgCall, 'organization request should be issued');
    assert.strictEqual(orgCall.headers.Authorization, 'Bearer token-a');
  }

  assert.strictEqual(
    await resolveAction1ConsoleOrigin(createFakeContext({ credentials: { apiKey: 'client-id', apiSecret: 'client-secret' } })),
    null,
    'missing optional console metadata must not block API credentials'
  );
  assert.strictEqual(
    await resolveAction1ConsoleOrigin(createFakeContext({ credentials: { apiKey: 'client-id', apiSecret: 'client-secret', baseUrl: 'https://eu.action1.test/api/3.0' } })),
    'https://eu.action1.test'
  );

  {
    const tokenCalls = [];
    const nowValues = [0, 1000, 3590000, 3599001];
    const client = createAction1DiscoveryClient(
      createFakeContext({
        http: async (requestOptions = {}) => {
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            tokenCalls.push(url);
            return httpJsonResponse(200, {
              access_token: `token-${tokenCalls.length}`,
              expires_in: 3600
            });
          }
          if (url.endsWith('/organizations')) {
            return httpJsonResponse(200, { organizations: [{ id: 'org-1', name: 'Alpha Org' }] });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      }),
      {
        now: () => nowValues.shift()
      }
    );

    await client.listOrganizations();
    await client.listOrganizations();
    await client.listOrganizations();
    await client.listOrganizations();
    assert.strictEqual(tokenCalls.length, 2, 'token should be reused until the 60-second safety window');
  }

  {
    const sharedCache = new Map();
    const tokenCalls = [];
    function createCachedContext(credentials) {
      return createFakeContext({
        credentials,
        http: async (requestOptions = {}) => {
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            tokenCalls.push(credentials.apiKey);
            return httpJsonResponse(200, { access_token: `token-${tokenCalls.length}`, expires_in: 3600 });
          }
          if (url.endsWith('/organizations')) {
            return httpJsonResponse(200, { organizations: [{ id: 'org-1', name: 'Alpha Org' }] });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
    }

    await createAction1DiscoveryClient(createCachedContext({ baseUrl: 'https://app.action1.com/api/3.0', apiKey: 'same-id', apiSecret: 'same-secret' }), {
      tokenCache: sharedCache,
      now: () => 0
    }).listOrganizations();
    await createAction1DiscoveryClient(createCachedContext({ baseUrl: 'https://app.action1.com/api/3.0', apiKey: 'same-id', apiSecret: 'same-secret' }), {
      tokenCache: sharedCache,
      now: () => 1000
    }).listOrganizations();
    await createAction1DiscoveryClient(createCachedContext({ baseUrl: 'https://app.action1.com/api/3.0', apiKey: 'other-id', apiSecret: 'other-secret' }), {
      tokenCache: sharedCache,
      now: () => 1000
    }).listOrganizations();
    assert.deepStrictEqual(tokenCalls, ['same-id', 'other-id'], 'cache reuse must cross client instances only for the same auth context');
  }

  {
    const now = () => Date.parse('2026-08-13T20:00:00.000Z');
    assert.strictEqual(resolveRetryAfterMs({ responseHeaders: { 'retry-after': '3.5' } }, now), 3500);
    assert.strictEqual(resolveRetryAfterMs({ responseHeaders: { 'retry-after': 'Thu, 13 Aug 2026 20:00:04 GMT' } }, now), 4000);
    assert.strictEqual(computeAction1RateLimitDelayMs(null, 1), 2000);
    assert.strictEqual(computeAction1RateLimitDelayMs(null, 6), 60000);
    assert.strictEqual(computeAction1RateLimitDelayMs(3000, 1), 3000);
  }

  await assert.rejects(
    () =>
      createAction1DiscoveryClient(
        createFakeContext({
          http: async (requestOptions = {}) => {
            const url = String(requestOptions.url || '');
            if (url.endsWith('/oauth2/token')) {
              return httpJsonResponse(200, { expires_in: 3600 });
            }
            throw new Error(`Unexpected URL ${url}`);
          }
        })
      ).listOrganizations(),
    /access token/i
  );

  {
    const client = createAction1DiscoveryClient(
      createFakeContext({
        http: async (requestOptions = {}) => {
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
          }
          if (url.endsWith('/organizations')) {
            return httpJsonResponse(200, {
              data: [{ id: 'org-1', name: 'Alpha Org' }],
              value: [{ id: 'org-2', name: 'Beta Org' }]
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      })
    );

    const rows = await client.listOrganizations();
    assert.deepStrictEqual(rows, [{ organizationId: 'org-1', organizationName: 'Alpha Org' }]);
  }

  {
    const calls = [];
    const client = createAction1DiscoveryClient(
      createFakeContext({
        http: async (requestOptions = {}) => {
          const url = String(requestOptions.url || '');
          calls.push(url);
          if (url.endsWith('/oauth2/token')) {
            return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
          }
          if (url.includes('/endpoints/groups/org-1?limit=500&from=0')) {
            return httpJsonResponse(200, {
              items: [],
              next_page: '/api/3.0/endpoints/groups/org-1?limit=500&from=1',
              nextPage: '/api/3.0/endpoints/groups/org-1?limit=500&from=999',
              next: '/api/3.0/endpoints/groups/org-1?limit=500&from=998',
              nextLink: '/api/3.0/endpoints/groups/org-1?limit=500&from=997'
            });
          }
          if (url.includes('/endpoints/groups/org-1?limit=500&from=1')) {
            return httpJsonResponse(200, {
              items: 'not-an-array'
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      })
    );

    const rows = await client.listEndpointGroups('org-1');
    assert.deepStrictEqual(rows, []);
    assert.strictEqual(calls.some((url) => url.includes('from=999')), false);
  }

  {
    const calls = [];
    const client = createAction1DiscoveryClient(
      createFakeContext({
        http: async (requestOptions = {}) => {
          calls.push(requestOptions);
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
          }
          if (url.includes('/endpoints/groups/org-1?limit=500&from=0')) {
            return httpJsonResponse(200, {
              items: [{ id: 'group-1', name: 'Finance', endpoint_count: 25 }],
              total_items: 2,
              from: 0
            });
          }
          if (url.includes('/endpoints/groups/org-1?limit=500&from=1')) {
            return httpJsonResponse(200, {
              items: [{ group_id: 'group-2', display_name: 'HR', count: 9 }],
              total_items: 2,
              from: 1
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      })
    );

    const rows = await client.listEndpointGroups('org-1');
    assert.deepStrictEqual(rows, [
      { organizationId: 'org-1', endpointGroupId: 'group-1', endpointGroupName: 'Finance', endpointCount: 25 },
      { organizationId: 'org-1', endpointGroupId: 'group-2', endpointGroupName: 'HR', endpointCount: 9 }
    ]);

    const groupCalls = calls.filter((entry) => String(entry.url || '').includes('/endpoints/groups/org-1'));
    assert.deepStrictEqual(
      groupCalls.map((entry) => String(entry.url)),
      [
        'https://app.action1.com/api/3.0/endpoints/groups/org-1?limit=500&from=0',
        'https://app.action1.com/api/3.0/endpoints/groups/org-1?limit=500&from=1'
      ]
    );
    assert(groupCalls.every((entry) => entry.maxAttempts === 1), 'paged Action1 GET requests should disable generic transport retries');
  }

  {
    const retryDelayCalls = [];
    const sleepCalls = [];
    const context = createFakeContext({
      http: async (requestOptions = {}) => {
        const url = String(requestOptions.url || '');
        if (url.endsWith('/oauth2/token')) {
          return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
        }
        if (url.includes('/endpoints/groups/org-1?limit=500&from=0')) {
          if (!context.__rateLimitedOnce) {
            context.__rateLimitedOnce = true;
            throw createRateLimitedError({
              responseHeaders: { 'retry-after': '3' },
              payload: {
                error_description: 'access_token=super-secret-token authorization=Bearer sensitive-token'
              }
            });
          }
          return httpJsonResponse(200, {
            items: [{ id: 'group-1', name: 'Finance', endpoint_count: 25 }],
            total_items: 1,
            from: 0
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });

    const client = createAction1DiscoveryClient(context, {
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
      },
      computeAction1RateLimitDelayMs: (retryAfterMs, consecutive429Count) => {
        retryDelayCalls.push({ retryAfterMs, consecutive429Count });
        return Math.max(2000, retryAfterMs || 0);
      }
    });

    const rows = await client.listEndpointGroups('org-1');
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(retryDelayCalls, [{ retryAfterMs: 3000, consecutive429Count: 1 }]);
    assert.deepStrictEqual(sleepCalls, [3000]);
    assert.strictEqual(context.__loggerCalls.warn.length, 0, 'routine request diagnostics should not use host logger');
    const diagnosticText = context.__runtimeCalls.warn.join('\n');
    assert(/rate limit/i.test(diagnosticText), 'rate-limit retry diagnostics should be emitted');
    assert(/attempt/i.test(diagnosticText));
    assert(/retryAfter|delay/i.test(diagnosticText));
    assert.strictEqual(/super-secret-token|sensitive-token|authorization=Bearer/i.test(diagnosticText), false, 'retry diagnostics must be sanitized');
  }

  {
    const client = createAction1DiscoveryClient(
      createFakeContext({
        http: async (requestOptions = {}) => {
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
          }
          if (url.includes('/endpoints/groups/org-1?limit=500&from=0')) {
            throw createRateLimitedError({ responseHeaders: { 'retry-after': '1' } });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      }),
      {
        maxRetries: 0,
        sleep: async () => {}
      }
    );

    await assert.rejects(() => client.listEndpointGroups('org-1'), (error) => error && error.statusCode === 429);
  }

  {
    const client = createAction1DiscoveryClient(
      createFakeContext({
        http: async (requestOptions = {}) => {
          const url = String(requestOptions.url || '');
          if (url.endsWith('/oauth2/token')) {
            return httpJsonResponse(200, { access_token: 'token-a', expires_in: 3600 });
          }
          if (url.includes('/endpoints/groups/org-1?limit=500&from=0')) {
            return httpJsonResponse(200, {
              items: [],
              next_page: '/api/3.0/endpoints/groups/org-1?limit=500&from=0'
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      })
    );

    await assert.rejects(() => client.listEndpointGroups('org-1'), /paging loop/i);
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
