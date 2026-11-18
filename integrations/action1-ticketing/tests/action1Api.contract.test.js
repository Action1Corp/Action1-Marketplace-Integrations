const assert = require('assert');
const { createAction1Client, loadAction1Credentials, sanitizeMessage } = require('../action1Api');

const connection = {
  baseUrl: 'https://app.na-2.action1.com/api/3.0/',
  clientId: 'synthetic-key',
  clientSecret: 'synthetic-secret'
};

function makeClient(respond, options = {}) {
  const calls = [];
  const httpClient = {
    async requestJson(request) {
      calls.push(request);
      return respond(request, calls.length);
    }
  };
  return { client: createAction1Client({ httpClient, ...options }), calls };
}

async function testMarketplaceCredentialFailuresPrecedeRequests() {
  let calls = 0;
  const client = createAction1Client({ httpClient: { async requestJson() { calls += 1; } } });
  await assert.rejects(client.listOrganizations({ context: { action1: { async getCredentials() { return { apiKey: 'key', apiSecret: '', baseUrl: connection.baseUrl }; } } } }), (error) => /credentials are incomplete/i.test(error?.diagnostic?.response?.errorMessage));
  await assert.rejects(client.listOrganizations({ connection: { ...connection, baseUrl: 'not a URL' } }), /valid absolute URL/i);
  await assert.rejects(client.listOrganizations({ connection: { ...connection, clientSecret: '  ' } }), /clientSecret is required/i);
  assert.strictEqual(calls, 0, 'credential and connection failures happen before transport');
  await assert.rejects(loadAction1Credentials({ action1: { async getCredentials() { return { apiKey: '', apiSecret: 'secret', baseUrl: connection.baseUrl }; } } }), /Action1 organization discovery failed/i);
}

async function testTokenAcquisitionValidationAndRegionalPath() {
  const { client, calls } = makeClient((request) => ({ statusCode: 200, data: { access_token: 'synthetic-token', expires_in: 120 } }));
  assert.strictEqual(await client.getAccessToken(connection), 'synthetic-token');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://app.na-2.action1.com/api/3.0/oauth2/token');
  assert.deepStrictEqual(calls[0].body, { grant_type: 'client_credentials', client_id: 'synthetic-key', client_secret: 'synthetic-secret' });

  const missing = makeClient(() => ({ statusCode: 200, data: {} }));
  await assert.rejects(missing.client.getAccessToken(connection), /did not include access_token/i);
}

async function testTokenReuseAndRefreshMargin() {
  let now = 0;
  let issued = 0;
  const { client, calls } = makeClient((request) => {
    if (request.method === 'POST') return { statusCode: 200, data: { access_token: `token-${++issued}`, expires_in: 120 } };
    return { statusCode: 200, data: { items: [] } };
  }, { now: () => now });

  assert.strictEqual(await client.getAccessToken(connection), 'token-1');
  now = 59000;
  assert.strictEqual(await client.getAccessToken(connection), 'token-1', 'token remains reusable outside the 60-second margin');
  now = 60000;
  assert.strictEqual(await client.getAccessToken(connection), 'token-2', 'token refreshes at the 60-second safety margin');
  assert.strictEqual(calls.filter((call) => call.method === 'POST').length, 2);
}

async function testContinuationPrecedenceOffsetPageLimitAndLoopProtection() {
  const pages = [];
  const { client, calls } = makeClient((request) => {
    if (request.method === 'POST') return { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } };
    const url = new URL(request.url);
    pages.push(url.toString());
    if (pages.length === 1) {
      return { statusCode: 200, data: { items: [{ id: '1', name: ' One ' }, { id: '2', name: 'Two' }], next_page: '/api/3.0/page-2', nextPage: '/wrong', total_items: 99, from: 0 } };
    }
    return { statusCode: 200, data: { items: [{ id: '3', name: 'Three' }], from: 2, total_items: 3 } };
  });
  const rows = await client.listOrganizations({ connection, pageLimit: 2 });
  assert.deepStrictEqual(rows, [{ id: '1', name: 'One' }, { id: '2', name: 'Two' }, { id: '3', name: 'Three' }]);
  assert.strictEqual(pages[1], 'https://app.na-2.action1.com/api/3.0/page-2', 'next_page takes precedence and resolves against the Action1 API path');
  assert.strictEqual(calls.filter((call) => call.method === 'GET').length, 2);

  let offsetCount = 0;
  const offset = makeClient((request) => {
    if (request.method === 'POST') return { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } };
    offsetCount += 1;
    return offsetCount === 1
      ? { statusCode: 200, data: { items: [{ id: '1', name: 'One' }], from: 0, total_items: 2, nextPage: '', next: '', nextLink: '' } }
      : { statusCode: 200, data: { items: [{ id: '2', name: 'Two' }], from: 1, total_items: 2 } };
  });
  assert.strictEqual((await offset.client.listOrganizations({ connection })).length, 2, 'offset paging reaches the final page');
  assert(new URL(offset.calls[2].url).searchParams.get('from') === '1', 'offset continuation advances by the current page item count');

  const loop = makeClient((request) => request.method === 'POST'
    ? { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } }
    : { statusCode: 200, data: { items: [{ id: '1', name: 'One' }], next: request.url } });
  await assert.rejects(loop.client.listOrganizations({ connection }), /paging loop detected/i);

  const limit = makeClient((request) => request.method === 'POST'
    ? { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } }
    : { statusCode: 200, data: { items: [{ id: String(request.url), name: 'Page' }], next: new URL('/next', request.url).toString() } });
  await assert.rejects(limit.client.listOrganizations({ connection, pageLimit: 1 }), /paging exceeded limit 1/i);
}

async function testRateLimitRetryAfterBudgetAndDefaultUnboundedMode() {
  const delayValues = [];
  let resourceCalls = 0;
  const { client, calls } = makeClient((request) => {
    if (request.method === 'POST') return { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } };
    resourceCalls += 1;
    if (resourceCalls === 1) {
      const error = new Error('rate limited');
      error.statusCode = 429;
      error.responseHeaders = { 'retry-after': '3' };
      throw error;
    }
    return { statusCode: 200, data: { items: [{ id: 'org', name: 'Org' }] } };
  }, { sleep: async (ms) => delayValues.push(ms), action1RateLimitMaxRetries: 1 });
  assert.strictEqual((await client.listOrganizations({ connection })).length, 1);
  assert.deepStrictEqual(delayValues, [3000], 'Retry-After is honored without retrying sooner than the local schedule');
  assert.strictEqual(calls.filter((call) => call.method === 'GET').length, 2);
  assert(calls.filter((call) => call.method === 'GET').every((call) => call.maxAttempts === 1), 'transport retries are disabled for Action1 GETs owned by the specific retry loop');

  const limited = makeClient((request) => {
    if (request.method === 'POST') return { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } };
    const error = new Error('limited'); error.code = 'RATE_LIMITED'; throw error;
  }, { action1RateLimitMaxRetries: 0, sleep: async () => { throw new Error('zero retry budget must not sleep'); } });
  await assert.rejects(limited.client.listOrganizations({ connection }), (error) => error.code === 'RATE_LIMITED');
  assert.strictEqual(limited.calls.filter((call) => call.method === 'GET').length, 1);

  const defaultMode = makeClient((request) => {
    if (request.method === 'POST') return { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } };
    if (resourceCalls < 3) { resourceCalls += 1; const error = new Error('limited'); error.statusCode = 429; throw error; }
    return { statusCode: 200, data: { items: [] } };
  }, { sleep: async () => {} });
  assert.deepStrictEqual(await defaultMode.client.listOrganizations({ connection }), [], 'unspecified retry budget preserves the documented unbounded 429 retry mode');
}

async function testOrganizationNormalizationDedupAndSecretRedaction() {
  const { client } = makeClient((request) => request.method === 'POST'
    ? { statusCode: 200, data: { access_token: 'token', expires_in: 3600 } }
    : { statusCode: 200, data: { items: [
      { id: ' 1 ', name: ' One ' }, { org_id: '1', org_name: 'One' }, { id: '1', name: 'Renamed' }, { id: '2', name: '' }
    ] } });
  assert.deepStrictEqual(await client.listOrganizations({ connection }), [
    { id: '1', name: 'One' }, { id: '1', name: 'Renamed' }
  ], 'organization rows are trimmed, invalid rows discarded, and composite duplicates removed');
  const sanitized = sanitizeMessage('Bearer token access_token=abc client_secret=shh apiSecret=private authorization: Basic xyz');
  assert(!sanitized.includes('abc') && !sanitized.includes('shh') && !sanitized.includes('private') && !sanitized.includes('Basic xyz'));
}

async function run() {
  await testMarketplaceCredentialFailuresPrecedeRequests();
  await testTokenAcquisitionValidationAndRegionalPath();
  await testTokenReuseAndRefreshMargin();
  await testContinuationPrecedenceOffsetPageLimitAndLoopProtection();
  await testRateLimitRetryAfterBudgetAndDefaultUnboundedMode();
  await testOrganizationNormalizationDedupAndSecretRedaction();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
