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
    throw new Error('fetch should not be called when discovery config is incomplete');
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-halo-settings-options']({
      settings: createSettingsContext()
    }, {
      settings: {}
    });

    assert.strictEqual(result.ok, false, 'missing settings should fail discovery');
    assert(result.message.includes('required'), 'missing settings should return a clear required-fields message');
    assert.strictEqual(fetchCalls, 0, 'missing settings should not trigger external HTTP calls');
  });
}

async function testSuccessfulDiscoveryReturnsNormalizedOptions() {
  const calls = [];
  await withMockedFetch(async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }

    if (String(url).includes('/api/Team?$top=200')) {
      return {
        ok: true,
        json: async () => ([{ id: 7, name: 'Service Desk' }])
      };
    }

    if (String(url).includes('/api/TicketType?$top=200')) {
      return {
        ok: true,
        json: async () => ({ ticketTypes: [{ id: '12', name: 'Incident' }] })
      };
    }

    if (String(url).includes('/api/Status?$top=200')) {
      return {
        ok: true,
        json: async () => ({ statuses: [{ id: '4', status: 'New', is_closed: false }] })
      };
    }

    if (String(url).includes('/api/Category?$top=200')) {
      return {
        ok: true,
        json: async () => ({ categories: [{ id: '18', category_name: 'Security' }] })
      };
    }

    if (String(url).includes('/api/TicketType/12')) {
      return {
        ok: true,
        json: async () => ({
          id: '12',
          name: 'Incident',
          allowed_statuses: [{ id: '4', status: 'New', is_closed: false }],
          allowed_categories: [{ id: '18', name: 'Security' }]
        })
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-halo-settings-options']({
      settings: createSettingsContext({
        HaloClientSecret: 'stored-secret-value'
      })
    }, {
      settings: {
        HaloResourceServer: 'https://halo.example.com',
        HaloAuthorisationServer: 'https://halo.example.com/auth',
        HaloClientId: 'client-id-123',
        HaloTicketTypeId: '12',
        _secretModes: {
          HaloClientSecret: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'valid Halo settings should load settings discovery');
    assert.strictEqual(result.teams.length, 1, 'teams should be returned');
    assert.deepStrictEqual(result.teams[0], { id: '7', name: 'Service Desk' }, 'teams should be normalized');
    assert.deepStrictEqual(result.ticketTypes[0], { id: '12', name: 'Incident' }, 'ticket types should be normalized');
    assert.deepStrictEqual(result.statuses[0], { id: '4', name: 'New', isClosed: false }, 'statuses should be normalized');
    assert.deepStrictEqual(result.categories[0], { id: '18', name: 'Security' }, 'categories should be normalized');
    assert(result.ticketTypeDetail, 'ticket type detail should be returned when a ticket type is selected');
    assert.deepStrictEqual(result.ticketTypeDetail.allowedStatuses[0], { id: '4', name: 'New', isClosed: false }, 'detail statuses should be normalized');
    assert.deepStrictEqual(result.ticketTypeDetail.allowedCategories[0], { id: '18', name: 'Security' }, 'detail categories should be normalized');
    assert(!calls.some((call) => call.url.includes('/Tickets')), 'discovery must not call ticket write endpoints');
    assert(calls.filter((call) => call.options?.method === 'GET').every((call) => !call.url.endsWith('/token')), 'resource discovery should stay read-only');
  });
}

async function testFailedDiscoveryReturnsSafeError() {
  await withMockedFetch(async (url) => {
    if (String(url).endsWith('/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'halo-token', token_type: 'Bearer' })
      };
    }

    if (String(url).includes('/api/Category?$top=200')) {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: 'bearer halo-token client_secret stored-secret-value'
        })
      };
    }

    return {
      ok: true,
      json: async () => ([])
    };
  }, async () => {
    const actions = await loadFreshActionsModule();
    const result = await actions['discover-halo-settings-options']({
      settings: createSettingsContext()
    }, {
      settings: {
        HaloResourceServer: 'https://halo.example.com',
        HaloAuthorisationServer: 'https://halo.example.com/auth',
        HaloClientId: 'client-id-123',
        HaloClientSecret: 'stored-secret-value'
      }
    });

    assert.strictEqual(result.ok, false, 'failed Halo lookup should fail discovery');
    assert(result.message.startsWith('Failed:'), 'failed discovery should return a safe failure prefix');
    assert(!result.message.includes('halo-token'), 'failed discovery should not leak bearer tokens');
    assert(!result.message.includes('stored-secret-value'), 'failed discovery should not leak secrets');
    assert.deepStrictEqual(result.teams, [], 'failed discovery should return safe empty option arrays');
    assert.deepStrictEqual(result.ticketTypes, [], 'failed discovery should return safe empty option arrays');
    assert.deepStrictEqual(result.statuses, [], 'failed discovery should return safe empty option arrays');
    assert.deepStrictEqual(result.categories, [], 'failed discovery should return safe empty option arrays');
  });
}

async function run() {
  await testMissingSettingsReturnsFailureWithoutHttp();
  await testSuccessfulDiscoveryReturnsNormalizedOptions();
  await testFailedDiscoveryReturnsSafeError();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
