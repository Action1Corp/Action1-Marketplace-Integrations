const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createHaloAuthClient, createHaloTicketsClient } = require('../haloApi');
const manual = require('./haloClientTestData.manual');
const { actions } = require('../actions');

async function testExportedSyncActionCannotReachDestinationMutation() {
  const originalFetch = global.fetch;
  const calls = [];
  const dbWrites = [];
  global.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: String(options.method || 'GET').toUpperCase() };
    calls.push(call);
    const payload = call.url.endsWith('/oauth2/token')
      ? { access_token: 'synthetic-action1-token', expires_in: 3600 }
      : call.url.endsWith('/auth/token')
        ? { access_token: 'synthetic-destination-token', expires_in: 3600 }
        : call.url.includes('/endpoints/managed/org-1')
          ? { items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-01-01_00-00-00' }], from: 0, total_items: 1 }
          : call.url.includes('/api/Category')
            ? { items: [] }
            : {};
    return {
      ok: true,
      status: 200,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      async text() { return JSON.stringify(payload); }
    };
  };

  const context = {
    action1: { async getCredentials() { return { apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: 'https://app.na-2.action1.com/api/3.0' }; } },
    settings: { async all() { return {
      TicketingResourceServer: 'https://halo.example.test/api', TicketingAuthorisationServer: 'https://halo.example.test/auth',
      TicketingClientId: 'synthetic-id', TicketingClientSecret: 'synthetic-secret', TicketingTicketTypeId: '35',
      TicketingCategory1Id: '1',
      TicketingClosedStatusIds: '900', TicketingOfflineEnabled: 'true', TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'false', TicketingAutomationFailedEnabled: 'false', TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '', TicketingUpdateEnabled: 'false', TicketingUpdateSeverities: ''
    }; } },
    db: {
      async all(sql) {
        if (sql.includes('action1_ticketing_org_client_mappings')) return [{ id: 1, action1_org_id: 'org-1', action1_org_name: 'Org One', halo_client_id: 'client-1', halo_client_name: 'Client One', enabled: 1 }];
        return [];
      },
      async get() { return null; },
      async run(sql) { dbWrites.push(sql); }
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  };

  try {
    const result = await actions.sync(context, { run: { async appendLog() {}, async setAssetsProcessed() {} } });
    assert.strictEqual(result.ok, false, 'without a provider, exported sync reports lifecycle failures');
    assert.strictEqual(result.summary.candidatesSeen, 0, 'the unavailable production provider is rejected before Action1 collection');
    assert.strictEqual(calls.length, 0, 'unavailable provider rejection occurs before any Action1 or Halo transport');
    assert.strictEqual(calls.some((call) => call.url.includes('/api/Tickets')), false, 'exported production action cannot issue ticket reads or writes');
    assert.strictEqual(calls.some((call) => call.url.includes('/api/Category')), false, 'provider lifecycle no longer performs the Halo-specific category read');
    assert.strictEqual(dbWrites.some((sql) => /(?:INSERT|UPDATE).*correlations/i.test(sql)), false, 'denied destination write does not persist ticket correlations');
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  await testExportedSyncActionCannotReachDestinationMutation();
  let connectionCalls = 0;
  let transportCalls = 0;
  const authClient = createHaloAuthClient({
    connectionProvider: async () => {
      connectionCalls += 1;
      return {
        resourceServer: 'https://halo.example.test/api',
        authorisationServer: 'https://halo.example.test/auth',
        clientId: 'synthetic-id',
        clientSecret: 'synthetic-secret'
      };
    },
    httpClient: {
      async requestJson() {
        transportCalls += 1;
        throw new Error('transport must not be called for a destination write');
      }
    }
  });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(
      authClient.requestResource({ method, path: '/Tickets', body: { summary: 'synthetic' } }),
      /destination writes are disabled/i
    );
  }
  assert.strictEqual(connectionCalls, 0, 'denied writes fail before connection or token resolution');
  assert.strictEqual(transportCalls, 0, 'denied writes never reach HTTP transport');

  const tickets = createHaloTicketsClient({ haloAuthClient: authClient });
  const payload = { summary: 'synthetic', details: 'synthetic', client_id: '1', tickettype_id: '2' };
  await assert.rejects(tickets.createTicket(payload), /destination writes are disabled/i);
  await assert.rejects(tickets.updateTicket('123', payload), /destination writes are disabled/i);
  await assert.rejects(tickets.setTicketStatus('123', '2'), /destination writes are disabled/i);
  assert.strictEqual(connectionCalls, 0, 'direct ticket client mutations stop at the shared request boundary');
  assert.strictEqual(transportCalls, 0);

  let settingsCalls = 0;
  let clientFactoryCalls = 0;
  let fileWrites = 0;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'action1-ticketing-write-denial-'));
  const deps = {
    manifestDir: tempDir,
    loadSettings: async () => { settingsCalls += 1; return {}; },
    authClientFactory: async () => {
      clientFactoryCalls += 1;
      return { async requestResource() { transportCalls += 1; } };
    },
    fs: {
      async mkdir() { fileWrites += 1; },
      async writeFile() { fileWrites += 1; },
      async readFile() { throw new Error('unexpected read'); }
    },
    print() {}
  };

  const create = await manual.runCreateCommand({ count: 1, confirm: true, ackNonProduction: true }, deps);
  assert.strictEqual(create.reason, 'destination_writes_disabled');
  const cleanup = await manual.runCleanupCommand({ manifestPath: path.join(tempDir, 'valid.json'), confirm: true, ackNonProduction: true }, deps);
  assert.strictEqual(cleanup.reason, 'destination_writes_disabled');
  const cliCreate = await manual.runCli(['create', '--count', '1', '--confirm', '--ack-non-production'], deps);
  assert.strictEqual(cliCreate.reason, 'destination_writes_disabled', 'the standalone CLI entry path is also fail-closed');
  assert.strictEqual(settingsCalls, 0, 'manual create/cleanup deny before settings access');
  assert.strictEqual(clientFactoryCalls, 0, 'manual create/cleanup deny before auth client construction');
  assert.strictEqual(fileWrites, 0, 'manual create/cleanup deny before filesystem writes');
  assert.strictEqual(transportCalls, 0, 'manual create/cleanup deny before HTTP');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
