const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const originalFetch = global.fetch;
const runtimeLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sync-runtime-logs-'));
process.env.HALO_PSA_LOG_DIR = runtimeLogDir;
function runtimeLogLines() { try { return fs.readFileSync(path.join(runtimeLogDir, 'action1-ticketing-runtime.log'), 'utf8').split(/\r?\n/); } catch { return []; } }
const {
  __resetHaloTokenCache,
  createHaloAuthClient,
  requestToken
} = require('../haloApi');
const { __private: action1CollectionPrivate } = require('../action1Api');
const { runTicketingSync: runTicketingSyncImplementation } = require('../syncAction');
const { __private: syncPrivate } = require('../syncAction');
const { actions: exportedActions } = require('../actions');
const { createProviderDispatcher } = require('../providerRegistry');
const { loadRuntimeConfig } = require('../runtimeConfig');

const syncTicketState = new Map();
const syncProviderCalls = { get: [], prepare: [], create: [], update: [], connections: [], validations: [], transports: [] };
let syncTicketSequence = 0;

function createInMemorySyncDependencies() {
  return {
    providerDispatcher: createProviderDispatcher({
      'connectwise-psa': {
        providerId: 'connectwise-psa',
        label: 'Isolated sync fixture',
        contractMajor: 1,
        adapter: {
          async validateConfiguration({ input, connection }) {
            syncProviderCalls.validations.push({ input, connection });
            if (input.mode === 'organization-eligibility') {
              const destinationId = String(input.mapping?.destinationId || '');
              const failure = syncTicketState.get(`company-ineligible:${destinationId}`);
              return failure ? { ok: false, errors: [{ field: 'CompanyEligibility', message: 'safe fixture failure' }] } : { ok: true, errors: [] };
            }
            const failure = syncTicketState.get('provider-config-error');
            return failure ? { ok: false, errors: [{ field: 'routing.destination', message: failure }] } : { ok: true, errors: [] };
          },
          async testConnection() { return { ok: true, message: 'Connected.' }; },
          async discover() { return { options: [] }; },
          async prepareTicket({ input, connection, transport }) {
            syncProviderCalls.prepare.push(input);
            syncProviderCalls.connections.push(connection);
            syncProviderCalls.transports.push(transport);
            return { payload: { summary: input.content.summary, details: input.content.details, detailsHtml: input.content.detailsHtml || '' }, comparisonValue: JSON.stringify(input.comparisonInput), comparisonVersion: 'sync-fixture-v1' };
          },
          async getTicket({ input, connection, transport }) {
            const ref = input.externalTicketRef;
            syncProviderCalls.get.push(ref.id);
            syncProviderCalls.connections.push(connection);
            syncProviderCalls.transports.push(transport);
            const ticket = syncTicketState.get(`connectwise-psa:${ref.id}`);
            return ticket
              ? { state: 'found', openState: ticket.openState, externalTicketRef: ticket.externalTicketRef, comparisonValue: ticket.comparisonValue, comparisonVersion: ticket.comparisonVersion }
              : { state: 'missing', confirmed: true };
          },
          async createTicket({ input, connection, transport }) {
            syncProviderCalls.create.push(input);
            syncProviderCalls.connections.push(connection);
            syncProviderCalls.transports.push(transport);
            const failure = syncTicketState.get('connectwise-psa:create-error');
            if (failure) throw failure;
            syncTicketSequence += 1;
            const ref = { id: `ticket-fixture-${syncTicketSequence}`, displayId: `FIX-${syncTicketSequence}` };
            syncTicketState.set(`connectwise-psa:${ref.id}`, { openState: 'open', externalTicketRef: ref, comparisonValue: input.comparisonValue, comparisonVersion: input.comparisonVersion });
            return { externalTicketRef: ref };
          },
          async updateTicket({ input, connection, transport }) {
            syncProviderCalls.update.push(input);
            syncProviderCalls.connections.push(connection);
            syncProviderCalls.transports.push(transport);
            const failure = syncTicketState.get('connectwise-psa:update-error');
            if (failure) throw failure;
            const ticket = syncTicketState.get(`connectwise-psa:${input.externalTicketRef.id}`);
            if (!ticket) return { ok: false };
            ticket.comparisonValue = JSON.stringify(input.preparedTicket);
            return { ok: true, externalTicketRef: ticket.externalTicketRef };
          }
        }
      }
    })
  };
}

// Sync integration tests use an isolated test-created provider dispatcher. The
// static production registry contains no test adapter and remains unavailable.
async function runTicketingSync(context, request) {
  return runTicketingSyncImplementation(context, request, {
    ...createInMemorySyncDependencies(),
    async runtimeConfigLoader(runtimeContext) {
      const config = await loadRuntimeConfig(runtimeContext);
      config.ticketDestination.ticketTypeId = 'synthetic-ticket-type';
      config.ticketDestination.closedStatusIds = ['synthetic-closed-status'];
      config.providerSettings = { providerFixtureCredential: 'synthetic-run-secret' };
      return config;
    }
  });
}

function primeSyncTicket(id, openState) {
  const externalTicketRef = { id: String(id) };
  syncTicketState.set(`connectwise-psa:${id}`, { openState, externalTicketRef, comparisonValue: 'previous', comparisonVersion: 'sync-fixture-v1' });
}

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
          apiSecret: 'action1-client-secret',
          organizationId: 'org-tenant',
          baseUrl: 'https://app.na-2.action1.com/api/3.0/'
        };
      }
    },
    settings: {
      async all() {
        return {
          TicketingResourceServer: 'https://halo.example.com/api',
          TicketingAuthorisationServer: 'https://halo.example.com/auth',
          TicketingClientId: 'halo-client-id',
          TicketingClientSecret: 'halo-client-secret',
          TicketingTicketTypeId: '35',
          TicketingClosedStatusIds: '900',
          TicketingOfflineEnabled: 'true',
          TicketingOfflineThresholdDays: '7',
          TicketingRebootRequiredEnabled: 'true',
          TicketingAutomationFailedEnabled: 'true',
          TicketingAutomationFailedLookbackHours: '24',
          TicketingVulnerabilitySeverities: 'high',
          TicketingVulnerabilityRemediationStatuses: 'overdue',
          TicketingUpdateSeverities: 'important',
          TicketingUpdateRemediationStatuses: 'overdue',
          TicketingVulnerabilityTicketModel: 'grouped',
          TicketingUpdateTicketModel: 'grouped',
          TicketingAutomationFailedTicketModel: 'grouped',
          ...(overrides.settings || {})
        };
      },
      async get() {
        return '';
      }
    },
    db: {
      async all(sql, params = []) {
        if (sql.includes('FROM action1_ticketing_org_client_mappings')) {
          return state.mappings.filter((row) => !row.providerId || row.providerId === params[0]).map((row, index) => ({
            id: row.id ?? index + 1,
            provider_id: row.providerId || params[0],
            action1_org_id: row.action1OrgId,
            action1_org_name: row.action1OrgName,
            destination_id: row.destinationId || row.haloClientId,
            destination_name: row.destinationName || row.haloClientName,
            enabled: 1
          }));
        }
        if (sql.includes('FROM action1_ticketing_endpoint_correlations')) {
          return state.endpoint.filter((row) => row.provider_id === params[0] && row.org_link_id === params[1]);
        }
        if (sql.includes('FROM action1_ticketing_grouped_correlations')) {
          return state.grouped.filter((row) => row.provider_id === params[0] && row.org_link_id === params[1]);
        }
        return [];
      },
      async get(sql, params = []) {
        if (sql.includes('FROM action1_ticketing_org_client_mappings')) {
          const mapping = state.mappings.find((row, index) => (row.providerId || 'connectwise-psa') === params[0] && Number(row.id ?? index + 1) === Number(params[1]));
          if (!mapping) return null;
          const index = state.mappings.indexOf(mapping);
          return {
            id: mapping.id ?? index + 1,
            provider_id: mapping.providerId || params[0],
            action1_org_id: mapping.action1OrgId,
            action1_org_name: mapping.action1OrgName,
            destination_id: mapping.destinationId || mapping.haloClientId,
            destination_name: mapping.destinationName || mapping.haloClientName,
            enabled: 1
          };
        }
        if (sql.includes('FROM action1_ticketing_endpoint_correlations')) {
          return state.endpoint.find((row) => row.provider_id === params[0] && row.org_link_id === params[1] && row.endpoint_id === params[2] && row.signal_type === params[3]) || null;
        }
        if (sql.includes('FROM action1_ticketing_grouped_correlations')) {
          return state.grouped.find((row) => row.provider_id === params[0] && row.org_link_id === params[1] && row.signal_type === params[2] && row.issue_key === params[3]) || null;
        }
        if (sql.includes('FROM action1_ticketing_signal_watermarks')) {
          return state.watermarks.find((row) => row.provider_id === params[0] && row.org_link_id === params[1] && row.signal_type === params[2]) || null;
        }
        return null;
      },
      async run(sql, params = []) {
        const normalizedSql = String(sql).trimStart();
        if (normalizedSql.startsWith('INSERT INTO action1_ticketing_endpoint_correlations')) {
          state.endpoint.push({
            provider_id: params[0],
            org_link_id: params[3],
            endpoint_id: params[5],
            signal_type: params[6],
            external_ticket_id: params[7],
            linked_ticket_id: params[7],
            external_display_id: params[8],
            external_url: params[9],
            provider_metadata_json: params[10],
            comparison_value: params[11],
            payload_hash: params[11],
            comparison_version: params[12],
            observed_status_id: params[13],
            observed_status_name: params[14]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE action1_ticketing_endpoint_correlations')) {
          const row = state.endpoint.find((entry) => entry.provider_id === params[13] && entry.org_link_id === params[14] && entry.endpoint_id === params[15] && entry.signal_type === params[16]);
          if (row) {
            row.provider_id = params[0];
            row.identity_key = params[1];
            row.action1_org_id = params[2];
            row.external_ticket_id = params[3];
            row.linked_ticket_id = params[3];
            row.external_display_id = params[4];
            row.external_url = params[5];
            row.provider_metadata_json = params[6];
            row.comparison_value = params[7];
            row.payload_hash = params[7];
            row.comparison_version = params[8];
            row.observed_status_id = params[9];
            row.observed_status_name = params[10];
            row.created_at = params[11];
            row.updated_at = params[12];
          }
          return;
        }
        if (normalizedSql.startsWith('DELETE FROM action1_ticketing_endpoint_correlations')) {
          state.endpoint = state.endpoint.filter((row) => !(row.provider_id === params[0] && row.org_link_id === params[1] && row.endpoint_id === params[2] && row.signal_type === params[3]));
          return;
        }
        if (normalizedSql.startsWith('INSERT INTO action1_ticketing_grouped_correlations')) {
          state.grouped.push({
            provider_id: params[0],
            org_link_id: params[3],
            signal_type: params[5],
            issue_key: params[6],
            external_ticket_id: params[7],
            linked_ticket_id: params[7],
            external_display_id: params[8],
            external_url: params[9],
            provider_metadata_json: params[10],
            comparison_value: params[11],
            payload_hash: params[11],
            comparison_version: params[12],
            observed_status_id: params[13],
            observed_status_name: params[14]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE action1_ticketing_grouped_correlations')) {
          const row = state.grouped.find((entry) => entry.provider_id === params[13] && entry.org_link_id === params[14] && entry.signal_type === params[15] && entry.issue_key === params[16]);
          if (row) {
            row.provider_id = params[0];
            row.identity_key = params[1];
            row.action1_org_id = params[2];
            row.external_ticket_id = params[3];
            row.linked_ticket_id = params[3];
            row.external_display_id = params[4];
            row.external_url = params[5];
            row.provider_metadata_json = params[6];
            row.comparison_value = params[7];
            row.payload_hash = params[7];
            row.comparison_version = params[8];
            row.observed_status_id = params[9];
            row.observed_status_name = params[10];
            row.created_at = params[11];
            row.updated_at = params[12];
          }
          return;
        }
        if (normalizedSql.startsWith('DELETE FROM action1_ticketing_grouped_correlations')) {
          state.grouped = state.grouped.filter((row) => !(row.provider_id === params[0] && row.org_link_id === params[1] && row.signal_type === params[2] && row.issue_key === params[3]));
          return;
        }
        if (normalizedSql.startsWith('INSERT INTO action1_ticketing_signal_watermarks')) {
          state.watermarks.push({
            provider_id: params[0],
            org_link_id: params[2],
            signal_type: params[4],
            watermark_value: params[5],
            watermark_at: params[6],
            metadata_json: params[7]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE action1_ticketing_signal_watermarks')) {
          const row = state.watermarks.find((entry) => entry.provider_id === params[7] && entry.org_link_id === params[8] && entry.signal_type === params[9]);
          if (row) {
            row.provider_id = params[0];
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
    TicketingResourceServer: 'https://halo.example.com/api',
    TicketingAuthorisationServer: 'https://halo.example.com/auth',
    TicketingClientId: 'halo-client-id',
    TicketingClientSecret: 'halo-client-secret'
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
      resourceServer: settings.TicketingResourceServer,
      authorisationServer: settings.TicketingAuthorisationServer,
      clientId: settings.TicketingClientId,
      clientSecret: settings.TicketingClientSecret
    })
  });

  await authClient.requestResource({ method: 'GET', path: '/Tickets/3960', runId: 'halo-ticket-get' });

  assert.strictEqual(discoveryToken.accessToken, 'halo-token-shared', 'discovery requests should still return the resolved Halo access token');
  assert.strictEqual(calls.filter((request) => String(request.url).endsWith('/token')).length, 1, 'discovery and runtime Halo requests should share one fresh token per auth context');
}

function runVulnerabilityFilterCombinationPlanningTest() {
  const plan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: ['MEDIUM', 'LOW'],
    remediationStatuses: ['OVERDUE']
  });

  assert.strictEqual(plan.strategy, 'server-filtered', 'medium+low+overdue should use server-filtered vulnerability collection');
  assert.strictEqual(plan.requests.length, 2, 'medium+low+overdue should plan one request per score/remediation combination');
  assert.deepStrictEqual(
    plan.requests.map((row) => `${row.score}|${row.remediationStatus}`),
    ['Medium|Overdue', 'Low|Overdue'],
    'planned requests should use canonical Action1 filter values'
  );
}

function runVulnerabilitySeverityOnlyPlanningTest() {
  const plan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: ['CRITICAL', 'HIGH'],
    remediationStatuses: []
  });

  assert.strictEqual(plan.strategy, 'server-filtered', 'severity-only vulnerability rules should still use server filtering');
  assert.deepStrictEqual(
    plan.requests.map((row) => row.score),
    ['Critical', 'High'],
    'severity-only planning should emit one request per severity'
  );
  assert.deepStrictEqual(
    plan.requests.map((row) => row.remediationStatus),
    ['', ''],
    'severity-only planning should not emit remediation params'
  );
}

function runVulnerabilityRemediationOnlyPlanningTest() {
  const plan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: [],
    remediationStatuses: ['OVERDUE']
  });

  assert.strictEqual(plan.strategy, 'server-filtered', 'remediation-only vulnerability rules should still use server filtering when planned directly');
  assert.deepStrictEqual(
    plan.requests.map((row) => row.remediationStatus),
    ['Overdue'],
    'remediation-only planning should emit one request per remediation status'
  );
  assert.deepStrictEqual(
    plan.requests.map((row) => row.score),
    [''],
    'remediation-only planning should not emit score params'
  );
}

function runVulnerabilityDueSoonPlanningTest() {
  const mediumOnlyPlan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: ['MEDIUM'],
    remediationStatuses: ['DUE_SOON']
  });

  assert.strictEqual(mediumOnlyPlan.strategy, 'server-filtered', 'medium+due soon should still use server-filtered vulnerability collection');
  assert.deepStrictEqual(
    mediumOnlyPlan.requests.map((row) => `${row.score}|${row.remediationStatus}`),
    ['Medium|Due_soon'],
    'due-soon planning should map the remediation query value to the Action1-specific Due_soon form'
  );

  const multiSeverityPlan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: ['CRITICAL', 'MEDIUM'],
    remediationStatuses: ['DUE_SOON']
  });
  assert.deepStrictEqual(
    multiSeverityPlan.requests.map((row) => `${row.score}|${row.remediationStatus}`),
    ['Critical|Due_soon', 'Medium|Due_soon'],
    'critical+medium+due soon should plan one filtered request per severity with the Due_soon remediation query value'
  );

  const dueSoonOnlyPlan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: [],
    remediationStatuses: ['DUE_SOON']
  });
  assert.deepStrictEqual(
    dueSoonOnlyPlan.requests.map((row) => row.remediationStatus),
    ['Due_soon'],
    'remediation-only due-soon planning should still emit the Action1-specific Due_soon query value'
  );
}

function runVulnerabilityNoFilterPlanningFallbackTest() {
  const plan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: [],
    remediationStatuses: []
  });

  assert.strictEqual(plan.strategy, 'broad', 'missing usable vulnerability filters should fall back to the current broad fetch');
  assert.strictEqual(plan.reason, 'no_usable_filters', 'broad fallback should record the no-filter reason');
  assert.strictEqual(plan.requests.length, 0, 'broad fallback should not plan filtered requests');
}

function runVulnerabilityCombinationCapFallbackTest() {
  const plan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan(
    {
      severities: ['CRITICAL', 'HIGH', 'MEDIUM'],
      remediationStatuses: ['OVERDUE', 'DUE_SOON']
    },
    { maxCombinations: 4 }
  );

  assert.strictEqual(plan.strategy, 'broad', 'planned vulnerability combinations beyond the cap should fall back to broad fetch');
  assert.strictEqual(plan.reason, 'combination_cap_exceeded', 'cap fallback should be explicit');
}

function runVulnerabilityUnknownValuePlanningTest() {
  const remediationOnlyPlan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: ['UNKNOWN'],
    remediationStatuses: ['OVERDUE']
  });
  assert.strictEqual(remediationOnlyPlan.strategy, 'server-filtered', 'unknown severity values should be excluded while retaining known remediation filters');
  assert.deepStrictEqual(
    remediationOnlyPlan.requests.map((row) => `${row.score}|${row.remediationStatus}`),
    ['|Overdue'],
    'known vulnerability filters should survive unknown-value exclusion'
  );

  const broadFallbackPlan = action1CollectionPrivate.buildVulnerabilityServerFilterPlan({
    severities: ['UNKNOWN'],
    remediationStatuses: ['NOT_REAL']
  });
  assert.strictEqual(broadFallbackPlan.strategy, 'broad', 'unsupported vulnerability filter values should broad-fallback before any filtered request is attempted');
  assert.strictEqual(broadFallbackPlan.reason, 'no_supported_filter_values', 'unsupported-value fallback should be explicit');
}

function runVulnerabilityFilterBreakdownHelperTest() {
  const breakdown = action1CollectionPrivate.buildVulnerabilityFilterBreakdown(
    { score: 'Critical', remediationStatus: 'Overdue' },
    [
      { cve_id: 'CVE-1' },
      { cve_id: 'CVE-1' },
      { cve_id: 'CVE-2' },
      { cve_id: '' }
    ],
    { pagesFetched: 2, rawRowsFetched: 4 },
    { sampleLimit: 2 }
  );

  assert.strictEqual(breakdown.pagesFetched, 2, 'per-filter breakdown should report fetched pages');
  assert.strictEqual(breakdown.rawRowsFetched, 4, 'per-filter breakdown should report raw row counts');
  assert.strictEqual(breakdown.uniqueCves, 2, 'per-filter breakdown should report unique canonical CVE count');
  assert.strictEqual(breakdown.duplicateCvesWithinFilter, 1, 'per-filter breakdown should report duplicate CVEs within one filter response');
  assert.strictEqual(breakdown.rowsMissingCanonicalCve, 1, 'per-filter breakdown should report rows without canonical CVE ids');
  assert.deepStrictEqual(breakdown.sampleCves, ['CVE-1', 'CVE-2'], 'per-filter sample CVEs should be capped and preserve first-seen order');
}

function runVulnerabilityCrossFilterDuplicateDiagnosticsHelperTest() {
  const zeroOverlap = action1CollectionPrivate.buildCrossFilterDuplicateDiagnostics(
    [
      action1CollectionPrivate.buildVulnerabilityFilterBreakdown(
        { score: 'Critical', remediationStatus: 'Overdue' },
        [{ cve_id: 'CVE-1' }, { cve_id: 'CVE-2' }],
        { pagesFetched: 1, rawRowsFetched: 2 }
      ),
      action1CollectionPrivate.buildVulnerabilityFilterBreakdown(
        { score: 'Critical', remediationStatus: 'Due_soon' },
        [{ cve_id: 'CVE-3' }, { cve_id: 'CVE-4' }],
        { pagesFetched: 1, rawRowsFetched: 2 }
      )
    ],
    { sampleLimit: 5 }
  );
  assert.strictEqual(zeroOverlap.crossFilterDuplicateCves, 0, 'cross-filter diagnostics should report zero duplicate CVEs when responses do not overlap');
  assert.strictEqual(zeroOverlap.crossFilterDuplicatePairs[0].duplicateCves, 0, 'cross-filter pair counts should stay zero when responses do not overlap');

  const overlappingRows = Array.from({ length: 6 }, (_, index) => ({ cve_id: `CVE-${index + 1}` }));
  const overlap = action1CollectionPrivate.buildCrossFilterDuplicateDiagnostics(
    [
      action1CollectionPrivate.buildVulnerabilityFilterBreakdown(
        { score: 'Critical', remediationStatus: 'Overdue' },
        overlappingRows,
        { pagesFetched: 1, rawRowsFetched: 6 },
        { sampleLimit: 5 }
      ),
      action1CollectionPrivate.buildVulnerabilityFilterBreakdown(
        { score: 'Critical', remediationStatus: 'Due_soon' },
        overlappingRows,
        { pagesFetched: 1, rawRowsFetched: 6 },
        { sampleLimit: 5 }
      )
    ],
    { sampleLimit: 5 }
  );
  assert.strictEqual(overlap.crossFilterDuplicateCves, 6, 'cross-filter diagnostics should report duplicate CVEs that appear across filtered responses');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].duplicateCves, 6, 'cross-filter pair counts should reflect overlapping canonical CVEs');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].sampleCves.length, 5, 'cross-filter diagnostic samples should be capped');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].left, 'score=Critical remediation_status=Overdue', 'cross-filter diagnostics should label the left filter clearly');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].right, 'score=Critical remediation_status=Due_soon', 'cross-filter diagnostics should label the right filter clearly');
}

function runUpdateSeverityOnlyPlanningTest() {
  const plan = action1CollectionPrivate.buildUpdateServerFilterPlan({
    severities: ['CRITICAL', 'MODERATE'],
    remediationStatuses: ['OVERDUE']
  });

  assert.strictEqual(plan.strategy, 'server-filtered', 'supported update severities should use server-filtered update collection');
  assert.deepStrictEqual(
    plan.requests.map((row) => row.securitySeverity),
    ['Critical', 'Moderate'],
    'update planning should emit one request per supported severity using canonical Action1 values'
  );
}

function runUpdateNoFilterPlanningFallbackTest() {
  const plan = action1CollectionPrivate.buildUpdateServerFilterPlan({
    severities: [],
    remediationStatuses: ['OVERDUE']
  });

  assert.strictEqual(plan.strategy, 'broad', 'remediation-only update rules should preserve the current broad top-level collection');
  assert.strictEqual(plan.reason, 'no_usable_structured_filters', 'remediation-only update fallback should be explicit');
  assert.strictEqual(plan.requests.length, 0, 'broad update fallback should not plan filtered requests');
}

function runUpdateUnknownValuePlanningFallbackTest() {
  const plan = action1CollectionPrivate.buildUpdateServerFilterPlan({
    severities: ['NOT_REAL'],
    remediationStatuses: ['OVERDUE']
  });

  assert.strictEqual(plan.strategy, 'broad', 'unsupported update severity values should broad-fallback before any filtered request is attempted');
  assert.strictEqual(plan.reason, 'no_supported_filter_values', 'unsupported update-value fallback should be explicit');
}

function runUpdateTopLevelUrlPlanningTest() {
  const filteredUrl = action1CollectionPrivate.buildUpdateTopLevelUrl('https://example.action1.test/api/3.0', 'org-1', 50, {
    securitySeverity: 'Important'
  });
  const broadUrl = action1CollectionPrivate.buildUpdateTopLevelUrl('https://example.action1.test/api/3.0', 'org-1', 50);

  assert(filteredUrl.includes('/updates/org-1?'), 'filtered update URL should target the top-level updates endpoint');
  assert(filteredUrl.includes('fields=*'), 'filtered update URL should preserve fields=*');
  assert(filteredUrl.includes('limit=50'), 'filtered update URL should preserve the current list limit');
  assert(filteredUrl.includes('from=0'), 'filtered update URL should preserve the current paging start');
  assert(filteredUrl.includes('security_severity=Important'), 'filtered update URL should use the exact validated Action1 query value');
  assert.strictEqual(filteredUrl.includes('filter='), false, 'filtered update URL should not use the generic filter parameter');
  assert.strictEqual(filteredUrl.includes('update_sla_status='), false, 'filtered update URL should not use a structured update_sla_status parameter');
  assert.strictEqual(broadUrl.includes('security_severity='), false, 'broad update URL should not emit a severity filter');
}

function runUpdateFilterBreakdownHelperTest() {
  const breakdown = action1CollectionPrivate.buildUpdateFilterBreakdown(
    { securitySeverity: 'Important' },
    [
      { packageId: 'pkg-1', versionId: 'ver-1' },
      { packageId: 'pkg-1', versionId: 'ver-1' },
      { packageId: 'pkg-2', versionId: 'ver-2' },
      { packageId: '', versionId: 'ver-3' }
    ],
    { pagesFetched: 2, rawRowsFetched: 4 },
    { sampleLimit: 2 }
  );

  assert.strictEqual(breakdown.pagesFetched, 2, 'per-filter update breakdown should report fetched pages');
  assert.strictEqual(breakdown.rawRowsFetched, 4, 'per-filter update breakdown should report raw row counts');
  assert.strictEqual(breakdown.uniquePackageVersionKeys, 2, 'per-filter update breakdown should report unique package/version keys');
  assert.strictEqual(breakdown.duplicatePackageVersionKeysWithinFilter, 1, 'per-filter update breakdown should report duplicate package/version keys within one filter response');
  assert.strictEqual(breakdown.rowsMissingPackageVersionKey, 1, 'per-filter update breakdown should report rows without package/version keys');
  assert.deepStrictEqual(breakdown.sampleUpdateKeys, ['pkg-1:ver-1', 'pkg-2:ver-2'], 'per-filter update key samples should be capped and preserve first-seen order');
}

function runUpdateCrossFilterDuplicateDiagnosticsHelperTest() {
  const overlap = action1CollectionPrivate.buildUpdateCrossFilterDuplicateDiagnostics(
    [
      action1CollectionPrivate.buildUpdateFilterBreakdown(
        { securitySeverity: 'Critical' },
        [{ packageId: 'pkg-1', versionId: 'ver-1' }, { packageId: 'pkg-2', versionId: 'ver-2' }],
        { pagesFetched: 1, rawRowsFetched: 2 }
      ),
      action1CollectionPrivate.buildUpdateFilterBreakdown(
        { securitySeverity: 'Important' },
        [{ packageId: 'pkg-2', versionId: 'ver-2' }, { packageId: 'pkg-3', versionId: 'ver-3' }],
        { pagesFetched: 1, rawRowsFetched: 2 }
      )
    ],
    { sampleLimit: 5 }
  );

  assert.strictEqual(overlap.crossFilterDuplicateKeys, 1, 'update cross-filter diagnostics should report duplicate package/version keys');
  assert.strictEqual(overlap.crossFilterDuplicatePairs.length, 1, 'update cross-filter diagnostics should report one filter pair');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].duplicateKeys, 1, 'update cross-filter pair counts should reflect overlap size');
  assert.deepStrictEqual(overlap.crossFilterDuplicatePairs[0].sampleUpdateKeys, ['pkg-2:ver-2'], 'update cross-filter pair samples should be capped and preserve first-seen order');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].left, 'security_severity=Critical', 'update cross-filter diagnostics should label the left filter clearly');
  assert.strictEqual(overlap.crossFilterDuplicatePairs[0].right, 'security_severity=Important', 'update cross-filter diagnostics should label the right filter clearly');
}

async function runMissingConfigFailsSafelyTest() {
  const logs = [];
  const context = createSyncContext();
  context.settings.all = async () => ({});

  const result = await runTicketingSync(context, {
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
  assert(logs.some((entry) => entry.includes('Loading Action1 Ticketing runtime configuration')), 'sync should log config-loading before validation failures');
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
      TicketingOfflineEnabled: 'true',
      TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  context.action1.getCredentials = async () => ({ apiKey: '', apiSecret: '' });

  const result = await runTicketingSync(context, {
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
  const priorCreates = syncProviderCalls.create.length;
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
  const marketplaceHttp = async () => { throw new Error('test fixture does not perform vendor HTTP'); };
  context.http = marketplaceHttp;
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
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runTicketingSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed(count) {
          processed = count;
        }
      }
    });

    assert.strictEqual(result.summary.created >= 1, true, 'in-memory destination fixtures preserve donor lifecycle characterization');
    assert.strictEqual(result.assetsProcessed, processed, 'sync should return assetsProcessed so the Marketplace host preserves the final count');
    assert(result.details.includes('ACTION1_TICKETING_SYNC_SUMMARY_BEGIN'), 'sync should return a delimited Action1 Ticketing summary block start marker');
    assert(result.details.includes('ACTION1_TICKETING_SYNC_SUMMARY_END'), 'sync should return a delimited Action1 Ticketing summary block end marker');
    assert(/(?:^|\n)created:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with created counts');
    assert(/(?:^|\n)updated:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with updated counts');
    assert(/(?:^|\n)skipped:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with skipped counts');
    assert(/(?:^|\n)failed:\s*\d+/i.test(result.details), 'sync should return host-compatible details text with failed counts');
    assert.strictEqual(typeof processed, 'number', 'sync should report processed assets through request.run');
    assert(runLogs.some((entry) => entry.includes('Starting Action1 Ticketing sync')), 'sync should append operator-visible run logs');
    assert(runLogs.some((entry) => entry.includes('Action1 Ticketing runtime configuration loaded')), 'sync should log when runtime configuration is loaded');
    assert(runLogs.some((entry) => entry.includes('Starting Action1 collection')), 'sync should log the Action1 collection phase');
    assert(runLogs.some((entry) => entry.includes('Candidate pipeline completed')), 'sync should log candidate pipeline completion');
    assert(runLogs.some((entry) => entry.includes('Lifecycle execution completed')), 'sync should log lifecycle completion');
    assert(fetchCalls.some((call) => call.url.endsWith('/oauth2/token')), 'sync should read Action1 credentials through Marketplace-owned Action1 auth');
    assert.strictEqual(syncProviderCalls.create.length > priorCreates, true, 'the isolated provider fixture should receive lifecycle CREATE operations');
    assert(syncProviderCalls.transports.includes(marketplaceHttp), 'Sync forwards context.http through the lifecycle service to provider operations');
    assert(syncProviderCalls.connections.some((connection) => connection?.providerFixtureCredential === 'synthetic-run-secret'), 'provider operations should receive only the captured provider connection');
    assert.strictEqual(result.providerId, 'connectwise-psa', 'run result should include the captured active provider ID');
    assert.strictEqual(result.providerLabel, 'ConnectWise PSA', 'run result should include the static provider label');
    assert(result.details.includes('providerId: connectwise-psa'), 'run details should persist provider attribution for History');
    assert.strictEqual(result.details.includes('synthetic-run-secret'), false, 'run details must not expose provider credentials');
    assert.strictEqual(fetchCalls.some((call) => /halo|\/api\/Tickets|\/api\/Category/i.test(call.url)), false, 'lifecycle flow performs no Halo destination requests');
    assert.strictEqual(context.state.endpoint.length + context.state.grouped.length >= 1, true, 'fixture should preserve correlation lifecycle characterization');
    assert.strictEqual(context.state.watermarks.length >= 1, true, 'fixture should preserve automation watermark characterization');
  });
}

async function runDiagnosticFileWriteFailureDoesNotFailSyncTest() {
  const fetchCalls = [];
  const warningLogs = [];
  const originalConsoleWarn = console.warn;
  console.warn = (message) => warningLogs.push(String(message));
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
      TicketingOfflineEnabled: 'true',
      TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: '',
      TicketingDiagnosticLoggingEnabled: 'true'
    }
  });
  context.logger = {
    info() {},
    debug() {},
    error() {},
    warn(message) {
      warningLogs.push(String(message));
    }
  };

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'action1-ticketing-sync-log-failure-'));
  const blockingPath = path.join(tempDir, 'blocked-path.txt');
  fs.writeFileSync(blockingPath, 'not a directory');
  const originalLogDir = process.env.HALO_PSA_LOG_DIR;
  const originalDataDir = process.env.DATA_DIR;
  process.env.HALO_PSA_LOG_DIR = blockingPath;
  delete process.env.DATA_DIR;

  try {
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
          items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'no' }],
          from: 0,
          total_items: 1
        });
      }
      if (urlText.endsWith('/auth/token')) {
        return textResponse({ access_token: 'halo-token', token_type: 'Bearer', expires_in: 3600 });
      }
      if (urlText.includes('/api/Tickets')) {
        return textResponse([{ id: 'ticket-1', status_id: '3', status: 'Open', is_closed: false }]);
      }
      throw new Error(`Unexpected fetch ${urlText}`);
    }, async () => {
      const result = await runTicketingSync(context, {
        run: {
          async appendLog() {},
          async setAssetsProcessed() {}
        }
      });

      assert.strictEqual(result.ok, true, 'sync should still succeed when diagnostic file writes fail');
      assert.strictEqual(result.summary.created, 1, 'offline-only sync fixture should still create the expected ticket');
      const warningMatches = warningLogs.filter((entry) => entry.includes('diagnostic file logging'));
      assert.strictEqual(warningMatches.length, 1, 'diagnostic file write failures during sync should warn once');
      assert.strictEqual(
        warningMatches[0].includes('"filePath"') && warningMatches[0].includes('action1-ticketing-runtime.log'),
        true,
        'sync warning should include the resolved diagnostic file path'
      );
      assert.strictEqual(/(ENOTDIR|EEXIST|EPERM|not a directory)/i.test(warningMatches[0]), true, 'sync warning should include a safe filesystem error');
    });
  } finally {
    console.warn = originalConsoleWarn;
    if (originalLogDir === undefined) {
      delete process.env.HALO_PSA_LOG_DIR;
    } else {
      process.env.HALO_PSA_LOG_DIR = originalLogDir;
    }
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
  }
}

async function runVulnerabilityServerFilteredCollectionOptimizationTest() {
  const fetchCalls = [];
  const runLogs = [];
  const diagnosticLogs = [];
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
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'true',
      TicketingVulnerabilitySeverities: 'medium,low',
      TicketingVulnerabilityRemediationStatuses: 'overdue',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: '',
      TicketingDiagnosticLoggingEnabled: 'true'
    }
  });
  context.logger = {
    debug(message) {
      diagnosticLogs.push(String(message));
    },
    info(message) {
      diagnosticLogs.push(String(message));
    },
    warn(message) {
      diagnosticLogs.push(String(message));
    },
    error(message) {
      diagnosticLogs.push(String(message));
    }
  };

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
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
          { id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00' },
          { id: 'ep-2', name: 'Endpoint Two', last_seen: '2026-06-01_00-00-00' },
          { id: 'ep-3', name: 'Endpoint Three', last_seen: '2026-06-01_00-00-00' }
        ],
        from: 0,
        total_items: 3
      });
    }
    if (urlText.includes('/vulnerabilities/org-1?') && urlText.includes('score=Medium') && urlText.includes('remediation_status=Overdue')) {
      return textResponse({
        items: [
          { cve_id: 'CVE-MEDIUM-1', severity: 'Medium', remediation_status: 'Overdue' },
          { cve_id: 'CVE-REJECT-HIGH', severity: 'High', remediation_status: 'Overdue' },
          { cve_id: 'CVE-DUP-1', severity: 'Medium', remediation_status: 'Overdue' }
        ],
        from: 0,
        total_items: 3
      });
    }
    if (urlText.includes('/vulnerabilities/org-1?') && urlText.includes('score=Low') && urlText.includes('remediation_status=Overdue')) {
      return textResponse({
        items: [
          { cve_id: 'CVE-LOW-1', severity: 'Low', remediation_status: 'Overdue' },
          { cve_id: 'CVE-DUP-1', severity: 'Low', remediation_status: 'Overdue' }
        ],
        from: 0,
        total_items: 2
      });
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-MEDIUM-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-LOW-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-2' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-DUP-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-3' }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse({ access_token: 'halo-token', token_type: 'Bearer', expires_in: 3600 });
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
    const result = await runTicketingSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'filtered vulnerability collection should still complete successfully');
    assert.strictEqual(result.summary.bySignalType.VULNERABILITY, 3, 'qualified vulnerability CVEs should still produce the same downstream grouped candidates');
    const vulnerabilityListUrls = fetchCalls
      .map((call) => call.url)
      .filter((url) => url.includes('/vulnerabilities/org-1?'));
    assert.strictEqual(vulnerabilityListUrls.length, 2, 'medium+low+overdue should plan exactly two filtered top-level vulnerability requests');
    assert(vulnerabilityListUrls.every((url) => url.includes('remediation_status=Overdue')), 'filtered vulnerability requests should include remediation_status');
    assert(vulnerabilityListUrls.some((url) => url.includes('score=Medium')), 'filtered vulnerability requests should include the Medium score query');
    assert(vulnerabilityListUrls.some((url) => url.includes('score=Low')), 'filtered vulnerability requests should include the Low score query');
    assert(vulnerabilityListUrls.every((url) => url.includes('sortby=cve_id')), 'filtered vulnerability requests should include sortby=cve_id');

    const endpointFanoutUrls = fetchCalls
      .map((call) => call.url)
      .filter((url) => url.includes('/vulnerabilities/org-1/') && url.includes('/endpoints'));
    assert.strictEqual(endpointFanoutUrls.some((url) => url.includes('/CVE-REJECT-HIGH/endpoints')), false, 'server-returned rows that fail local qualification should not trigger endpoint fan-out');
    assert.strictEqual(
      endpointFanoutUrls.filter((url) => url.includes('/CVE-DUP-1/endpoints')).length,
      1,
      'duplicate top-level CVE rows should only trigger one endpoint fan-out request'
    );
    assert.strictEqual(endpointFanoutUrls.length, 3, 'endpoint fan-out should only happen for qualified, deduped CVEs');
    assert.strictEqual(context.state.grouped.length, 3, 'downstream grouped vulnerability identity/correlation behavior should remain unchanged');
    assert(runtimeLogLines().some((entry) => entry.includes('vulnerabilityFilterStrategy":"server-filtered')), 'detailed diagnostics should report the vulnerability filter strategy');
    assert(runtimeLogLines().some((entry) => entry.includes('topLevelUniqueCvesAfterDedupe":"4"')), 'detailed diagnostics should add a clearer unique-CVE metric after dedupe');
    assert(runtimeLogLines().some((entry) => entry.includes('crossFilterDuplicateCves":"1"')), 'detailed diagnostics should report cross-filter duplicate CVE counts');
    assert(runtimeLogLines().some((entry) => entry.includes('serverFilterBreakdown":[{"score":"Medium","remediation_status":"Overdue","pagesFetched":"1","rawRowsFetched":"3","uniqueCves":"3","duplicateCvesWithinFilter":"0","rowsMissingCanonicalCve":"0","sampleCves":["CVE-MEDIUM-1","CVE-REJECT-HIGH","CVE-DUP-1"]},{"score":"Low","remediation_status":"Overdue","pagesFetched":"1","rawRowsFetched":"2","uniqueCves":"2","duplicateCvesWithinFilter":"0","rowsMissingCanonicalCve":"0","sampleCves":["CVE-LOW-1","CVE-DUP-1"]}]')), 'detailed diagnostics should report per-filter breakdown details');
    assert(runtimeLogLines().some((entry) => entry.includes('crossFilterDuplicatePairs":[{"left":"score=Medium remediation_status=Overdue","right":"score=Low remediation_status=Overdue","duplicateCves":"1","sampleCves":["CVE-DUP-1"]}]')), 'detailed diagnostics should report overlapping filter pairs with capped CVE samples');
    assert(runtimeLogLines().some((entry) => entry.includes('deepEndpointFetchesCompleted":"3"')), 'detailed diagnostics should report vulnerability endpoint fan-out counts');
  });
}

async function runVulnerabilityDueSoonFilteredUrlMappingTest() {
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
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'true',
      TicketingVulnerabilitySeverities: 'critical,medium',
      TicketingVulnerabilityRemediationStatuses: 'due soon',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse({ access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse({ items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/vulnerabilities/org-1?') && urlText.includes('score=Critical') && urlText.includes('remediation_status=Due_soon')) {
      return textResponse({ items: [], from: 0, total_items: 0 });
    }
    if (urlText.includes('/vulnerabilities/org-1?') && urlText.includes('score=Medium') && urlText.includes('remediation_status=Due_soon')) {
      return textResponse({
        items: [{ cve_id: 'CVE-DUE-SOON-1', severity: 'Medium', remediation_status: 'Due Soon' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-DUE-SOON-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse({ access_token: 'halo-token', token_type: 'Bearer', expires_in: 3600 });
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
    const result = await runTicketingSync(context, {
      run: {
        async appendLog() {},
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'due-soon filtered vulnerability collection should still complete successfully');
    const vulnerabilityListUrls = fetchCalls
      .map((call) => call.url)
      .filter((url) => url.includes('/vulnerabilities/org-1?'));
    assert.strictEqual(vulnerabilityListUrls.length, 2, 'critical+medium+due soon should plan exactly two filtered top-level vulnerability requests');
    assert(vulnerabilityListUrls.every((url) => url.includes('remediation_status=Due_soon')), 'due-soon filtered vulnerability requests should use the Action1-specific Due_soon query value');
    assert(vulnerabilityListUrls.every((url) => !url.includes('Due+Soon') && !url.includes('Due%20Soon') && !url.includes('Due Soon')), 'due-soon filtered vulnerability requests should not use space-encoded remediation query values');
    assert(vulnerabilityListUrls.some((url) => url.includes('score=Critical')), 'due-soon filtered vulnerability requests should include the Critical score query');
    assert(vulnerabilityListUrls.some((url) => url.includes('score=Medium')), 'due-soon filtered vulnerability requests should include the Medium score query');
    const endpointFanoutUrls = fetchCalls
      .map((call) => call.url)
      .filter((url) => url.includes('/vulnerabilities/org-1/') && url.includes('/endpoints'));
    assert.strictEqual(endpointFanoutUrls.length, 1, 'endpoint fan-out should still happen only for locally qualified due-soon CVEs');
  });
}

async function runUpdateBroadCollectionFallbackWithoutSupportedSeverityFilterTest() {
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
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'true',
      TicketingUpdateSeverities: 'not_real',
      TicketingUpdateRemediationStatuses: 'overdue'
    }
  });

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { forEach(callback) { callback('application/json', 'content-type'); } },
      text: async () => JSON.stringify(payload)
    });
    const urlText = String(url);
    if (urlText.endsWith('/oauth2/token')) {
      return textResponse({ access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return textResponse({ items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1?')) {
      return textResponse({ items: [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
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
    const result = await runTicketingSync(context, {
      run: {
        async appendLog() {},
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'broad update fallback should still complete successfully');
    const updateListUrls = fetchCalls.map((call) => call.url).filter((url) => url.includes('/updates/org-1?'));
    assert.strictEqual(updateListUrls.length, 1, 'broad update fallback should preserve one broad top-level request');
    assert(updateListUrls[0].includes('fields=*'), 'broad update request should preserve fields=*');
    assert(updateListUrls[0].includes('limit=50'), 'broad update request should preserve limit=50');
    assert(updateListUrls[0].includes('from=0'), 'broad update request should preserve from=0');
    assert.strictEqual(updateListUrls[0].includes('security_severity='), false, 'broad update fallback should not emit security_severity');
    assert.strictEqual(updateListUrls[0].includes('filter='), false, 'broad update fallback should not emit the generic filter param');
    assert.strictEqual(updateListUrls[0].includes('update_sla_status='), false, 'broad update fallback should not emit update_sla_status');
  });
}

async function runUpdateServerFilteredCollectionOptimizationTest() {
  const fetchCalls = [];
  const runLogs = [];
  const diagnosticLogs = [];
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
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'true',
      TicketingUpdateSeverities: 'critical,important,moderate,low,unspecified',
      TicketingUpdateRemediationStatuses: 'overdue',
      TicketingDiagnosticLoggingEnabled: 'true'
    }
  });
  context.logger = {
    debug(message) {
      diagnosticLogs.push(String(message));
    },
    info(message) {
      diagnosticLogs.push(String(message));
    },
    warn(message) {
      diagnosticLogs.push(String(message));
    },
    error(message) {
      diagnosticLogs.push(String(message));
    }
  };

  await withMockedFetch(async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const textResponse = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
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
          { id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00' },
          { id: 'ep-2', name: 'Endpoint Two', last_seen: '2026-06-01_00-00-00' },
          { id: 'ep-3', name: 'Endpoint Three', last_seen: '2026-06-01_00-00-00' }
        ],
        from: 0,
        total_items: 3
      });
    }
    if (urlText.includes('/updates/org-1?') && urlText.includes('security_severity=Critical')) {
      return textResponse({
        items: [
          { packageId: 'pkg-critical', versionId: 'ver-1', security_severity: 'Critical', update_sla_status: 'Overdue' }
        ],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/updates/org-1?') && urlText.includes('security_severity=Important')) {
      return textResponse({
        items: [
          { packageId: 'pkg-important', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' },
          { packageId: 'pkg-duplicate', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' }
        ],
        from: 0,
        total_items: 2
      });
    }
    if (urlText.includes('/updates/org-1?') && urlText.includes('security_severity=Moderate')) {
      return textResponse({
        items: [
          { packageId: 'pkg-moderate', versionId: 'ver-1', security_severity: 'Moderate', update_sla_status: 'Overdue' },
          { packageId: 'pkg-reject-sla', versionId: 'ver-1', security_severity: 'Moderate', update_sla_status: 'Due soon' },
          { packageId: 'pkg-duplicate', versionId: 'ver-1', security_severity: 'Moderate', update_sla_status: 'Overdue' }
        ],
        from: 0,
        total_items: 3
      });
    }
    if (urlText.includes('/updates/org-1?') && urlText.includes('security_severity=Low')) {
      return textResponse({
        items: [
          { packageId: 'pkg-reject-low', versionId: 'ver-1', security_severity: 'Low', update_sla_status: 'Due soon' }
        ],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/updates/org-1?') && urlText.includes('security_severity=Unspecified')) {
      return textResponse({
        items: [
          { packageId: 'pkg-unspecified', versionId: 'ver-1', security_severity: 'Unspecified', update_sla_status: 'Overdue' },
          { packageId: 'pkg-missing-key', versionId: '', security_severity: 'Unspecified', update_sla_status: 'Overdue' }
        ],
        from: 0,
        total_items: 2
      });
    }
    if (urlText.includes('/updates/org-1/pkg-critical/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-important/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-1' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-moderate/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-2' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-duplicate/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-3' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1/pkg-unspecified/versions/ver-1/endpoints')) {
      return textResponse({ items: [{ id: 'ep-2' }], from: 0, total_items: 1 });
    }
    if (urlText.endsWith('/auth/token')) {
      return textResponse({ access_token: 'halo-token', token_type: 'Bearer', expires_in: 3600 });
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
    const result = await runTicketingSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'filtered update collection should still complete successfully');
    assert.strictEqual(result.summary.bySignalType.UPDATE, 5, 'qualified updates should still produce the same downstream grouped candidates');
    const updateListUrls = fetchCalls.map((call) => call.url).filter((url) => url.includes('/updates/org-1?'));
    assert.strictEqual(updateListUrls.length, 5, 'configured update severities should plan one top-level request per supported severity');
    assert(updateListUrls.every((url) => url.includes('fields=*')), 'filtered update requests should include fields=*');
    assert(updateListUrls.every((url) => url.includes('limit=50')), 'filtered update requests should preserve limit=50');
    assert(updateListUrls.every((url) => url.includes('from=0')), 'filtered update requests should preserve from=0');
    assert(updateListUrls.some((url) => url.includes('security_severity=Critical')), 'filtered update requests should include the Critical query value');
    assert(updateListUrls.some((url) => url.includes('security_severity=Important')), 'filtered update requests should include the Important query value');
    assert(updateListUrls.some((url) => url.includes('security_severity=Moderate')), 'filtered update requests should include the Moderate query value');
    assert(updateListUrls.some((url) => url.includes('security_severity=Low')), 'filtered update requests should include the Low query value');
    assert(updateListUrls.some((url) => url.includes('security_severity=Unspecified')), 'filtered update requests should include the Unspecified query value');
    assert(updateListUrls.every((url) => !url.includes('filter=')), 'filtered update requests should not use the generic filter parameter');
    assert(updateListUrls.every((url) => !url.includes('update_sla_status=')), 'filtered update requests should not send SLA/remediation server-side filtering');

    const endpointFanoutUrls = fetchCalls
      .map((call) => call.url)
      .filter((url) => url.includes('/updates/org-1/') && url.includes('/versions/') && url.includes('/endpoints'));
    assert.strictEqual(endpointFanoutUrls.some((url) => url.includes('/pkg-reject-sla/versions/ver-1/endpoints')), false, 'top-level rows that fail local remediation qualification should not trigger endpoint fan-out');
    assert.strictEqual(endpointFanoutUrls.some((url) => url.includes('/pkg-reject-low/versions/ver-1/endpoints')), false, 'top-level rows that fail local remediation qualification should not trigger endpoint fan-out');
    assert.strictEqual(
      endpointFanoutUrls.filter((url) => url.includes('/pkg-duplicate/versions/ver-1/endpoints')).length,
      1,
      'duplicate top-level package/version rows should trigger only one endpoint fan-out request'
    );
    assert.strictEqual(endpointFanoutUrls.length, 5, 'endpoint fan-out should only happen for qualified, deduped package/version rows');
    assert.strictEqual(context.state.grouped.length, 5, 'downstream grouped update identity/correlation behavior should remain unchanged');
    assert(runtimeLogLines().some((entry) => entry.includes('updateFilterStrategy":"server-filtered')), 'detailed diagnostics should report the update filter strategy');
    assert(runtimeLogLines().some((entry) => entry.includes('updateTopLevelUniquePackageVersionKeysAfterDedupe":"7"')), 'detailed diagnostics should report unique package/version keys after dedupe');
    assert(runtimeLogLines().some((entry) => entry.includes('updateRowsSkippedBeforeDeepFetch":"2"')), 'detailed diagnostics should report rows skipped before deep fetch');
    assert(runtimeLogLines().some((entry) => entry.includes('updateCrossFilterDuplicateKeys":"1"')), 'detailed diagnostics should report cross-filter duplicate update keys');
    assert(runtimeLogLines().some((entry) => entry.includes('updateServerFilterBreakdown":[{"security_severity":"Critical","pagesFetched":"1","rawRowsFetched":"1","uniquePackageVersionKeys":"1","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-critical:ver-1"]},{"security_severity":"Important","pagesFetched":"1","rawRowsFetched":"2","uniquePackageVersionKeys":"2","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-important:ver-1","pkg-duplicate:ver-1"]},{"security_severity":"Moderate","pagesFetched":"1","rawRowsFetched":"3","uniquePackageVersionKeys":"3","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-moderate:ver-1","pkg-reject-sla:ver-1","pkg-duplicate:ver-1"]},{"security_severity":"Low","pagesFetched":"1","rawRowsFetched":"1","uniquePackageVersionKeys":"1","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-reject-low:ver-1"]},{"security_severity":"Unspecified","pagesFetched":"1","rawRowsFetched":"2","uniquePackageVersionKeys":"1","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"1","sampleUpdateKeys":["pkg-unspecified:ver-1"]}]')), 'detailed diagnostics should report per-filter update breakdown details');
    assert(runtimeLogLines().some((entry) => entry.includes('updateCrossFilterDuplicatePairs')), 'detailed diagnostics should report overlapping update filter pairs');
    assert(runtimeLogLines().some((entry) => entry.includes('"left":"security_severity=Important"') && entry.includes('"right":"security_severity=Moderate"') && entry.includes('"duplicateKeys":"1"') && entry.includes('"sampleUpdateKeys":["pkg-duplicate:ver-1"]')), 'detailed diagnostics should report the overlapping Important/Moderate update pair with capped key samples');
    assert(runtimeLogLines().some((entry) => entry.includes('updateDeepEndpointFetchesCompleted":"5"')), 'detailed diagnostics should report update endpoint fan-out counts');
  });
}

async function runFilteredUpdateRequestFailureDoesNotBroadFallbackTest() {
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
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'true',
      TicketingUpdateSeverities: 'important',
      TicketingUpdateRemediationStatuses: 'overdue'
    }
  });

  await withMockedFetch(async (url) => {
    fetchCalls.push(String(url));
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
      return textResponse(200, { items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/updates/org-1?') && urlText.includes('security_severity=Important')) {
      return textResponse(400, { error: 'invalid_filter' });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runTicketingSync(context, {
      run: {
        async appendLog() {},
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, false, 'filtered update request failures should surface as sync failures');
    assert.strictEqual(result.summary.failed, 1, 'filtered update request failures should count as collection failures');
    assert.strictEqual(fetchCalls.some((url) => url.includes('/updates/org-1?limit=') && !url.includes('security_severity=')), false, 'filtered update request failures should not silently broad-fallback');
    assert.strictEqual(fetchCalls.filter((url) => url.includes('/updates/org-1?')).length, 1, 'filtered update request failures should stop at the attempted filtered request');
    assert.strictEqual(fetchCalls.some((url) => url.includes('/versions/') && url.includes('/endpoints')), false, 'failed filtered update requests should not continue to endpoint fan-out');
  });
}

async function runFilteredVulnerabilityRequestFailureDoesNotBroadFallbackTest() {
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
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'true',
      TicketingVulnerabilitySeverities: 'high',
      TicketingVulnerabilityRemediationStatuses: 'overdue',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });

  await withMockedFetch(async (url) => {
    fetchCalls.push(String(url));
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
      return textResponse(200, { items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00' }], from: 0, total_items: 1 });
    }
    if (urlText.includes('/vulnerabilities/org-1?') && urlText.includes('score=High') && urlText.includes('remediation_status=Overdue')) {
      return textResponse(400, { error: 'invalid_filter' });
    }
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runTicketingSync(context, {
      run: {
        async appendLog() {},
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, false, 'filtered vulnerability request failures should surface as sync failures');
    assert.strictEqual(result.summary.failed, 1, 'filtered vulnerability request failures should count as collection failures');
    assert.strictEqual(fetchCalls.some((url) => url.includes('/vulnerabilities/org-1?limit=') && !url.includes('score=')), false, 'filtered vulnerability request failures should not silently broad-fallback');
    assert.strictEqual(fetchCalls.filter((url) => url.includes('/vulnerabilities/org-1?')).length, 1, 'filtered vulnerability request failures should stop at the attempted filtered request');
    assert.strictEqual(fetchCalls.some((url) => url.includes('/vulnerabilities/org-1/CVE-')), false, 'failed filtered requests should not continue to endpoint fan-out');
  });
}

async function runAllSignalsDisabledNoOpTest() {
  const fetchCalls = [];
  const logs = [];
  const context = createSyncContext({
    mappings: [],
    settings: {
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  let processed = null;

  await withMockedFetch(async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`Unexpected fetch ${String(url)}`);
  }, async () => {
    const result = await runTicketingSync(context, {
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
    assert(result.details.includes('ACTION1_TICKETING_SYNC_SUMMARY_BEGIN'), 'all signals disabled should still include the summary block');
    assert.strictEqual(fetchCalls.length, 0, 'all signals disabled should not call Action1 or Halo APIs');
    assert(logs.some((entry) => entry.includes('enabledSignals":[]')), 'basic logs should include the empty enabled signal summary');
    assert(logs.some((entry) => entry.includes('no signals are enabled')), 'basic logs should include the no-op decision');
  });
}

async function runProductionUnavailableProviderStillAllowsZeroWorkTest() {
  const context = createSyncContext({
    mappings: [],
    settings: {
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  let credentialReads = 0;
  let mappingReads = 0;
  context.action1.getCredentials = async () => { credentialReads += 1; return {}; };
  const originalDbAll = context.db.all;
  context.db.all = async (...args) => { if (String(args[0]).includes('action1_ticketing_org_client_mappings')) mappingReads += 1; return originalDbAll(...args); };
  const fetchCalls = [];
  await withMockedFetch(async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected request'); }, async () => {
    const result = await runTicketingSyncImplementation(context, { providerId: 'provider-spoof', run: { async appendLog() {}, async setAssetsProcessed() {} } });
    assert.strictEqual(result.ok, true, 'zero-work sync succeeds even when the selected production provider has no available adapter');
    assert.strictEqual(result.summary.failed, 0);
    assert.strictEqual(result.assetsProcessed, 0);
    assert.strictEqual(credentialReads, 0, 'zero-work path must not resolve Action1 credentials');
    assert.strictEqual(mappingReads, 0, 'zero-work path does not need provider mappings or a provider database read');
    assert.deepStrictEqual(fetchCalls, [], 'zero-work path makes no Action1 or destination transport calls');
    assert.deepStrictEqual(context.state.endpoint, [], 'zero-work path does not mutate endpoint correlations');
    assert.deepStrictEqual(context.state.grouped, [], 'zero-work path does not mutate grouped correlations');
    assert.deepStrictEqual(context.state.watermarks, [], 'zero-work path does not advance checkpoints');
    assert.strictEqual(result.providerId, 'connectwise-psa', 'untrusted action payload cannot change the captured active provider');
  });
}

async function runManualAndScheduledExportUseSameTrackedHandlerTest() {
  const context = createSyncContext({
    mappings: [],
    settings: {
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  const triggerEvents = [];
  const run = { async appendLog(message) { for (const match of String(message).matchAll(/"trigger":"(manual|scheduled)"/g)) triggerEvents.push(match[1]); }, async setAssetsProcessed() {} };
  const manual = await exportedActions.sync(context, { trigger: 'manual', run });
  const scheduled = await exportedActions.sync(context, { trigger: 'scheduled', run });
  assert.equal(manual.ok, true);
  assert.equal(scheduled.ok, true);
  assert.deepEqual(triggerEvents.sort(), ['manual', 'scheduled'], 'manual and scheduled package invocations enter the same manifest-exported sync handler');
  assert.equal(manual.details.includes('ACTION1_TICKETING_SYNC_SUMMARY_BEGIN'), true);
  assert.equal(scheduled.details.includes('ACTION1_TICKETING_SYNC_SUMMARY_BEGIN'), true);
}

async function runProductionUnavailableProviderFailsNonEmptyRunTest() {
  const context = createSyncContext({
    mappings: [{ id: 1, action1OrgId: 'org-1', action1OrgName: 'Org One', haloClientId: 'client-1', haloClientName: 'Client One' }]
  });
  let credentialReads = 0;
  let mappingReads = 0;
  context.action1.getCredentials = async () => { credentialReads += 1; return {}; };
  const originalDbAll = context.db.all;
  context.db.all = async (...args) => { if (String(args[0]).includes('action1_ticketing_org_client_mappings')) mappingReads += 1; return originalDbAll(...args); };
  const fetchCalls = [];
  await withMockedFetch(async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected request'); }, async () => {
    const result = await runTicketingSyncImplementation(context, { run: { async appendLog() {}, async setAssetsProcessed() {} } });
    assert.strictEqual(result.ok, false, 'non-empty sync fails safely while ConnectWise ticket operations are unimplemented');
    assert.match(result.message, /Complete ticketing configuration fields/);
    assert.strictEqual(credentialReads, 0, 'unavailable provider fails before Action1 credential resolution');
    assert.strictEqual(mappingReads, 1, 'preflight may read existing mappings but does not modify them');
    assert.deepStrictEqual(fetchCalls, [], 'unavailable provider fails before collection or destination transport');
    assert.deepStrictEqual(context.state.endpoint, [], 'preflight failure does not change endpoint correlations');
    assert.deepStrictEqual(context.state.grouped, [], 'preflight failure does not change grouped correlations');
    assert.deepStrictEqual(context.state.watermarks, [], 'preflight failure does not advance checkpoints');
  });
}

async function runProviderConfigurationPreflightStopsBeforeCollectionTest() {
  const context = createSyncContext({
    mappings: [{ id: 1, action1OrgId: 'org-1', action1OrgName: 'Org One', haloClientId: 'client-1', haloClientName: 'Client One' }]
  });
  let credentialReads = 0;
  context.action1.getCredentials = async () => { credentialReads += 1; return {}; };
  const beforeValidations = syncProviderCalls.validations.length;
  syncTicketState.set('provider-config-error', 'synthetic invalid route');
  const fetchCalls = [];
  try {
    await withMockedFetch(async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected request'); }, async () => {
      const result = await runTicketingSync(context, { providerId: 'untrusted-provider', run: { async appendLog() {}, async setAssetsProcessed() {} } });
      assert.strictEqual(result.ok, false, 'provider configuration validation failure must fail a non-empty sync');
      assert.match(result.message, /routing\.destination/);
      assert.strictEqual(syncProviderCalls.validations.length, beforeValidations + 1, 'the captured provider receives one full configuration validation');
      assert.strictEqual(syncProviderCalls.validations.at(-1).input.mode, 'full-provider');
      assert.strictEqual(syncProviderCalls.validations.at(-1).input.mappings[0].destinationId, 'client-1');
      assert.strictEqual(credentialReads, 0, 'provider configuration and mapping preflight completes before Action1 credential reads');
      assert.deepStrictEqual(fetchCalls, [], 'provider preflight failure stops before Action1 collection');
      assert.deepStrictEqual(context.state.endpoint, [], 'provider preflight failure does not mutate endpoint correlations');
      assert.deepStrictEqual(context.state.grouped, [], 'provider preflight failure does not mutate grouped correlations');
      assert.deepStrictEqual(context.state.watermarks, [], 'provider preflight failure does not advance checkpoints');
      assert.strictEqual(result.providerId, 'connectwise-psa', 'request-supplied provider cannot override server-selected provider');
    });
  } finally {
    syncTicketState.delete('provider-config-error');
  }
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
      TicketingOfflineEnabled: 'true',
      TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
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
    const result = await runTicketingSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(message);
        },
        async setAssetsProcessed() {}
      }
    });

    const urls = fetchCalls.map((call) => call.url);
    assert(urls.filter((url) => url.includes('action1.com')).every((url) => url.startsWith('https://app.na-2.action1.com/api/3.0/')), 'sync Action1 API requests should use the Marketplace regional API base URL');
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

async function runCompanyEligibilityIsolatedPerOrganizationTest() {
  const context = createSyncContext({
    mappings: [
      { id: 11, action1OrgId: 'org-denied', action1OrgName: 'Denied Org', haloClientId: 'client-denied', haloClientName: 'Denied Co' },
      { id: 12, action1OrgId: 'org-allowed', action1OrgName: 'Allowed Org', haloClientId: 'client-allowed', haloClientName: 'Allowed Co' }
    ],
    settings: {
      TicketingOfflineEnabled: 'true', TicketingOfflineThresholdDays: '7', TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false', TicketingVulnerabilityEnabled: 'false', TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false', TicketingUpdateSeverities: ''
    }
  });
  syncTicketState.set('company-ineligible:client-denied', true);
  const transportCalls = [];
  try {
    await withMockedFetch(async (url, options = {}) => {
      const urlText = String(url);
      transportCalls.push({ url: urlText, options });
      const response = (payload) => ({ ok: true, status: 200, headers: { forEach(callback) { callback('application/json', 'content-type'); } }, text: async () => JSON.stringify(payload) });
      if (urlText.endsWith('/oauth2/token')) return response({ access_token: 'action1-token', expires_in: 3600 });
      if (urlText.includes('/endpoints/managed/org-denied')) return response({ items: [{ id: 'ep-denied', name: 'Denied Endpoint', last_seen: '2026-06-01_00-00-00' }], from: 0, total_items: 1 });
      if (urlText.includes('/endpoints/managed/org-allowed')) return response({ items: [{ id: 'ep-allowed', name: 'Allowed Endpoint', last_seen: '2026-06-01_00-00-00' }], from: 0, total_items: 1 });
      if (urlText.endsWith('/auth/token')) return response({ access_token: 'halo-token', token_type: 'Bearer' });
      if (urlText.endsWith('/api/Tickets') && String(options.method || '').toUpperCase() === 'POST') return response([{ id: `ticket-${Math.random()}`, status_id: '3', status: 'Open', is_closed: false }]);
      if (urlText.includes('/api/Tickets/')) return response({ id: 'ticket-existing', status_id: '3', status: 'Open', is_closed: false });
      throw new Error(`Unexpected fetch ${urlText}`);
    }, async () => {
      const result = await runTicketingSync(context, { run: { async appendLog() {}, async setAssetsProcessed() {} } });
      assert.strictEqual(result.summary.failed, 1, 'the ineligible organization is surfaced as one failure');
      assert.strictEqual(result.summary.created, 1, 'the eligible organization continues and creates its ticket');
      assert.strictEqual(result.collection.orgFailures, 1);
      assert.match(result.details, /Denied Org: ConnectWise company eligibility could not be confirmed/);
      assert.strictEqual(syncProviderCalls.prepare.at(-1).candidate.routing.action1OrgId, 'org-allowed', 'no destination create is attempted for the ineligible organization');
      assert.strictEqual(context.state.endpoint.some((row) => String(row.org_link_id) === '11'), false, 'the skipped organization receives no correlation');
      assert.strictEqual(context.state.endpoint.some((row) => String(row.org_link_id) === '12'), true, 'the eligible organization correlation is persisted');
      assert.strictEqual(context.state.watermarks.some((row) => String(row.org_link_id) === '11'), false, 'the skipped organization watermark does not advance');
    });
  } finally {
    syncTicketState.delete('company-ineligible:client-denied');
  }
}

function runIneligibleOrganizationCheckpointFilterTest() {
  const isolated = syncPrivate.filterIneligibleOrganizations(
    [
      { routing: { action1OrgId: 'org-denied' }, identity: { orgLinkId: 'link-denied' } },
      { routing: { action1OrgId: 'org-allowed' }, identity: { orgLinkId: 'link-allowed' } }
    ],
    [
      { action1OrgId: 'org-denied', orgLinkId: 'link-denied' },
      { action1OrgId: 'org-allowed', orgLinkId: 'link-allowed' }
    ],
    new Set(['org-denied'])
  );
  assert.deepStrictEqual(isolated.candidates.map((row) => row.routing.action1OrgId), ['org-allowed']);
  assert.deepStrictEqual(isolated.pendingWatermarks.map((row) => row.action1OrgId), ['org-allowed'], 'checkpoint persistence excludes only the skipped organization');
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
      TicketingOfflineEnabled: 'true',
      TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'true',
      TicketingAutomationFailedEnabled: 'true',
      TicketingAutomationFailedLookbackHours: '24',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'true',
      TicketingUpdateSeverities: 'important',
      TicketingUpdateRemediationStatuses: 'overdue'
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
    const result = await runTicketingSync(context, {
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
  const priorCreates = syncProviderCalls.create.length;
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
      TicketingOfflineEnabled: 'true',
      TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  context.state.endpoint.push({
    provider_id: 'connectwise-psa',
    org_link_id: '1',
    endpoint_id: 'ep-1',
    signal_type: 'OFFLINE',
    external_ticket_id: '3960',
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
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const run = {
      async appendLog(message) {
        runLogs.push(message);
      },
      async setAssetsProcessed() {}
    };

    const first = await runTicketingSync(context, { run });
    assert.strictEqual(first.ok, true, 'first run should succeed while recreating the deleted linked ticket');
    assert.strictEqual(first.summary.created, 1, 'first run should recreate the missing linked ticket');
    assert.strictEqual(first.summary.skipped, 0, 'first run should not count deleted-ticket recovery as skipped');
    assert.strictEqual(context.state.endpoint[0].linked_ticket_id, `ticket-fixture-${syncTicketSequence}`, 'first run should replace the stored correlation with the new ticket id');
    assert(runLogs.some((entry) => entry.includes('A linked ticket is confirmed missing; treating the stored correlation as stale.')), 'run logs should explain stale linked-ticket recovery');
    assert(runLogs.some((entry) => entry.includes('"recoveryAction":"recreate"')), 'run logs should include the recreate recovery action');
    assert.strictEqual(syncProviderCalls.create.length, priorCreates + 1, 'confirmed missing replacement uses one provider create');
    assert.strictEqual(fetchCalls.some((call) => /halo|\/api\/Tickets/i.test(call.url)), false, 'confirmed missing recovery does not call Halo endpoints');

    fetchCalls.length = 0;
    runLogs.length = 0;

    const second = await runTicketingSync(context, { run });
    assert.strictEqual(second.ok, true, 'second run should also succeed');
    assert.strictEqual(second.summary.created, 0, 'second run should not recreate the ticket again');
    assert.strictEqual(second.summary.skipped, 1, `second run should no-op against the replacement ticket: ${JSON.stringify(second.summary)}`);
    assert.strictEqual(syncProviderCalls.get.includes(context.state.endpoint[0].external_ticket_id), true, 'later runs should read the replacement neutral reference');
    assert.strictEqual(fetchCalls.some((call) => /halo|\/api\/Tickets/i.test(call.url)), false);
  });
}

async function runClosedLinkedTicketCreatesReplacementAndLaterRunsUseItTest() {
  const fetchCalls = [];
  const priorCreates = syncProviderCalls.create.length;
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
      TicketingOfflineEnabled: 'true',
      TicketingOfflineThresholdDays: '7',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'false',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  context.state.endpoint.push({
    provider_id: 'connectwise-psa',
    org_link_id: '1',
    endpoint_id: 'ep-1',
    signal_type: 'OFFLINE',
    external_ticket_id: '3966',
    linked_ticket_id: '3966',
    payload_hash: 'old-hash'
  });
  primeSyncTicket('3966', 'closed');

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
    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const run = {
      async appendLog() {},
      async setAssetsProcessed() {}
    };

    const first = await runTicketingSync(context, { run });
    assert.strictEqual(first.ok, true, 'first run should succeed while replacing the closed linked ticket');
    assert.strictEqual(first.summary.created, 1, 'first run should create a replacement for the closed linked ticket');
    assert.strictEqual(first.summary.skipped, 0, 'first run should count closed linked-ticket replacement as created, not skipped');
    assert.strictEqual(context.state.endpoint[0].linked_ticket_id, `ticket-fixture-${syncTicketSequence}`, 'first run should replace the stored correlation with the new neutral ticket reference');
    assert.strictEqual(syncProviderCalls.create.length, priorCreates + 1);
    assert.strictEqual(fetchCalls.some((call) => /halo|\/api\/Tickets/i.test(call.url)), false, 'closed ticket recovery does not call Halo endpoints');

    fetchCalls.length = 0;

    const second = await runTicketingSync(context, { run });
    assert.strictEqual(second.ok, true, 'second run should also succeed');
    assert.strictEqual(second.summary.created, 0, 'second run should not create another replacement');
    assert.strictEqual(second.summary.skipped, 1, 'second run should no-op against the replacement ticket when unchanged');
    assert.strictEqual(syncProviderCalls.get.includes(context.state.endpoint[0].external_ticket_id), true, 'later runs should read the replacement neutral reference');
    assert.strictEqual(fetchCalls.some((call) => /halo|\/api\/Tickets/i.test(call.url)), false);
  });
}

async function runLifecycleFailureHoldsAutomationCheckpointTest() {
  const checkpointTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const context = createSyncContext({
    mappings: [{ id: 1, action1OrgId: 'org-1', action1OrgName: 'Org One', haloClientId: 'client-1', haloClientName: 'Client One' }],
    settings: {
      TicketingOfflineEnabled: 'false',
      TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'true',
      TicketingAutomationFailedLookbackHours: '24',
      TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '',
      TicketingUpdateEnabled: 'false',
      TicketingUpdateSeverities: ''
    }
  });
  syncTicketState.set('connectwise-psa:create-error', Object.assign(new Error('synthetic provider create failure'), { code: 'SYNTHETIC_CREATE_FAILURE' }));
  const destinationRequests = [];
  try {
    await withMockedFetch(async (url) => {
      const urlText = String(url);
      const response = (payload) => ({ ok: true, status: 200, headers: { forEach(callback) { callback('application/json', 'content-type'); } }, text: async () => JSON.stringify(payload) });
      if (urlText.endsWith('/oauth2/token')) return response({ access_token: 'action1-token', expires_in: 3600 });
      if (urlText.includes('/endpoints/managed/org-1')) return response({ items: [{ id: 'ep-1', name: 'Endpoint One' }], from: 0, total_items: 1 });
      if (urlText.includes('/automations/instances/org-1?')) return response({ items: [{ id: 'inst-checkpoint', end_time: checkpointTime, name: 'Automation One' }], from: 0, total_items: 1 });
      if (urlText.includes('/automations/instances/org-1/inst-checkpoint/endpoint-results')) return response({ items: [{ id: 'ep-1', status: 'Error', description: 'Synthetic failure' }], from: 0, total_items: 1 });
      destinationRequests.push(urlText);
      throw new Error(`Unexpected external request ${urlText}`);
    }, async () => {
      const result = await runTicketingSync(context, { run: { async appendLog() {}, async setAssetsProcessed() {} } });
      assert.strictEqual(result.summary.failed, 1, 'a failed lifecycle create is reported');
      assert.strictEqual(context.state.watermarks.length, 0, 'failed automation ticket creation holds the staged organization checkpoint');
      assert.deepStrictEqual(destinationRequests, [], 'provider operations stay behind the injected in-memory dispatcher, without external destination requests');
    });
  } finally {
    syncTicketState.delete('connectwise-psa:create-error');
  }
}

async function runFailedAutomationUpdateHoldsCheckpointTest() {
  const checkpointTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const context = createSyncContext({
    mappings: [{ id: 1, action1OrgId: 'org-1', action1OrgName: 'Org One', haloClientId: 'client-1', haloClientName: 'Client One' }],
    settings: {
      TicketingOfflineEnabled: 'false', TicketingRebootRequiredEnabled: 'false',
      TicketingAutomationFailedEnabled: 'true', TicketingAutomationFailedLookbackHours: '24',
      TicketingAutomationFailedTicketModel: 'endpoint', TicketingVulnerabilityEnabled: 'false',
      TicketingVulnerabilitySeverities: '', TicketingUpdateEnabled: 'false', TicketingUpdateSeverities: ''
    }
  });
  primeSyncTicket('existing-automation-ticket', 'open');
  context.state.endpoint.push({
    provider_id: 'connectwise-psa', org_link_id: '1', endpoint_id: 'ep-1', signal_type: 'AUTOMATION_FAILED',
    external_ticket_id: 'existing-automation-ticket', comparison_value: 'previous', comparison_version: 'sync-fixture-v1'
  });
  syncTicketState.set('connectwise-psa:update-error', Object.assign(new Error('synthetic provider update failure'), { code: 'SYNTHETIC_UPDATE_FAILURE' }));
  try {
    await withMockedFetch(async (url) => {
      const urlText = String(url);
      const response = (payload) => ({ ok: true, status: 200, headers: { forEach(callback) { callback('application/json', 'content-type'); } }, text: async () => JSON.stringify(payload) });
      if (urlText.endsWith('/oauth2/token')) return response({ access_token: 'action1-token', expires_in: 3600 });
      if (urlText.includes('/endpoints/managed/org-1')) return response({ items: [{ id: 'ep-1', name: 'Endpoint One' }], from: 0, total_items: 1 });
      if (urlText.includes('/automations/instances/org-1?')) return response({ items: [{ id: 'inst-update', end_time: checkpointTime, name: 'Automation One' }], from: 0, total_items: 1 });
      if (urlText.includes('/automations/instances/org-1/inst-update/endpoint-results')) return response({ items: [{ id: 'ep-1', status: 'Error', description: 'Updated failure detail' }], from: 0, total_items: 1 });
      throw new Error(`Unexpected external request ${urlText}`);
    }, async () => {
      const result = await runTicketingSync(context, { run: { async appendLog() {}, async setAssetsProcessed() {} } });
      assert.strictEqual(result.summary.failed, 1, 'failed existing-ticket update is reported');
      assert.strictEqual(syncProviderCalls.update.length > 0, true, 'fixture exercised the existing-ticket UPDATE path');
      assert.strictEqual(context.state.watermarks.length, 0, 'failed automation UPDATE does not advance its organization checkpoint');
      assert.strictEqual(context.state.endpoint[0].comparison_value, 'previous', 'failed update leaves stored comparison state unchanged');
    });
  } finally {
    syncTicketState.delete('connectwise-psa:update-error');
    syncTicketState.delete('connectwise-psa:existing-automation-ticket');
  }
}

function runAutomationCheckpointOutcomeIsolationTest() {
  const pending = [
    { orgLinkId: '1', action1OrgId: 'org-1', lastSeenAt: 't1' },
    { orgLinkId: '2', action1OrgId: 'org-2', lastSeenAt: 't2' }
  ];
  const endpointCandidate = { identity: { orgLinkId: '1', endpointId: 'ep-1', signalType: 'AUTOMATION_FAILED', key: '1|ep-1|AUTOMATION_FAILED' }, signal: { type: 'AUTOMATION_FAILED' } };
  const groupedCandidate = { ticketModel: 'grouped', identity: { orgLinkId: '2', signalType: 'AUTOMATION_FAILED', identityKey: '2|AUTOMATION_FAILED|inst-2' }, issueKey: 'inst-2', signal: { type: 'AUTOMATION_FAILED' } };
  const candidateRows = [endpointCandidate, groupedCandidate];
  const failedEndpoint = { results: [
    { identityKey: '1|ep-1|AUTOMATION_FAILED', signalType: 'AUTOMATION_FAILED', action: 'ERROR', status: 'failed' },
    { identityKey: '2|AUTOMATION_FAILED|inst-2', signalType: 'AUTOMATION_FAILED', action: 'CREATE', status: 'success' }
  ] };
  assert.deepStrictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, candidateRows, failedEndpoint).map((row) => row.orgLinkId), ['2'], "failed individual automation item withholds only its organization's checkpoint");
  const failedGrouped = { results: [
    { identityKey: '1|ep-1|AUTOMATION_FAILED', signalType: 'AUTOMATION_FAILED', action: 'CREATE', status: 'success' },
    { identityKey: '2|AUTOMATION_FAILED|inst-2', signalType: 'AUTOMATION_FAILED', action: 'ERROR', status: 'failed' }
  ] };
  assert.deepStrictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, candidateRows, failedGrouped).map((row) => row.orgLinkId), ['1'], "failed grouped automation item withholds only its organization's checkpoint");
  const successful = { results: [
    { identityKey: '1|ep-1|AUTOMATION_FAILED', signalType: 'AUTOMATION_FAILED', action: 'CREATE', status: 'success' },
    { identityKey: '2|AUTOMATION_FAILED|inst-2', signalType: 'AUTOMATION_FAILED', action: 'SKIP', status: 'skipped' }
  ] };
  assert.strictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, candidateRows, successful).length, 2, 'successful grouped create and SKIP retain checkpoint advancement');
  const failedUpdate = { results: [
    { identityKey: '1|ep-1|AUTOMATION_FAILED', signalType: 'AUTOMATION_FAILED', action: 'ERROR', status: 'failed' },
    { identityKey: '2|AUTOMATION_FAILED|inst-2', signalType: 'AUTOMATION_FAILED', action: 'UPDATE', status: 'success' }
  ] };
  assert.deepStrictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, candidateRows, failedUpdate).map((row) => row.orgLinkId), ['2'], "failed automation UPDATE withholds only its organization's checkpoint");
  assert.strictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, candidateRows, { results: [] }).length, 0, 'missing lifecycle outcomes are treated as ambiguous and hold affected checkpoints');
  assert.strictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, candidateRows, { results: [{ signalType: 'AUTOMATION_FAILED', action: 'ERROR', status: 'failed' }] }).length, 0, 'unassociated failed automation result conservatively holds checkpoints');
  const mixedSignals = { results: [
    { identityKey: '1|ep-1|VULNERABILITY', signalType: 'VULNERABILITY', action: 'ERROR', status: 'failed' },
    { identityKey: '2|AUTOMATION_FAILED|inst-2', signalType: 'AUTOMATION_FAILED', action: 'SKIP', status: 'skipped' }
  ] };
  assert.deepStrictEqual(syncPrivate.filterPendingWatermarksByLifecycleOutcome(pending, [
    { identity: { orgLinkId: '1', endpointId: 'ep-1', signalType: 'VULNERABILITY', key: '1|ep-1|VULNERABILITY' } }, groupedCandidate
  ], mixedSignals).map((row) => row.orgLinkId), ['1', '2'], 'non-automation ticket failures retain existing checkpoint behavior');
}

async function run() {
  await runHaloAuthTokenReuseAndRefreshTest();
  await runDiscoveryAndRuntimeShareHaloTokenCacheTest();
  runVulnerabilityFilterCombinationPlanningTest();
  runVulnerabilitySeverityOnlyPlanningTest();
  runVulnerabilityRemediationOnlyPlanningTest();
  runVulnerabilityDueSoonPlanningTest();
  runVulnerabilityNoFilterPlanningFallbackTest();
  runVulnerabilityCombinationCapFallbackTest();
  runVulnerabilityUnknownValuePlanningTest();
  runVulnerabilityFilterBreakdownHelperTest();
  runVulnerabilityCrossFilterDuplicateDiagnosticsHelperTest();
  runUpdateSeverityOnlyPlanningTest();
  runUpdateNoFilterPlanningFallbackTest();
  runUpdateUnknownValuePlanningFallbackTest();
  runUpdateTopLevelUrlPlanningTest();
  runUpdateFilterBreakdownHelperTest();
  runUpdateCrossFilterDuplicateDiagnosticsHelperTest();
  await runMissingConfigFailsSafelyTest();
  await runMissingAction1CredentialsFailsSafelyTest();
  await runTrackedSyncHappyPathTest();
  await runDiagnosticFileWriteFailureDoesNotFailSyncTest();
  await runVulnerabilityServerFilteredCollectionOptimizationTest();
  await runVulnerabilityDueSoonFilteredUrlMappingTest();
  await runUpdateBroadCollectionFallbackWithoutSupportedSeverityFilterTest();
  await runUpdateServerFilteredCollectionOptimizationTest();
  await runFilteredUpdateRequestFailureDoesNotBroadFallbackTest();
  await runFilteredVulnerabilityRequestFailureDoesNotBroadFallbackTest();
  await runAllSignalsDisabledNoOpTest();
  await runProductionUnavailableProviderStillAllowsZeroWorkTest();
  await runManualAndScheduledExportUseSameTrackedHandlerTest();
  await runProductionUnavailableProviderFailsNonEmptyRunTest();
  await runProviderConfigurationPreflightStopsBeforeCollectionTest();
  await runOfflineOnlyCollectionGatingTest();
  await runCompanyEligibilityIsolatedPerOrganizationTest();
  runIneligibleOrganizationCheckpointFilterTest();
  await runPreCandidateSignalNotQualifiedDoesNotInflateFinalSkippedTest();
  await runDeletedLinkedTicketIsRecreatedAndNotRecheckedTest();
  await runClosedLinkedTicketCreatesReplacementAndLaterRunsUseItTest();
  await runLifecycleFailureHoldsAutomationCheckpointTest();
  await runFailedAutomationUpdateHoldsCheckpointTest();
  runAutomationCheckpointOutcomeIsolationTest();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
