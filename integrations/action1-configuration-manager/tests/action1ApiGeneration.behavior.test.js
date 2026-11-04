const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createAction1DiscoveryClient,
  resolveApiGeneration,
  resolveCanonicalConnection
} = require('../action1DiscoveryClient');

function contextFor(baseUrl) {
  const calls = { credentials: 0, http: 0 };
  const credentials = { apiKey: 'synthetic-client-id', apiSecret: 'synthetic-client-secret' };
  if (baseUrl !== undefined) credentials.baseUrl = baseUrl;
  const noop = () => {};
  return {
    calls,
    action1: {
      async getCredentials() {
        calls.credentials += 1;
        return credentials;
      }
    },
    async http() {
      calls.http += 1;
      throw new Error('Unexpected HTTP request');
    },
    logger: { info: noop, warn: noop, error: noop },
    action1ConfigurationManagerRuntimeLogger: { debug: noop, info: noop, warn: noop, error: noop }
  };
}

const cases = [
  ['missing baseUrl retains the default', undefined, 'https://app.action1.com/api/3.0', 3],
  ['explicit API 3.0', 'https://app.action1.com/api/3.0', 'https://app.action1.com/api/3.0', 3],
  ['API 3.x minor version', 'https://app.action1.com/api/3.1', 'https://app.action1.com/api/3.1', 3],
  ['explicit API 4.0', 'https://app.action1.com/api/4.0', 'https://app.action1.com/api/4.0', 4],
  ['API 4.x minor version', 'https://app.action1.com/api/4.2', 'https://app.action1.com/api/4.2', 4],
  ['regional host', 'https://app.eu.action1.com/api/4.0', 'https://app.eu.action1.com/api/4.0', 4],
  ['generation comes from the path rather than the host', 'https://api4.action1.test/api/3.1', 'https://api4.action1.test/api/3.1', 3],
  ['API 3 trailing slash', 'https://app.au.action1.com/api/3.0/', 'https://app.au.action1.com/api/3.0', 3],
  ['API 4 trailing slash', 'https://app.action1.com/api/4.0/', 'https://app.action1.com/api/4.0', 4]
];

for (const [label, suppliedUrl, effectiveUrl, generation] of cases) {
  test(label, async () => {
    const context = contextFor(suppliedUrl);
    const connection = await resolveCanonicalConnection(context);
    assert.deepEqual(connection, {
      baseUrl: effectiveUrl,
      clientId: 'synthetic-client-id',
      clientSecret: 'synthetic-client-secret',
      apiGeneration: generation
    });
    assert.equal(resolveApiGeneration(connection.baseUrl), generation);
    assert.equal(context.calls.credentials, 1);
    assert.equal(context.calls.http, 0);
  });
}

test('explicit internal connection also resolves generation without reading Marketplace credentials', async () => {
  const context = contextFor();
  const connection = await resolveCanonicalConnection(context, {
    baseUrl: 'https://app.action1.com/api/4.1/',
    clientId: ' synthetic-explicit-id ',
    clientSecret: ' synthetic-explicit-secret '
  });
  assert.deepEqual(connection, {
    baseUrl: 'https://app.action1.com/api/4.1',
    clientId: 'synthetic-explicit-id',
    clientSecret: 'synthetic-explicit-secret',
    apiGeneration: 4
  });
  assert.equal(context.calls.credentials, 0);
});

for (const major of [2, 5]) {
  test(`unsupported generation ${major} fails safely before token or resource requests`, async () => {
    const context = contextFor(`https://app.action1.com/api/${major}.0`);
    const isSafeFailure = (error) => {
      assert.match(error.message, /unsupported.*generation|generation.*unsupported/i);
      assert.match(error.message, /3\.x.*4\.x/);
      assert(error.message.length < 160);
      assert(!error.message.includes('synthetic-client'));
      return true;
    };
    assert.throws(() => resolveApiGeneration(`https://app.action1.com/api/${major}.0`), isSafeFailure);
    await assert.rejects(() => resolveCanonicalConnection(context), isSafeFailure);
    await assert.rejects(() => createAction1DiscoveryClient(context).listOrganizations(), isSafeFailure);
    await assert.rejects(() => createAction1DiscoveryClient(context).requestAction1Mutation({
      method: 'POST', path: '/automations/schedules/org-1', body: { name: 'unchanged legacy body' }
    }), isSafeFailure);
    assert.equal(context.calls.http, 0);
  });
}
