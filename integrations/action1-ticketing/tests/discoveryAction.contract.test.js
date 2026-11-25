const assert = require('assert');
const { actions } = require('../actions');
const manifest = require('../manifest.json');

async function run() {
  const action = manifest.actions.find((row) => row.id === 'discover-ticketing-settings-options');
  assert(action, 'settings discovery remains manifest declared');
  assert.strictEqual(action.history, false);
  const calls = [];
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error('ConnectWise discovery must use injected Marketplace transport'); };
  try {
    const context = {
      settings: { async get() { return ''; } },
      http: async (options) => {
        calls.push(options);
        if (options.url.endsWith('/service/boards?pageSize=1000&conditions=inactiveFlag%3Dfalse+and+projectFlag%3Dfalse')) return { status: 200, data: [{ id: 1, name: 'Service', inactiveFlag: false, projectFlag: false }] };
        if (options.url.endsWith('/service/priorities?pageSize=1000')) return { status: 200, data: [{ id: 2, name: 'Normal' }] };
        if (options.url.endsWith('/service/sources?pageSize=1000')) return { status: 200, data: [{ id: 3, name: 'Portal' }] };
        if (options.url.endsWith('/company/companies/statuses?pageSize=1000')) return { status: 200, data: [{ id: 4, name: 'Active', disallowSavingFlag: false }] };
        return { status: 200, data: [] };
      }
    };
    const result = await actions['discover-ticketing-settings-options'](context, {
      providerId: 'connectwise-psa', settings: {
        TicketingProvider_connectwise_psa_ApiRegion: 'NA',
        TicketingProvider_connectwise_psa_CompanyId: 'tenant',
        TicketingProvider_connectwise_psa_PublicApiKey: 'public',
        TicketingProvider_connectwise_psa_PrivateApiKey: 'private'
      }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.optionsByKind['service-boards']?.[0]?.id, '1', JSON.stringify({ result, urls: calls.map((call) => call.url) }));
    assert.strictEqual(result.optionsByKind.priorities[0].label, 'Normal');
    assert(calls.length >= 4);
    assert(calls.every((call) => call.method === 'GET'));
    assert(calls.every((call) => !call.url.includes('/tickets')));
    calls.length = 0;
    const dependent = await actions['discover-ticketing-settings-options'](context, {
      providerId: 'connectwise-psa', settings: {
        TicketingProvider_connectwise_psa_ApiRegion: 'NA', TicketingProvider_connectwise_psa_CompanyId: 'tenant',
        TicketingProvider_connectwise_psa_PublicApiKey: 'public', TicketingProvider_connectwise_psa_PrivateApiKey: 'private',
        TicketingProvider_connectwise_psa_ServiceBoardId: '10'
      }
    });
    assert.strictEqual(dependent.ok, true);
    for (const path of ['/service/boards/10/statuses', '/service/boards/10/types', '/service/boards/10/subtypes', '/service/boards/10/items', '/service/boards/10/typeSubTypeItemAssociations']) assert(calls.some((call) => call.url.includes(path)), `selected board dispatches dependent discovery ${path}`);
  } finally { global.fetch = oldFetch; }
}

run().catch((error) => { console.error(error); process.exit(1); });
