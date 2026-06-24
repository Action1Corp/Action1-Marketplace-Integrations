const assert = require('assert');

const originalFetch = global.fetch;
const {
  __resetHaloTokenCache,
  createHaloAuthClient,
  requestToken
} = require('../haloApi');
const { runHaloPsaSync } = require('../syncAction');

function createSyncContext(overrides = {}) {
  const state = {
    mappings: overrides.mappings || [],
    endpoint: [],
    grouped: [],
    watermarks: []
  };

  return {
    state,
    action1: {
      async getCredentials() {
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret'
        };
      }
    },
    settings: {
      async all() {
        return {
          HaloPsaResourceServer: 'https://halo.example.com/api',
          HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
          HaloPsaClientId: 'halo-client-id',
          HaloPsaClientSecret: 'halo-client-secret',
          HaloPsaTicketTypeId: '35',
          HaloPsaClosedStatusIds: '900',
          HaloPsaOfflineEnabled: 'true',
          HaloPsaOfflineThresholdDays: '7',
          HaloPsaRebootRequiredEnabled: 'true',
          HaloPsaAutomationFailedEnabled: 'true',
          HaloPsaAutomationFailedLookbackHours: '24',
          HaloPsaVulnerabilitySeverities: 'high',
          HaloPsaVulnerabilityRemediationStatuses: 'overdue',
          HaloPsaUpdateSeverities: 'important',
          HaloPsaUpdateRemediationStatuses: 'overdue',
          HaloPsaVulnerabilityTicketModel: 'grouped',
          HaloPsaUpdateTicketModel: 'grouped',
          HaloPsaAutomationFailedTicketModel: 'grouped',
          ...(overrides.settings || {})
        };
      },
      async get() {
        return '';
      }
    },
    db: {
      async all(sql, params = []) {
        if (sql.includes('FROM halo_psa_org_client_mappings')) {
          return state.mappings.map((row, index) => ({
            id: row.id ?? index + 1,
            action1_org_id: row.action1OrgId,
            action1_org_name: row.action1OrgName,
            halo_client_id: row.haloClientId,
            halo_client_name: row.haloClientName,
            enabled: 1
          }));
        }
        if (sql.includes('FROM halo_psa_endpoint_correlations')) {
          return state.endpoint.filter((row) => row.org_link_id === params[0]);
        }
        if (sql.includes('FROM halo_psa_grouped_correlations')) {
          return state.grouped.filter((row) => row.org_link_id === params[0]);
        }
        return [];
      },
      async get(sql, params = []) {
        if (sql.includes('FROM halo_psa_endpoint_correlations')) {
          return state.endpoint.find((row) => row.org_link_id === params[0] && row.endpoint_id === params[1] && row.signal_type === params[2]) || null;
        }
        if (sql.includes('FROM halo_psa_grouped_correlations')) {
          return state.grouped.find((row) => row.org_link_id === params[0] && row.signal_type === params[1] && row.issue_key === params[2]) || null;
        }
        if (sql.includes('FROM halo_psa_signal_watermarks')) {
          return state.watermarks.find((row) => row.org_link_id === params[0] && row.signal_type === params[1]) || null;
        }
        return null;
      },
      async run(sql, params = []) {
        const normalizedSql = String(sql).trimStart();
        if (normalizedSql.startsWith('INSERT INTO halo_psa_endpoint_correlations')) {
          state.endpoint.push({
            org_link_id: params[2],
            endpoint_id: params[4],
            signal_type: params[5],
            linked_ticket_id: params[6],
            payload_hash: params[7]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE halo_psa_endpoint_correlations')) {
          const row = state.endpoint.find((entry) => entry.org_link_id === params[8] && entry.endpoint_id === params[9] && entry.signal_type === params[10]);
          if (row) {
            row.linked_ticket_id = params[3];
            row.payload_hash = params[4];
          }
          return;
        }
        if (normalizedSql.startsWith('DELETE FROM halo_psa_endpoint_correlations')) {
          state.endpoint = state.endpoint.filter((row) => !(row.org_link_id === params[0] && row.endpoint_id === params[1] && row.signal_type === params[2]));
          return;
        }
        if (normalizedSql.startsWith('INSERT INTO halo_psa_grouped_correlations')) {
          state.grouped.push({
            org_link_id: params[2],
            signal_type: params[4],
            issue_key: params[5],
            linked_ticket_id: params[6],
            payload_hash: params[7]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE halo_psa_grouped_correlations')) {
          const row = state.grouped.find((entry) => entry.org_link_id === params[8] && entry.signal_type === params[9] && entry.issue_key === params[10]);
          if (row) {
            row.linked_ticket_id = params[3];
            row.payload_hash = params[4];
          }
          return;
        }
        if (normalizedSql.startsWith('DELETE FROM halo_psa_grouped_correlations')) {
          state.grouped = state.grouped.filter((row) => !(row.org_link_id === params[0] && row.signal_type === params[1] && row.issue_key === params[2]));
          return;
        }
        if (normalizedSql.startsWith('INSERT INTO halo_psa_signal_watermarks')) {
          state.watermarks.push({
            org_link_id: params[1],
            signal_type: params[3],
            watermark_value: params[4],
            watermark_at: params[5],
            metadata_json: params[6]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE halo_psa_signal_watermarks')) {
          const row = state.watermarks.find((entry) => entry.org_link_id === params[7] && entry.signal_type === params[8]);
          if (row) {
            row.watermark_value = params[2];
            row.watermark_at = params[3];
            row.metadata_json = params[4];
          }
        }
      }
    }
  };
}

async function withMockedFetch(mock, worker) {
  __resetHaloTokenCache();
  global.fetch = mock;
  try {
    await worker();
  } finally {
    global.fetch = originalFetch;
    __resetHaloTokenCache();
  }
}

async function runHaloAuthTokenReuseAndRefreshTest() {
  __resetHaloTokenCache();
  const calls = [];
  let currentMs = 0;
  let tokenCounter = 0;
  const connection = {
    resourceServer: 'https://halo.example.com/api',
    authorisationServer: 'https://halo.example.com/auth',
    clientId: 'halo-client-id',
    clientSecret: 'halo-client-secret'
  };
  const httpClient = {
    async requestJson(request) {
      calls.push(request);
      if (String(request.url).endsWith('/token')) {
        tokenCounter += 1;
        return {
          statusCode: 200,
          data: {
            access_token: `halo-token-${tokenCounter}`,
            token_type: 'Bearer',
            expires_in: 3600
          }
        };
      }

      return {
        statusCode: 200,
        data: { id: 'ticket-1', status_id: '3', status: 'Open', is_closed: false }
      };
    }
  };
  const authClient = createHaloAuthClient({
    httpClient,
    now: () => currentMs,
    connectionProvider: () => connection
  });

  await authClient.requestResource({ method: 'GET', path: '/Tickets/1', runId: 'halo-resource-1' });
  await authClient.requestResource({ method: 'GET', path: '/Tickets/2', runId: 'halo-resource-2' });
  currentMs = (3600 - 61) * 1000;
  await authClient.requestResource({ method: 'GET', path: '/Tickets/3', runId: 'halo-resource-3' });
  currentMs = (3600 - 59) * 1000;
  await authClient.requestResource({ method: 'GET', path: '/Tickets/4', runId: 'halo-resource-4' });

  const tokenCalls = calls.filter((request) => String(request.url).endsWith('/token'));
  assert.strictEqual(tokenCalls.length, 2, 'Halo auth client should reuse fresh tokens and refresh once inside the 60-second safety margin');
  assert.strictEqual(calls.find((request) => String(request.url).endsWith('/api/Tickets/4')).headers.Authorization, 'Bearer halo-token-2', 'refreshed resource calls should use the replacement token');
}

async function runDiscoveryAndRuntimeShareHaloTokenCacheTest() {
  __resetHaloTokenCache();
  const calls = [];
  const settings = {
    HaloPsaResourceServer: 'https://halo.example.com/api',
    HaloPsaAuthorisationServer: 'https://halo.example.com/auth',
    HaloPsaClientId: 'halo-client-id',
    HaloPsaClientSecret: 'halo-client-secret'
  };
  const httpClient = {
    async requestJson(request) {
      calls.push(request);
      if (String(request.url).endsWith('/token')) {
        return {
          statusCode: 200,
          data: {
            access_token: 'halo-token-shared',
            token_type: 'Bearer',
            expires_in: 3600
          }
        };
      }

      return {
        statusCode: 200,
        data: { id: 'ticket-shared', status_id: '3', status: 'Open', is_closed: false }
      };
    }
  };

  const discoveryToken = await requestToken(settings, {
    httpClient,
    runId: 'halo-category-token',
    now: () => 0
  });
  const authClient = createHaloAuthClient({
    httpClient,
    now: () => 0,
    connectionProvider: () => ({
      resourceServer: settings.HaloPsaResourceServer,
      authorisationServer: settings.HaloPsaAuthorisationServer,
      clientId: settings.HaloPsaClientId,
      clientSecret: settings.HaloPsaClientSecret
    })
  });

  await authClient.requestResource({ method: 'GET', path: '/Tickets/3960', runId: 'halo-ticket-get' });

  assert.strictEqual(discoveryToken.accessToken, 'halo-token-shared', 'discovery requests should still return the resolved Halo access token');
  assert.strictEqual(calls.filter((request) => String(request.url).endsWith('/token')).length, 1, 'discovery and runtime Halo requests should share one fresh token per auth context');
}

async function runMissingConfigFailsSafelyTest() {
  const logs = [];
  const context = createSyncContext();
  context.settings.all = async () => ({});

  const result = await runHaloPsaSync(context, {
    run: {
      async appendLog(message) {
        logs.push(message);
      },
      async setAssetsProcessed(count) {
        logs.push(`assets:${count}`);
      }
    }
  });

  assert.strictEqual(result.ok, false, 'missing required Halo settings should fail safely');
  assert.strictEqual(result.assetsProcessed, 0, 'missing config should return zero processed assets for Marketplace history compatibility');
  assert(logs.some((entry) => entry.includes('Loading HaloPSA runtime configuration')), 'sync should log config-loading before validation failures');
  assert(logs.some((entry) => entry.includes('Sync stopped')), 'missing config should log a safe stop message');
  assert(logs.includes('assets:0'), 'missing config should report zero processed assets');
}

async function runMissingAction1CredentialsFailsSafelyTest() {
  const logs = [];
  const context = createSyncContext({
    mappings: [
      {
        id: 1,
        action1OrgId: 'org-1',
        action1OrgName: 'Org One',
        haloClientId: 'client-1',
        haloClientName: 'Client One'
      }
    ],
    settings: {
      HaloPsaOfflineEnabled: 'true',
      HaloPsaOfflineThresholdDays: '7',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
    }
  });
  context.action1.getCredentials = async () => ({ apiKey: '', apiSecret: '' });

  const result = await runHaloPsaSync(context, {
    run: {
      async appendLog(message) {
        logs.push(message);
      },
      async setAssetsProcessed() {}
    }
  });

  assert.strictEqual(result.ok, false, 'missing Marketplace-owned Action1 credentials should fail safely');
  assert.strictEqual(result.summary.failed, 1, 'missing Action1 credentials should surface as a safe collection failure');
  assert.strictEqual(result.failuresByReason, undefined, 'sync result should not expose an unexpected top-level failuresByReason field');
  assert(logs.some((entry) => entry.includes('Marketplace Action1 credentials checked')), 'sync should log the Marketplace credential check before Action1 collection');
  assert(logs.some((entry) => entry.includes('Action1 collection failed')), 'missing Action1 credentials should be logged safely');
}

async function runTrackedSyncHappyPathTest() {
  const fetchCalls = [];
  const context = createSyncContext({
    mappings: [
      {
        id: 1,
        action1OrgId: 'org-1',
        action1OrgName: 'Org One',
        haloClientId: 'client-1',
        haloClientName: 'Client One'
      }
    ]
  });
  const runLogs = [];
  let processed = null;

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload) => ({
      ok: true,
      status: 200,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse({ access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.endsWith('/organizations')) {
      return textResponse({ items: [{ id: 'org-1', name: 'Org One' }] });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse({ items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'yes' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/vulnerabilities/org-1?')) {
      return textResponse({ items: [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1?')) {
      return textResponse({ items: [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'High', update_sla_status: 'Overdue' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/automations/instances/org-1?')) {
      return textResponse({ items: [{ id: 'inst-1', end_time: '2026-06-18_10-00-00', name: 'Automation One' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/automations/instances/org-1/inst-1/endpoint-results')) {
      return textResponse({ items: [{ id: 'ep-1', status: 'Error', description: 'Automation failed', action_name: 'Script', percent_completed: 80 }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse({ access_token: 'halo-token', token_type: 'Bearer' });
    }
    if (urlText.includes('/api/Category')) {
      return textResponse({ items: [] });
    }
    if (urlText.endsWith('/api/Tickets') && String(options.method || '').toUpperCase() === 'POST') {
      return textResponse([{ id: `ticket-${fetchCalls.length}`, status_id: '3', status: 'Open', is_closed: false }]);
    }
    if (urlText.includes('/api/Tickets/')) {
      return textResponse({ id: 'ticket-existing', status_id: '3', status: 'Open', is_closed: false });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runHaloPsaSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed(count) {
          processed = count;
        }
      }
    });

    assert.strictEqual(result.summary.created >= 1, true, 'real sync orchestration should create at least one tracked candidate in the happy path');
    assert.strictEqual(result.assetsProcessed, processed, 'sync should return assetsProcessed so the Marketplace host preserves the final count');
    assert(result.details.includes('HALO_PSA_SYNC_SUMMARY_BEGIN'), 'sync should return a delimited HaloPSA summary block start marker');
    assert(result.details.includes('HALO_PSA_SYNC_SUMMARY_END'), 'sync should return a delimited HaloPSA summary block end marker');
    assert(/(?:^|\n)created:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with created counts');
    assert(/(?:^|\n)updated:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with updated counts');
    assert(/(?:^|\n)skipped:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with skipped counts');
    assert(/(?:^|\n)failed:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with failed counts');
    assert.strictEqual(typeof processed, 'number', 'sync should report processed assets through request.run');
    assert(runLogs.some((entry) => entry.includes('Starting HaloPSA sync')), 'sync should append operator-visible run logs');
    assert(runLogs.some((entry) => entry.includes('HaloPSA runtime configuration loaded')), 'sync should log when runtime configuration is loaded');
    assert(runLogs.some((entry) => entry.includes('Starting Action1 collection')), 'sync should log the Action1 collection phase');
    assert(runLogs.some((entry) => entry.includes('Candidate pipeline completed')), 'sync should log candidate pipeline completion');
    assert(runLogs.some((entry) => entry.includes('Lifecycle execution completed')), 'sync should log lifecycle completion');
    assert(fetchCalls.some((call) => call.url.endsWith('/oauth2/token')), 'sync should read Action1 credentials through Marketplace-owned Action1 auth');
    assert(fetchCalls.some((call) => call.url.endsWith('/auth/token')), 'sync should acquire a Halo token for runtime writes');
    assert.strictEqual(fetchCalls.filter((call) => call.url.endsWith('/auth/token')).length, 1, 'sync should reuse one fresh Halo token across category lookup and lifecycle writes');
    assert(fetchCalls.some((call) => call.url.endsWith('/api/Tickets')), 'sync should call the Halo ticket endpoint for lifecycle writes');
    assert.strictEqual(context.state.endpoint.length + context.state.grouped.length >= 1, true, 'successful writes should persist correlations in DB-backed stores');
    assert.strictEqual(context.state.watermarks.length >= 1, true, 'successful automation collection should persist watermarks in DB-backed storage');
  });
}

async function runAllSignalsDisabledNoOpTest() {
  const fetchCalls = [];
  const logs = [];
  const context = createSyncContext({
    mappings: [],
    settings: {
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
    }
  });
  let processed = null;

  await withMockedFetch(async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`Unexpected fetch ${String(url)}`);
  }, async () => {
    const result = await runHaloPsaSync(context, {
      run: {
        async appendLog(message) {
          logs.push(message);
        },
        async setAssetsProcessed(count) {
          processed = count;
        }
      }
    });

    assert.strictEqual(result.ok, true, 'all signals disabled should return a successful no-op');
    assert.strictEqual(result.summary.candidatesSeen, 0, 'all signals disabled should not produce candidates');
    assert.strictEqual(result.summary.created, 0, 'all signals disabled should not create tickets');
    assert.strictEqual(result.summary.updated, 0, 'all signals disabled should not update tickets');
    assert.strictEqual(result.summary.skipped, 0, 'all signals disabled should not report skipped lifecycle work');
    assert.strictEqual(result.summary.failed, 0, 'all signals disabled should not fail');
    assert.strictEqual(result.assetsProcessed, 0, 'all signals disabled should report zero processed assets');
    assert.strictEqual(processed, 0, 'all signals disabled should publish zero processed assets');
    assert(result.message.includes('no signals are enabled'), 'all signals disabled should return a clear no-op message');
    assert(result.details.includes('No enabled signals are configured. Nothing to process.'), 'all signals disabled details should explain the no-op');
    assert(result.details.includes('HALO_PSA_SYNC_SUMMARY_BEGIN'), 'all signals disabled should still include the summary block');
    assert.strictEqual(fetchCalls.length, 0, 'all signals disabled should not call Action1 or Halo APIs');
    assert(logs.some((entry) => entry.includes('enabledSignals":[]')), 'basic logs should include the empty enabled signal summary');
    assert(logs.some((entry) => entry.includes('no signals are enabled')), 'basic logs should include the no-op decision');
  });
}

async function runOfflineOnlyCollectionGatingTest() {
  const fetchCalls = [];
  const runLogs = [];
  const context = createSyncContext({
    mappings: [
      {
        id: 1,
        action1OrgId: 'org-1',
        action1OrgName: 'Org One',
        haloClientId: 'client-1',
        haloClientName: 'Client One'
      }
    ],
    settings: {
      HaloPsaOfflineEnabled: 'true',
      HaloPsaOfflineThresholdDays: '7',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
    }
  });

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload) => ({
      ok: true,
      status: 200,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse({ access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse({ items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'yes' }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse({ access_token: 'halo-token', token_type: 'Bearer' });
    }
    if (urlText.endsWith('/api/Tickets') && String(options.method || '').toUpperCase() === 'POST') {
      return textResponse([{ id: 'ticket-1', status_id: '3', status: 'Open', is_closed: false }]);
    }
    if (urlText.includes('/api/Tickets/')) {
      return textResponse({ id: 'ticket-existing', status_id: '3', status: 'Open', is_closed: false });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runHaloPsaSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed() {}
      }
    });

    const urls = fetchCalls.map((call) => call.url);
    assert.strictEqual(result.ok, true, 'offline-only run should complete successfully');
    assert.strictEqual(result.summary.created, 1, 'offline-only run should only create the offline candidate');
    assert.strictEqual(result.summary.updated, 0, 'offline-only run should not update tickets in this fixture');
    assert.strictEqual(result.summary.skipped, 0, 'offline-only run should not count disabled signals as skipped');
    assert.strictEqual(result.summary.failed, 0, 'offline-only run should not fail');
    assert.strictEqual(result.summary.bySignalType.OFFLINE, 1, 'offline-only run should report the offline lifecycle candidate');
    assert.strictEqual(result.summary.bySignalType.REBOOT_REQUIRED || 0, 0, 'offline-only run should not process reboot-required candidates');
    assert.strictEqual(result.summary.bySignalType.AUTOMATION_FAILED || 0, 0, 'offline-only run should not process automation-failed candidates');
    assert.strictEqual(result.summary.bySignalType.VULNERABILITY || 0, 0, 'offline-only run should not process vulnerability candidates');
    assert.strictEqual(result.summary.bySignalType.UPDATE || 0, 0, 'offline-only run should not process update candidates');
    assert(urls.some((url) => url.includes('/endpoints/managed/org-1')), 'offline-only run should still fetch endpoints');
    assert.strictEqual(urls.some((url) => url.includes('/vulnerabilities/org-1')), false, 'offline-only run should not call vulnerability collection');
    assert.strictEqual(urls.some((url) => url.includes('/updates/org-1')), false, 'offline-only run should not call update collection');
    assert.strictEqual(urls.some((url) => url.includes('/automations/instances/org-1')), false, 'offline-only run should not call automation-failed collection');
    assert.strictEqual(runLogs.some((entry) => entry.includes('Skipping Action1 vulnerability collection because VULNERABILITY is disabled.')), true, 'basic logs should include vulnerability skip decisions');
    assert.strictEqual(runLogs.some((entry) => entry.includes('Skipping Action1 update collection because UPDATE is disabled.')), true, 'basic logs should include update skip decisions');
    assert.strictEqual(runLogs.some((entry) => entry.includes('Skipping Action1 automation-failed collection because AUTOMATION_FAILED is disabled.')), true, 'basic logs should include automation skip decisions');
  });
}

async function runPreCandidateSignalNotQualifiedDoesNotInflateFinalSkippedTest() {
  const fetchCalls = [];
  const runLogs = [];
  const context = createSyncContext({
    mappings: [
      {
        id: 1,
        action1OrgId: 'org-1',
        action1OrgName: 'Org One',
        haloClientId: 'client-1',
        haloClientName: 'Client One'
      }
    ],
    settings: {
      HaloPsaOfflineEnabled: 'true',
      HaloPsaOfflineThresholdDays: '7',
      HaloPsaRebootRequiredEnabled: 'true',
      HaloPsaAutomationFailedEnabled: 'true',
      HaloPsaAutomationFailedLookbackHours: '24',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'true',
      HaloPsaUpdateSeverities: 'important',
      HaloPsaUpdateRemediationStatuses: 'overdue'
    }
  });

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload) => ({
      ok: true,
      status: 200,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse({ access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse({
        items: [
          { id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'yes' },
          { id: 'ep-2', name: 'Endpoint Two', last_seen: '2026-06-01_00-00-00', reboot_required: 'yes' }
        ],
        from: 0,
        total_items: 2
      });
    }
    if (urlText.includes('/updates/org-1?')) {
      return textResponse({
        items: [
          { packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' },
          { packageId: 'pkg-2', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' },
          { packageId: 'pkg-3', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' }
        ],
        from: 0,
        total_items: 3
      });
    }
    if (urlText.includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-2/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-3/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-2' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/automations/instances/org-1?')) {
      return textResponse({ items: [], from: 0, total_items: 0 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse({ access_token: 'halo-token', token_type: 'Bearer' });
    }
    if (urlText.includes('/api/Category')) {
      return textResponse({ items: [] });
    }
    if (urlText.endsWith('/api/Tickets') && String(options.method || '').toUpperCase() === 'POST') {
      return textResponse([{ id: `ticket-${fetchCalls.length}`, status_id: '3', status: 'Open', is_closed: false }]);
    }
    if (urlText.includes('/api/Tickets/')) {
      return textResponse({ id: 'ticket-existing', status_id: '3', status: 'Open', is_closed: false });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runHaloPsaSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'mixed run should complete successfully');
    assert.strictEqual(result.summary.candidatesSeen, 7, 'final summary should count only lifecycle candidates');
    assert.strictEqual(result.summary.created, 7, 'all lifecycle candidates should create tickets in this fixture');
    assert.strictEqual(result.summary.updated, 0, 'fixture should not update tickets');
    assert.strictEqual(result.summary.skipped, 0, 'pre-candidate signal_not_qualified rows should not inflate final skipped');
    assert.strictEqual(result.summary.failed, 0, 'fixture should not fail');
    assert.strictEqual(result.summary.bySignalType.OFFLINE, 2, 'offline candidates should be preserved in summary');
    assert.strictEqual(result.summary.bySignalType.REBOOT_REQUIRED, 2, 'reboot-required candidates should be preserved in summary');
    assert.strictEqual(result.summary.bySignalType.UPDATE, 3, 'update candidates should be preserved in summary');
    assert.strictEqual(result.summary.bySignalType.AUTOMATION_FAILED || 0, 0, 'no automation-failed lifecycle candidates should be created');
    assert.strictEqual(result.summary.skippedByReason.signal_not_qualified || 0, 2, 'diagnostic skippedByReason should still track signal_not_qualified evaluations');
    assert(/(?:^|\n)created:\s*7(?:\n|$)/i.test(result.details), 'final summary block should report lifecycle created count');
    assert(/(?:^|\n)updated:\s*0(?:\n|$)/i.test(result.details), 'final summary block should report lifecycle updated count');
    assert(/(?:^|\n)skipped:\s*0(?:\n|$)/i.test(result.details), 'final summary block should use lifecycle skipped count only');
    assert(/(?:^|\n)failed:\s*0(?:\n|$)/i.test(result.details), 'final summary block should report lifecycle failed count');
    assert(runLogs.some((entry) => entry.includes('signal_not_qualified')), 'basic logs should still expose diagnostic skipped reasons');
  });
}

async function runDeletedLinkedTicketIsRecreatedAndNotRecheckedTest() {
  const fetchCalls = [];
  const runLogs = [];
  const context = createSyncContext({
    mappings: [
      {
        id: 1,
        action1OrgId: 'org-1',
        action1OrgName: 'Org One',
        haloClientId: 'client-1',
        haloClientName: 'Client One'
      }
    ],
    settings: {
      HaloPsaOfflineEnabled: 'true',
      HaloPsaOfflineThresholdDays: '7',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
    }
  });
  context.state.endpoint.push({
    org_link_id: '1',
    endpoint_id: 'ep-1',
    signal_type: 'OFFLINE',
    linked_ticket_id: '3960',
    payload_hash: 'old-hash'
  });

  let createCounter = 0;

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse(200, { access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse(200, { items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'no' }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse(200, { access_token: 'halo-token', token_type: 'Bearer' });
    }
    if (urlText.includes('/api/Category')) {
      return textResponse(200, { items: [] });
    }
    if (urlText.endsWith('/api/Tickets') && String(options.method || '').toUpperCase() === 'POST') {
      createCounter += 1;
      return textResponse(200, [{ id: `ticket-recreated-${createCounter}`, status_id: '3', status: 'Open', is_closed: false }]);
    }
    if (urlText.endsWith('/api/Tickets/3960')) {
      return textResponse(404, { message: 'not found' });
    }
    if (urlText.endsWith('/api/Tickets/ticket-recreated-1')) {
      return textResponse(200, { id: 'ticket-recreated-1', status_id: '3', status: 'Open', is_closed: false });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const run = {
      async appendLog(message) {
        runLogs.push(message);
      },
      async setAssetsProcessed() {}
    };

    const first = await runHaloPsaSync(context, { run });
    assert.strictEqual(first.ok, true, 'first run should succeed while recreating the deleted linked ticket');
    assert.strictEqual(first.summary.created, 1, 'first run should recreate the missing linked ticket');
    assert.strictEqual(first.summary.skipped, 0, 'first run should not count deleted-ticket recovery as skipped');
    assert.strictEqual(context.state.endpoint[0].linked_ticket_id, 'ticket-recreated-1', 'first run should replace the stored correlation with the new ticket id');
    assert(runLogs.some((entry) => entry.includes('Linked Halo ticket is missing; treating the stored correlation as stale.')), 'run logs should explain stale linked-ticket recovery');
    assert(runLogs.some((entry) => entry.includes('"recoveryAction":"recreate"')), 'run logs should include the recreate recovery action');
    assert.strictEqual(runLogs.some((entry) => entry.includes('request failed') && entry.includes('/api/Tickets/3960')), false, 'expected 404 linked-ticket reads should not be logged as generic request failures');

    fetchCalls.length = 0;
    runLogs.length = 0;

    const second = await runHaloPsaSync(context, { run });
    assert.strictEqual(second.ok, true, 'second run should also succeed');
    assert.strictEqual(second.summary.created, 0, 'second run should not recreate the ticket again');
    assert.strictEqual(second.summary.skipped, 1, 'second run should no-op against the replacement ticket');
    const secondRunTicketReads = fetchCalls.filter((call) => call.url.includes('/api/Tickets/')).map((call) => call.url);
    assert.strictEqual(secondRunTicketReads.some((url) => url.endsWith('/api/Tickets/3960')), false, 'later runs should not look up the deleted ticket id again');
    assert.strictEqual(secondRunTicketReads.some((url) => url.endsWith('/api/Tickets/ticket-recreated-1')), true, 'later runs should read the replacement ticket id');
  });
}

async function runClosedLinkedTicketCreatesReplacementAndLaterRunsUseItTest() {
  const fetchCalls = [];
  const context = createSyncContext({
    mappings: [
      {
        id: 1,
        action1OrgId: 'org-1',
        action1OrgName: 'Org One',
        haloClientId: 'client-1',
        haloClientName: 'Client One'
      }
    ],
    settings: {
      HaloPsaOfflineEnabled: 'true',
      HaloPsaOfflineThresholdDays: '7',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
    }
  });
  context.state.endpoint.push({
    org_link_id: '1',
    endpoint_id: 'ep-1',
    signal_type: 'OFFLINE',
    linked_ticket_id: '3966',
    payload_hash: 'old-hash'
  });

  let createCounter = 0;

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse(200, { access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse(200, { items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'no' }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse(200, { access_token: 'halo-token', token_type: 'Bearer' });
    }
    if (urlText.includes('/api/Category')) {
      return textResponse(200, { items: [] });
    }
    if (urlText.endsWith('/api/Tickets') && String(options.method || '').toUpperCase() === 'POST') {
      createCounter += 1;
      return textResponse(200, [{ id: `ticket-closed-replacement-${createCounter}`, status_id: '3', status: 'Open', is_closed: false }]);
    }
    if (urlText.endsWith('/api/Tickets/3966')) {
      return textResponse(200, { id: '3966', status_id: '900', status: 'Closed', is_closed: true });
    }
    if (urlText.endsWith('/api/Tickets/ticket-closed-replacement-1')) {
      return textResponse(200, { id: 'ticket-closed-replacement-1', status_id: '3', status: 'Open', is_closed: false });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const run = {
      async appendLog() {},
      async setAssetsProcessed() {}
    };

    const first = await runHaloPsaSync(context, { run });
    assert.strictEqual(first.ok, true, 'first run should succeed while replacing the closed linked ticket');
    assert.strictEqual(first.summary.created, 1, 'first run should create a replacement for the closed linked ticket');
    assert.strictEqual(first.summary.skipped, 0, 'first run should count closed linked-ticket replacement as created, not skipped');
    assert.strictEqual(context.state.endpoint[0].linked_ticket_id, 'ticket-closed-replacement-1', 'first run should replace the stored correlation with the new open ticket id');

    fetchCalls.length = 0;

    const second = await runHaloPsaSync(context, { run });
    assert.strictEqual(second.ok, true, 'second run should also succeed');
    assert.strictEqual(second.summary.created, 0, 'second run should not create another replacement');
    assert.strictEqual(second.summary.skipped, 1, 'second run should no-op against the replacement ticket when unchanged');
    const secondRunTicketReads = fetchCalls.filter((call) => call.url.includes('/api/Tickets/')).map((call) => call.url);
    assert.strictEqual(secondRunTicketReads.some((url) => url.endsWith('/api/Tickets/3966')), false, 'later runs should not keep reading the old closed ticket id');
    assert.strictEqual(secondRunTicketReads.some((url) => url.endsWith('/api/Tickets/ticket-closed-replacement-1')), true, 'later runs should read the replacement open ticket id');
  });
}

async function run() {
  await runHaloAuthTokenReuseAndRefreshTest();
  await runDiscoveryAndRuntimeShareHaloTokenCacheTest();
  await runMissingConfigFailsSafelyTest();
  await runMissingAction1CredentialsFailsSafelyTest();
  await runTrackedSyncHappyPathTest();
  await runAllSignalsDisabledNoOpTest();
  await runOfflineOnlyCollectionGatingTest();
  await runPreCandidateSignalNotQualifiedDoesNotInflateFinalSkippedTest();
  await runDeletedLinkedTicketIsRecreatedAndNotRecheckedTest();
  await runClosedLinkedTicketCreatesReplacementAndLaterRunsUseItTest();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
