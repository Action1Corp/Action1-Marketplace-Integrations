const assert = require('assert');

const { createAction1Client, __private } = require('../action1Api');

async function run() {
  await runRateLimitRetryParityTest();
  await runAutomationLookbackStopParityTest();
  await runMissingUpdateNestedVersionParityTest();
  await runTokenReuseWhileFreshTest();
  await runTokenRefreshInsideSafetyMarginTest();
  await runLongRunningCollectionUsesRefreshedTokenAcrossPhasesTest();
  await runMarketplaceBaseUrlValidationTest();
  runPrivateParityShapeTest();
}

async function runMarketplaceBaseUrlValidationTest() {
  const client = createAction1Client({ httpClient: { async requestJson() { throw new Error('request should not be reached'); } } });
  for (const baseUrl of ['', 'not-a-url']) {
    const context = {
      action1: {
        async getCredentials() {
          return { apiKey: 'action1-client-id', apiSecret: 'action1-client-secret', baseUrl };
        }
      }
    };
    await assert.rejects(
      () => client.listEndpoints('org-1', { context }),
      (error) => error?.diagnostic?.response?.errorCode === 'invalid_action1_base_url',
      `invalid Marketplace baseUrl should fail safely: ${baseUrl || 'missing'}`
    );
  }
}

async function runRateLimitRetryParityTest() {
  const recordedDelays = [];
  const emitted = [];
  const originalSetTimeout = global.setTimeout;
  let endpointAttempts = 0;

  global.setTimeout = (handler, delay, ...args) => {
    recordedDelays.push(Number(delay));
    handler(...args);
    return 0;
  };

  try {
    const client = createAction1Client({
      runLogger: {
        async emit(event) {
          emitted.push(event);
        }
      },
      httpClient: {
        async requestJson(input) {
          if (input.method === 'POST') {
            return {
              data: {
                access_token: 'token-1',
                expires_in: 3600
              }
            };
          }

          if (input.method === 'GET' && String(input.url).includes('/endpoints/managed/org-1')) {
            endpointAttempts += 1;
            if (endpointAttempts < 3) {
              const error = new Error('rate limited');
              error.statusCode = 429;
              error.code = 'RATE_LIMITED';
              error.retryAfterMs = 0;
              error.responseHeaders = { 'retry-after': '0' };
              throw error;
            }

            return {
              data: {
                items: [{ id: 'ep-1', name: 'Endpoint One' }],
                from: 0,
                total_items: 1
              }
            };
          }

          throw new Error(`Unexpected request ${input.method} ${input.url}`);
        }
      }
    });

    const rows = await client.listEndpoints('org-1', {
      connection: {
        baseUrl: 'https://app.action1.com/api/3.0',
        clientId: 'client-id',
        clientSecret: 'client-secret'
      },
      runId: 'jira-action1-429-test'
    });

    assert.strictEqual(rows.length, 1, 'collection should eventually recover after Halo-style Action1 retries');
    assert.deepStrictEqual(recordedDelays, [2000, 4000], '429 retry delays should match Halo Action1 backoff rather than sub-second loops');
    assert.strictEqual(emitted.some((entry) => entry.message === '[Action1][rate-limit] 429'), true, 'rate-limit retries should emit the Halo Action1 warning');
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

async function runAutomationLookbackStopParityTest() {
  const requests = [];
  const client = createAction1Client({
    httpClient: {
      async requestJson(input) {
        requests.push({ method: input.method, url: String(input.url) });
        if (input.method === 'POST') {
          return {
            data: {
              access_token: 'token-1',
              expires_in: 3600
            }
          };
        }

        if (String(input.url).includes('/automations/instances/org-1?')) {
          return {
            data: {
              items: [
                { id: 'recent-1', end_time: '2026-06-24_20-00-00', name: 'Recent' },
                { id: 'old-1', end_time: '2026-05-01_10-00-00', name: 'Old' }
              ],
              from: 0,
              total_items: 2
            }
          };
        }

        if (String(input.url).includes('/automations/instances/org-1/recent-1/endpoint-results')) {
          return {
            data: {
              items: [{ id: 'ep-1', status: 'Error' }],
              from: 0,
              total_items: 1
            }
          };
        }

        throw new Error(`Unexpected request ${input.method} ${input.url}`);
      }
    }
  });

  const meta = {};
  const rows = await client.listAutomationFailuresByOrg('org-1', {
    connection: {
      baseUrl: 'https://app.action1.com/api/3.0',
      clientId: 'client-id',
      clientSecret: 'client-secret'
    },
    cutoffEndTime: '2026-06-24_00-00-00',
    watermarkEndTime: '',
    meta,
    runId: 'jira-action1-automation-test'
  });

  assert.strictEqual(rows.length, 1, 'only in-scope automation failures should be returned');
  assert.strictEqual(requests.some((entry) => entry.url.includes('/automations/instances/org-1/old-1/endpoint-results')), false, 'old automation instances should not be fanned out');
  assert.strictEqual(meta.instancesSeen, 2, 'meta should record every top-level automation instance inspected before stop');
  assert.strictEqual(meta.instancesSkippedOld, 1, 'meta should record the stop caused by the lookback/watermark cutoff');
  assert.strictEqual(meta.instancesQualified, 1, 'meta should count only in-scope instances that were fanned out');
}

async function runMissingUpdateNestedVersionParityTest() {
  const requests = [];
  const client = createAction1Client({
    httpClient: {
      async requestJson(input) {
        requests.push({ method: input.method, url: String(input.url) });
        if (input.method === 'POST') {
          return {
            data: {
              access_token: 'token-1',
              expires_in: 3600
            }
          };
        }

        if (String(input.url).includes('/updates/org-1?')) {
          return {
            data: {
              items: [
                {
                  id: 'pkg-1',
                  package_name: 'Pkg One',
                  security_severity: 'Important',
                  update_sla_status: 'Overdue',
                  versions: [{ id: 'ver-1', version_name: '1.0.0' }]
                }
              ],
              from: 0,
              total_items: 1
            }
          };
        }

        if (String(input.url).includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
          return {
            data: {
              items: [{ id: 'ep-1' }],
              from: 0,
              total_items: 1
            }
          };
        }

        throw new Error(`Unexpected request ${input.method} ${input.url}`);
      }
    }
  });

  const rows = await client.listMissingUpdatesByOrg('org-1', {
    connection: {
      baseUrl: 'https://app.action1.com/api/3.0',
      clientId: 'client-id',
      clientSecret: 'client-secret'
    },
    filter: {
      enabled: true,
      severities: ['IMPORTANT'],
      remediationStatuses: ['OVERDUE']
    },
    runId: 'jira-action1-updates-test'
  });

  assert.strictEqual(rows.length, 1, 'nested Halo-style version descriptors should produce endpoint fan-out rows');
  assert.strictEqual(requests.some((entry) => entry.url.includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')), true, 'deep update endpoint fetch should use the extracted package/version identity');
}

async function runTokenReuseWhileFreshTest() {
  let currentMs = 0;
  let credentialCalls = 0;
  const requests = [];
  const client = createAction1Client({
    now: () => currentMs,
    httpClient: {
      async requestJson(input) {
        requests.push({
          method: input.method,
          url: String(input.url),
          headers: input.headers || null
        });

        if (input.method === 'POST') {
          return {
            data: {
              access_token: 'token-a',
              expires_in: 3600
            }
          };
        }

        if (String(input.url).includes('/endpoints/managed/org-1')) {
          return {
            data: {
              items: [{ id: 'ep-1', name: 'Endpoint One' }],
              from: 0,
              total_items: 1
            }
          };
        }

        throw new Error(`Unexpected request ${input.method} ${input.url}`);
      }
    }
  });

  const context = {
    action1: {
      async getCredentials() {
        credentialCalls += 1;
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret',
          baseUrl: 'https://app.na-2.action1.com/api/3.0/'
        };
      }
    }
  };

  await client.listEndpoints('org-1', {
    context,
    runId: 'jira-action1-token-reuse-1'
  });

  currentMs = 1_000;

  await client.listEndpoints('org-1', {
    context,
    runId: 'jira-action1-token-reuse-2'
  });

  const tokenCalls = requests.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/oauth2/token'));
  const getCalls = requests.filter((entry) => entry.method === 'GET' && entry.url.includes('/endpoints/managed/org-1'));

  assert.strictEqual(credentialCalls >= 1, true, 'Jira Action1 runtime should load credentials from Marketplace context');
  assert.strictEqual(tokenCalls.length, 1, 'fresh Action1 tokens should be reused until they enter the 60-second safety margin');
  assert.strictEqual(getCalls.length, 2, 'the same Jira Action1 client instance should serve multiple collection calls');
  assert.strictEqual(getCalls.every((entry) => entry.headers.Authorization === 'Bearer token-a'), true, 'fresh Action1 collection requests should reuse the cached bearer token');
  assert.strictEqual(tokenCalls[0].url, 'https://app.na-2.action1.com/api/3.0/oauth2/token', 'token acquisition should use the Marketplace regional Action1 base URL');
  assert.strictEqual(getCalls.every((entry) => entry.url.startsWith('https://app.na-2.action1.com/api/3.0/')), true, 'main sync Action1 requests should use the Marketplace regional Action1 base URL');
}

async function runTokenRefreshInsideSafetyMarginTest() {
  let currentMs = 0;
  let tokenCounter = 0;
  const requests = [];
  const client = createAction1Client({
    now: () => currentMs,
    httpClient: {
      async requestJson(input) {
        requests.push({
          method: input.method,
          url: String(input.url),
          headers: input.headers || null
        });

        if (input.method === 'POST') {
          tokenCounter += 1;
          return {
            data: {
              access_token: tokenCounter === 1 ? 'token-a' : 'token-b',
              expires_in: 3600
            }
          };
        }

        if (String(input.url).includes('/endpoints/managed/org-1')) {
          return {
            data: {
              items: [{ id: 'ep-1', name: 'Endpoint One' }],
              from: 0,
              total_items: 1
            }
          };
        }

        throw new Error(`Unexpected request ${input.method} ${input.url}`);
      }
    }
  });

  const context = {
    action1: {
      async getCredentials() {
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret',
          baseUrl: 'https://app.na-2.action1.com/api/3.0'
        };
      }
    }
  };

  await client.listEndpoints('org-1', {
    context,
    runId: 'jira-action1-token-refresh-1'
  });

  currentMs = (3600 - 61) * 1000;

  await client.listEndpoints('org-1', {
    context,
    runId: 'jira-action1-token-refresh-2'
  });

  currentMs = (3600 - 59) * 1000;

  await client.listEndpoints('org-1', {
    context,
    runId: 'jira-action1-token-refresh-3'
  });

  const tokenCalls = requests.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/oauth2/token'));
  const endpointCalls = requests.filter((entry) => entry.method === 'GET' && entry.url.includes('/endpoints/managed/org-1'));

  assert.strictEqual(tokenCalls.length, 2, 'Jira Action1 runtime should refresh once the cached token enters the 60-second safety margin');
  assert.strictEqual(endpointCalls[1].headers.Authorization, 'Bearer token-a', 'requests outside the safety margin should keep the original cached token');
  assert.strictEqual(endpointCalls[2].headers.Authorization, 'Bearer token-b', 'requests inside the safety margin should use the replacement token');
}

async function runLongRunningCollectionUsesRefreshedTokenAcrossPhasesTest() {
  let currentMs = 0;
  let tokenCounter = 0;
  const requests = [];
  const client = createAction1Client({
    now: () => currentMs,
    httpClient: {
      async requestJson(input) {
        requests.push({
          method: input.method,
          url: String(input.url),
          headers: input.headers || null
        });

        if (input.method === 'POST') {
          tokenCounter += 1;
          return {
            data: {
              access_token: tokenCounter === 1 ? 'token-a' : 'token-b',
              expires_in: 3600
            }
          };
        }

        if (String(input.url).includes('/endpoints/managed/org-1')) {
          return {
            data: {
              items: [{ id: 'ep-1', name: 'Endpoint One' }],
              from: 0,
              total_items: 1
            }
          };
        }

        if (String(input.url).includes('/updates/org-1?')) {
          return {
            data: {
              items: [
                {
                  id: 'pkg-1',
                  package_name: 'Pkg One',
                  security_severity: 'Important',
                  update_sla_status: 'Overdue',
                  versions: [{ id: 'ver-1', version_name: '1.0.0' }]
                }
              ],
              from: 0,
              total_items: 1
            }
          };
        }

        if (String(input.url).includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
          return {
            data: {
              items: [{ id: 'ep-1' }],
              from: 0,
              total_items: 1
            }
          };
        }

        if (String(input.url).includes('/automations/instances/org-1?')) {
          return {
            data: {
              items: [{ id: 'inst-1', end_time: '2026-06-24_20-00-00', name: 'Automation One' }],
              from: 0,
              total_items: 1
            }
          };
        }

        if (String(input.url).includes('/automations/instances/org-1/inst-1/endpoint-results')) {
          return {
            data: {
              items: [{ id: 'ep-1', status: 'Error' }],
              from: 0,
              total_items: 1
            }
          };
        }

        throw new Error(`Unexpected request ${input.method} ${input.url}`);
      }
    }
  });

  const context = {
    action1: {
      async getCredentials() {
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret',
          baseUrl: 'https://app.na-2.action1.com/api/3.0'
        };
      }
    }
  };

  await client.listEndpoints('org-1', {
    context,
    runId: 'jira-action1-long-run-endpoints'
  });

  currentMs = (3600 - 59) * 1000;

  await client.listMissingUpdatesByOrg('org-1', {
    context,
    runId: 'jira-action1-long-run-updates',
    filter: {
      enabled: true,
      severities: ['IMPORTANT'],
      remediationStatuses: ['OVERDUE']
    }
  });

  currentMs += 1_000;

  await client.listAutomationFailuresByOrg('org-1', {
    context,
    runId: 'jira-action1-long-run-automation',
    cutoffEndTime: '',
    watermarkEndTime: ''
  });

  const tokenCalls = requests.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/oauth2/token'));
  const endpointCall = requests.find((entry) => entry.method === 'GET' && entry.url.includes('/endpoints/managed/org-1'));
  const updateCalls = requests.filter((entry) => entry.method === 'GET' && entry.url.includes('/updates/org-1'));
  const automationCalls = requests.filter((entry) => entry.method === 'GET' && entry.url.includes('/automations/instances/org-1'));

  assert.strictEqual(tokenCalls.length, 2, 'long-running Jira Action1 collection should refresh the token once it enters the safety margin');
  assert.strictEqual(endpointCall.headers.Authorization, 'Bearer token-a', 'earlier collection phases should use the original cached token');
  assert.strictEqual(updateCalls.every((entry) => entry.headers.Authorization === 'Bearer token-b'), true, 'later update collection phases should use the refreshed token');
  assert.strictEqual(automationCalls.every((entry) => entry.headers.Authorization === 'Bearer token-b'), true, 'later automation-failed collection phases should keep using the refreshed token on the same client instance');
}

function runPrivateParityShapeTest() {
  assert.strictEqual(typeof __private.buildUpdateServerFilterPlan, 'function', 'Jira should expose the Halo-style update filter planning helper for parity coverage');
  assert.strictEqual(typeof __private.buildVulnerabilityServerFilterPlan, 'function', 'Jira should expose the Halo-style vulnerability filter planning helper for parity coverage');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
