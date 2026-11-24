const assert = require('assert');
const {
  createConnectWiseApi,
  resolveConnectWiseBaseUrl,
  validateConnectWiseConnection
} = require('../providers/connectwiseApi');

function response(status, data, headers = {}) {
  return { status, data, headers };
}

async function run() {
  const baseConnection = { CompanyId: 'tenant', PublicApiKey: 'public', PrivateApiKey: 'private', ApiRegion: 'NA' };
  assert.strictEqual(resolveConnectWiseBaseUrl(baseConnection), 'https://api-na.myconnectwise.net/v4_6_release/apis/3.0');
  assert.strictEqual(resolveConnectWiseBaseUrl({ ...baseConnection, ApiRegion: 'EU' }), 'https://api-eu.myconnectwise.net/v4_6_release/apis/3.0');
  assert.strictEqual(resolveConnectWiseBaseUrl({ ...baseConnection, ApiRegion: 'AU' }), 'https://api-au.myconnectwise.net/v4_6_release/apis/3.0');
  assert.strictEqual(resolveConnectWiseBaseUrl({ ...baseConnection, ApiRegion: 'CUSTOM', CustomServer: 'https://psa.example.test' }), 'https://psa.example.test/v4_6_release/apis/3.0');
  for (const CustomServer of [
    'http://psa.example.test', 'https://user:pass@psa.example.test',
    'https://psa.example.test/path', 'https://psa.example.test/?q=x',
    'https://psa.example.test/#frag', 'https://127.0.0.1'
  ]) {
    assert.throws(() => resolveConnectWiseBaseUrl({ ...baseConnection, ApiRegion: 'CUSTOM', CustomServer }), /server|url|invalid/i);
  }
  assert.strictEqual(validateConnectWiseConnection(baseConnection).ok, true);
  assert.strictEqual(validateConnectWiseConnection({ ...baseConnection, ApiRegion: 'CUSTOM' }).ok, false);

  const calls = [];
  const api = createConnectWiseApi({ clientId: 'synthetic-action1-client-id' });
  const transport = async (options) => {
    calls.push(options);
    return response(200, { ok: true });
  };
  const result = await api.request({
    transport, connection: baseConnection, path: '/service/boards',
    query: { conditions: "name='A & B'", pageSize: 1 }
  });
  assert.deepStrictEqual(result, { statusCode: 200, headers: {}, data: { ok: true } });
  assert.strictEqual(calls.length, 1);
  assert(calls[0].url.includes('conditions=name%3D%27A+%26+B%27'));
  assert.strictEqual(calls[0].method, 'GET');
  assert.strictEqual(calls[0].timeoutMs, 15000);
  assert.strictEqual(calls[0].maxAttempts, 3);
  assert.strictEqual(calls[0].headers.Authorization, `Basic ${Buffer.from('tenant+public:private').toString('base64')}`);
  assert.strictEqual(calls[0].headers.clientId, 'synthetic-action1-client-id');
  assert.strictEqual(calls[0].headers.Accept, 'application/vnd.connectwise.com+json; version=2026.11');
  assert(!JSON.stringify(result).includes('private'));
  assert(!JSON.stringify(result).includes('synthetic-action1-client-id'));

  let objectRequest;
  const objectTransport = { async request(options) { objectRequest = options; return { statusCode: 200, payload: [], responseHeaders: { etag: 'x' } }; } };
  const objectResult = await api.request({ transport: objectTransport, connection: baseConnection, path: '/company/companies' });
  assert.strictEqual(objectRequest.method, 'GET');
  assert.deepStrictEqual(objectResult, { statusCode: 200, headers: { etag: 'x' }, data: [] });

  const bodyApi = createConnectWiseApi({ clientId: 'synthetic-action1-client-id' });
  let bodyRequest;
  const bodyTransport = async (options) => { bodyRequest = options; return { status: 200, body: { accepted: true } }; };
  await bodyApi.request({ transport: bodyTransport, connection: baseConnection, method: 'POST', path: '/sample', body: { x: 1 } });
  assert.deepStrictEqual(bodyRequest.data, { x: 1 }, 'Marketplace request body is forwarded under data');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(bodyRequest, 'body'), false);

  await assert.rejects(() => api.request({
    transport: async () => response(400, 'Invalid Token'), connection: baseConnection, path: '/system/info'
  }), (error) => error.code === 'CONNECTWISE_AUTHENTICATION_FAILED' && error.statusCode === 400);
  await assert.rejects(() => api.request({
    transport: async () => response(403, { message: 'not permitted' }), connection: baseConnection, path: '/service/boards'
  }), (error) => error.code === 'CONNECTWISE_PERMISSION_DENIED');
  await assert.rejects(() => api.request({
    transport: async () => response(400, { errors: [{ code: 'Unauthorized', message: 'synthetic private value' }] }),
    connection: baseConnection, path: '/service/boards'
  }), (error) => error.code === 'CONNECTWISE_PERMISSION_DENIED' && !error.message.includes('synthetic private value'));
  await assert.rejects(() => api.request({
    transport: async () => { throw Object.assign(new Error('host wrapper'), { response: { statusCode: 403, payload: 'Permission denied', responseHeaders: { 'content-type': 'text/plain' } } }); },
    connection: baseConnection, path: '/company/companies'
  }), (error) => error.code === 'CONNECTWISE_PERMISSION_DENIED' && error.statusCode === 403);
  await assert.rejects(() => api.request({
    transport: async () => { throw Object.assign(new Error('synthetic-network-secret'), { code: 'ETIMEDOUT' }); },
    connection: baseConnection, path: '/system/info'
  }), (error) => error.code === 'CONNECTWISE_NETWORK_ERROR' && !error.message.includes('synthetic-network-secret'));

  console.log('ConnectWise API contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
