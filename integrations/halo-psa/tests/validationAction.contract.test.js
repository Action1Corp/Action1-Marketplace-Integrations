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
  const discoveryPath = require.resolve('../discoverSettingsOptions');
  const haloApiPath = require.resolve('../haloApi');
  const validatePath = require.resolve('../validate');
  delete require.cache[actionsPath];
  delete require.cache[discoveryPath];
  delete require.cache[haloApiPath];
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
    assert(result.message.includes('required'), 'missing settings should return a clear required-fields message');
    assert.strictEqual(fetchCalls, 0, 'missing settings should not trigger external HTTP calls');
  });
}

async function testStoredSecretFallbackAndSuccessfulReadOnlyValidation() {
  const calls = [];
  await withMockedFetch(async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }

    if (String(url).includes('/api/Team?$top=1')) {
      return {
        ok: true,
        json: async () => ([])
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext({
        HaloPsaClientSecret: 'stored-secret-value'
      })
    }, {
      settings: {
        HaloPsaResourceServer: 'https://halo.example.com',
        HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
        HaloPsaClientId: 'client-id-123',
        HaloPsaExistingOpenTicketBehavior: 'skip_existing_open',
        HaloPsaCloseWhenSignalClears: 'false',
        HaloPsaVulnerabilityTicketModel: 'grouped',
        HaloPsaMaxOpenTicketsPerOrganization: '30',
        _secretModes: {
          HaloPsaClientSecret: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'valid Halo settings should pass validation');
    assert(result.message.includes('Connected'), 'successful validation should return a connected message');
    assert.strictEqual(calls.length, 2, 'successful validation should perform token acquisition and one read-only call');
    assert(calls[0].url.endsWith('/token'), 'first call should acquire a token');
    assert(calls[1].url.includes('/api/Team?$top=1'), 'second call should be a read-only discovery request');
    assert(!calls.some((call) => call.url.includes('/Tickets')), 'validation must not call ticket write endpoints');
    assert(!calls.some((call) => call.url.includes('/Actions')), 'validation must remain read-only even when behavior settings are present');
  });
}

async function testFailedTokenAcquisitionReturnsSafeFailure() {
  await withMockedFetch(async (url) => {
    assert(String(url).endsWith('/token'), 'token failure test should only call token endpoint');
    return {
      ok: false,
      status: 401,
      json: async () => ({
        error_description: 'invalid client secret stored-secret-value'
      })
    };
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext()
    }, {
      settings: {
        HaloPsaResourceServer: 'https://halo.example.com',
        HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
        HaloPsaClientId: 'client-id-123',
        HaloPsaClientSecret: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, false, 'failed token acquisition should fail validation');
    assert(result.message.startsWith('Failed:'), 'failed token acquisition should return a safe failure prefix');
    assert(!result.message.includes('stored-secret-value'), 'failure message must not leak Halo client secret');
    assert(!result.message.toLowerCase().includes('bearer'), 'failure message must not leak raw bearer information');
  });
}

async function testFailedReadOnlyCallReturnsSafeFailureWithoutDbWrites() {
  let dbWriteTouched = false;
  await withMockedFetch(async (url) => {
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }

    if (String(url).includes('/api/Team?$top=1')) {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: 'read forbidden for bearer halo-token'
        })
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['validate-configuration']({
      settings: createSettingsContext(),
      db: {
        async run() {
          dbWriteTouched = true;
          throw new Error('db.run should not be called during validation');
        }
      }
    }, {
      settings: {
        HaloPsaResourceServer: 'https://halo.example.com',
        HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
        HaloPsaClientId: 'client-id-123',
        HaloPsaClientSecret: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, false, 'failed read-only Halo call should fail validation');
    assert(result.message.startsWith('Failed:'), 'read-only failure should return a safe failure prefix');
    assert(!result.message.includes('halo-token'), 'failure message must not leak bearer tokens');
    assert.strictEqual(dbWriteTouched, false, 'validation must not write DB state');
  });
}

async function run() {
  await testMissingSettingsReturnsFailureWithoutHttp();
  await testStoredSecretFallbackAndSuccessfulReadOnlyValidation();
  await testFailedTokenAcquisitionReturnsSafeFailure();
  await testFailedReadOnlyCallReturnsSafeFailureWithoutDbWrites();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
