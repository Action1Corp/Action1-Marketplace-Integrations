const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const originalFetch = global.fetch;
const {
  __resetHaloTokenCache,
  createHaloAuthClient,
  requestToken
} = require('../haloApi');
const { __private: action1CollectionPrivate } = require('../action1Api');
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
          apiSecret: 'action1-client-secret',
          organizationId: 'org-tenant',
          baseUrl: 'https://app.na-2.action1.com/api/3.0/'
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

async function runDiagnosticFileWriteFailureDoesNotFailSyncTest() {
  const fetchCalls = [];
  const warningLogs = [];
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
      HaloPsaUpdateSeverities: '',
      HaloPsaDiagnosticLoggingEnabled: 'true'
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

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-psa-sync-log-failure-'));
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
      const result = await runHaloPsaSync(context, {
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
        warningMatches[0].includes('"filePath"') && warningMatches[0].includes('halo-psa-runtime.log'),
        true,
        'sync warning should include the resolved diagnostic file path'
      );
      assert.strictEqual(/(ENOTDIR|EEXIST|EPERM|not a directory)/i.test(warningMatches[0]), true, 'sync warning should include a safe filesystem error');
    });
  } finally {
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
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'true',
      HaloPsaVulnerabilitySeverities: 'medium,low',
      HaloPsaVulnerabilityRemediationStatuses: 'overdue',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: '',
      HaloPsaDiagnosticLoggingEnabled: 'true'
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
    const result = await runHaloPsaSync(context, {
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
    assert(diagnosticLogs.some((entry) => entry.includes('vulnerabilityFilterStrategy":"server-filtered')), 'detailed diagnostics should report the vulnerability filter strategy');
    assert(diagnosticLogs.some((entry) => entry.includes('topLevelUniqueCvesAfterDedupe":"4"')), 'detailed diagnostics should add a clearer unique-CVE metric after dedupe');
    assert(diagnosticLogs.some((entry) => entry.includes('crossFilterDuplicateCves":"1"')), 'detailed diagnostics should report cross-filter duplicate CVE counts');
    assert(diagnosticLogs.some((entry) => entry.includes('serverFilterBreakdown":[{"score":"Medium","remediation_status":"Overdue","pagesFetched":"1","rawRowsFetched":"3","uniqueCves":"3","duplicateCvesWithinFilter":"0","rowsMissingCanonicalCve":"0","sampleCves":["CVE-MEDIUM-1","CVE-REJECT-HIGH","CVE-DUP-1"]},{"score":"Low","remediation_status":"Overdue","pagesFetched":"1","rawRowsFetched":"2","uniqueCves":"2","duplicateCvesWithinFilter":"0","rowsMissingCanonicalCve":"0","sampleCves":["CVE-LOW-1","CVE-DUP-1"]}]')), 'detailed diagnostics should report per-filter breakdown details');
    assert(diagnosticLogs.some((entry) => entry.includes('crossFilterDuplicatePairs":[{"left":"score=Medium remediation_status=Overdue","right":"score=Low remediation_status=Overdue","duplicateCves":"1","sampleCves":["CVE-DUP-1"]}]')), 'detailed diagnostics should report overlapping filter pairs with capped CVE samples');
    assert(diagnosticLogs.some((entry) => entry.includes('deepEndpointFetchesCompleted":"3"')), 'detailed diagnostics should report vulnerability endpoint fan-out counts');
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
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'true',
      HaloPsaVulnerabilitySeverities: 'critical,medium',
      HaloPsaVulnerabilityRemediationStatuses: 'due soon',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
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
    const result = await runHaloPsaSync(context, {
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
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'true',
      HaloPsaUpdateSeverities: 'not_real',
      HaloPsaUpdateRemediationStatuses: 'overdue'
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
    const result = await runHaloPsaSync(context, {
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
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'true',
      HaloPsaUpdateSeverities: 'critical,important,moderate,low,unspecified',
      HaloPsaUpdateRemediationStatuses: 'overdue',
      HaloPsaDiagnosticLoggingEnabled: 'true'
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
    const result = await runHaloPsaSync(context, {
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
    assert(diagnosticLogs.some((entry) => entry.includes('updateFilterStrategy":"server-filtered')), 'detailed diagnostics should report the update filter strategy');
    assert(diagnosticLogs.some((entry) => entry.includes('updateTopLevelUniquePackageVersionKeysAfterDedupe":"7"')), 'detailed diagnostics should report unique package/version keys after dedupe');
    assert(diagnosticLogs.some((entry) => entry.includes('updateRowsSkippedBeforeDeepFetch":"2"')), 'detailed diagnostics should report rows skipped before deep fetch');
    assert(diagnosticLogs.some((entry) => entry.includes('updateCrossFilterDuplicateKeys":"1"')), 'detailed diagnostics should report cross-filter duplicate update keys');
    assert(diagnosticLogs.some((entry) => entry.includes('updateServerFilterBreakdown":[{"security_severity":"Critical","pagesFetched":"1","rawRowsFetched":"1","uniquePackageVersionKeys":"1","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-critical:ver-1"]},{"security_severity":"Important","pagesFetched":"1","rawRowsFetched":"2","uniquePackageVersionKeys":"2","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-important:ver-1","pkg-duplicate:ver-1"]},{"security_severity":"Moderate","pagesFetched":"1","rawRowsFetched":"3","uniquePackageVersionKeys":"3","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-moderate:ver-1","pkg-reject-sla:ver-1","pkg-duplicate:ver-1"]},{"security_severity":"Low","pagesFetched":"1","rawRowsFetched":"1","uniquePackageVersionKeys":"1","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"0","sampleUpdateKeys":["pkg-reject-low:ver-1"]},{"security_severity":"Unspecified","pagesFetched":"1","rawRowsFetched":"2","uniquePackageVersionKeys":"1","duplicatePackageVersionKeysWithinFilter":"0","rowsMissingPackageVersionKey":"1","sampleUpdateKeys":["pkg-unspecified:ver-1"]}]')), 'detailed diagnostics should report per-filter update breakdown details');
    assert(diagnosticLogs.some((entry) => entry.includes('updateCrossFilterDuplicatePairs')), 'detailed diagnostics should report overlapping update filter pairs');
    assert(diagnosticLogs.some((entry) => entry.includes('"left":"security_severity=Important"') && entry.includes('"right":"security_severity=Moderate"') && entry.includes('"duplicateKeys":"1"') && entry.includes('"sampleUpdateKeys":["pkg-duplicate:ver-1"]')), 'detailed diagnostics should report the overlapping Important/Moderate update pair with capped key samples');
    assert(diagnosticLogs.some((entry) => entry.includes('updateDeepEndpointFetchesCompleted":"5"')), 'detailed diagnostics should report update endpoint fan-out counts');
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
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'false',
      HaloPsaVulnerabilitySeverities: '',
      HaloPsaUpdateEnabled: 'true',
      HaloPsaUpdateSeverities: 'important',
      HaloPsaUpdateRemediationStatuses: 'overdue'
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
    const result = await runHaloPsaSync(context, {
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
      HaloPsaOfflineEnabled: 'false',
      HaloPsaRebootRequiredEnabled: 'false',
      HaloPsaAutomationFailedEnabled: 'false',
      HaloPsaVulnerabilityEnabled: 'true',
      HaloPsaVulnerabilitySeverities: 'high',
      HaloPsaVulnerabilityRemediationStatuses: 'overdue',
      HaloPsaUpdateEnabled: 'false',
      HaloPsaUpdateSeverities: ''
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
    const result = await runHaloPsaSync(context, {
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
  await runOfflineOnlyCollectionGatingTest();
  await runPreCandidateSignalNotQualifiedDoesNotInflateFinalSkippedTest();
  await runDeletedLinkedTicketIsRecreatedAndNotRecheckedTest();
  await runClosedLinkedTicketCreatesReplacementAndLaterRunsUseItTest();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
