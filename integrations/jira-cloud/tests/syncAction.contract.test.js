const assert = require('assert');
const fs = require('fs');
const path = require('path');

const originalFetch = global.fetch;
const { runJiraCloudSync } = require('../syncAction');

function createSyncContext(overrides = {}) {
  const mappings = overrides.mappings || [
    {
      id: 1,
      action1OrgId: 'org-1',
      action1OrgName: 'Org One',
      jiraProjectId: '1001',
      jiraProjectKey: 'OPS',
      jiraProjectName: 'Operations',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug',
      enabled: true
    }
  ];

  const state = {
    endpointCorrelations: overrides.endpointCorrelations || [],
    groupedCorrelations: overrides.groupedCorrelations || [],
    watermarks: overrides.watermarks || []
  };

  return {
    __state: state,
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
          JiraCloudSiteUrl: 'https://example.atlassian.net',
          JiraCloudUserEmail: 'jira-admin@example.com',
          JiraCloudApiToken: 'jira-secret',
          JiraCloudOfflineEnabled: 'true',
          JiraCloudOfflineThresholdDays: '7',
          JiraCloudRebootRequiredEnabled: 'true',
          JiraCloudAutomationFailedEnabled: 'true',
          JiraCloudAutomationFailedLookbackHours: '24',
          JiraCloudVulnerabilityEnabled: 'true',
          JiraCloudVulnerabilitySeverities: 'HIGH',
          JiraCloudVulnerabilityRemediationStatuses: 'OVERDUE',
          JiraCloudUpdateEnabled: 'true',
          JiraCloudUpdateSeverities: 'IMPORTANT',
          JiraCloudUpdateRemediationStatuses: 'OVERDUE',
          JiraCloudVulnerabilityTicketModel: 'grouped',
          JiraCloudUpdateTicketModel: 'grouped',
          JiraCloudAutomationFailedTicketModel: 'grouped',
          JiraCloudMaxImpactedEndpointsInGroupedTicket: '2',
          JiraCloudMaxOpenTicketsPerOrganization: '30',
          JiraCloudDiagnosticLoggingEnabled: 'false',
          ...(overrides.settings || {})
        };
      },
      async get() {
        return '';
      }
    },
    db: {
      async all(sql, params = []) {
        const normalizedSql = sqlLike(sql);
        if (normalizedSql.includes('FROM jira_cloud_org_project_mappings')) {
          return mappings.map((row) => ({
            id: row.id,
            action1_org_id: row.action1OrgId,
            action1_org_name: row.action1OrgName,
            jira_project_id: row.jiraProjectId,
            jira_project_key: row.jiraProjectKey,
            jira_project_name: row.jiraProjectName,
            jira_issue_type_id: row.jiraIssueTypeId,
            jira_issue_type_name: row.jiraIssueTypeName,
            enabled: row.enabled ? 1 : 0,
            created_at: '2026-06-24T00:00:00Z',
            updated_at: '2026-06-24T00:00:00Z'
          }));
        }
        if (normalizedSql.includes('FROM jira_cloud_endpoint_correlations')) {
          return state.endpointCorrelations.filter((row) => row.org_link_id === params[0]).map(clone);
        }
        if (normalizedSql.includes('FROM jira_cloud_grouped_correlations')) {
          return state.groupedCorrelations.filter((row) => row.org_link_id === params[0]).map(clone);
        }
        throw new Error(`Unexpected SQL all(): ${sql}`);
      },
      async get(sql, params = []) {
        const normalizedSql = sqlLike(sql);
        if (normalizedSql.includes('FROM jira_cloud_endpoint_correlations')) {
          return clone(
            state.endpointCorrelations.find(
              (row) => row.org_link_id === params[0] && row.endpoint_id === params[1] && row.signal_type === params[2]
            )
          ) || null;
        }
        if (normalizedSql.includes('FROM jira_cloud_grouped_correlations')) {
          return clone(
            state.groupedCorrelations.find(
              (row) => row.org_link_id === params[0] && row.signal_type === params[1] && row.issue_key === params[2]
            )
          ) || null;
        }
        if (normalizedSql.includes('FROM jira_cloud_signal_watermarks')) {
          return clone(
            state.watermarks.find(
              (row) => row.org_link_id === params[0] && row.signal_type === params[1]
            )
          ) || null;
        }
        return null;
      },
      async run(sql, params = []) {
        const normalizedSql = sqlLike(sql);
        if (normalizedSql.startsWith('INSERT INTO jira_cloud_endpoint_correlations')) {
          state.endpointCorrelations.push({
            id: state.endpointCorrelations.length + 1,
            integration_id: params[0],
            identity_key: params[1],
            org_link_id: params[2],
            action1_org_id: params[3],
            endpoint_id: params[4],
            signal_type: params[5],
            jira_issue_id: params[6],
            jira_issue_key: params[7],
            jira_issue_url: params[8],
            payload_hash: params[9],
            linked_issue_status: params[10],
            created_at: params[11],
            updated_at: params[12]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE jira_cloud_endpoint_correlations')) {
          const row = state.endpointCorrelations.find(
            (entry) => entry.org_link_id === params[10] && entry.endpoint_id === params[11] && entry.signal_type === params[12]
          );
          if (row) {
            row.integration_id = params[0];
            row.identity_key = params[1];
            row.action1_org_id = params[2];
            row.jira_issue_id = params[3];
            row.jira_issue_key = params[4];
            row.jira_issue_url = params[5];
            row.payload_hash = params[6];
            row.linked_issue_status = params[7];
            row.created_at = params[8];
            row.updated_at = params[9];
          }
          return;
        }
        if (normalizedSql.startsWith('INSERT INTO jira_cloud_grouped_correlations')) {
          state.groupedCorrelations.push({
            id: state.groupedCorrelations.length + 1,
            integration_id: params[0],
            identity_key: params[1],
            org_link_id: params[2],
            action1_org_id: params[3],
            signal_type: params[4],
            issue_key: params[5],
            jira_issue_id: params[6],
            jira_issue_key: params[7],
            jira_issue_url: params[8],
            payload_hash: params[9],
            linked_issue_status: params[10],
            created_at: params[11],
            updated_at: params[12]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE jira_cloud_grouped_correlations')) {
          const row = state.groupedCorrelations.find(
            (entry) => entry.org_link_id === params[10] && entry.signal_type === params[11] && entry.issue_key === params[12]
          );
          if (row) {
            row.integration_id = params[0];
            row.identity_key = params[1];
            row.action1_org_id = params[2];
            row.jira_issue_id = params[3];
            row.jira_issue_key = params[4];
            row.jira_issue_url = params[5];
            row.payload_hash = params[6];
            row.linked_issue_status = params[7];
            row.created_at = params[8];
            row.updated_at = params[9];
          }
          return;
        }
        if (normalizedSql.startsWith('INSERT INTO jira_cloud_signal_watermarks')) {
          state.watermarks.push({
            id: state.watermarks.length + 1,
            integration_id: params[0],
            org_link_id: params[1],
            action1_org_id: params[2],
            signal_type: params[3],
            watermark_value: params[4],
            watermark_at: params[5],
            metadata_json: params[6],
            created_at: params[7],
            updated_at: params[8]
          });
          return;
        }
        if (normalizedSql.startsWith('UPDATE jira_cloud_signal_watermarks')) {
          const row = state.watermarks.find(
            (entry) => entry.org_link_id === params[7] && entry.signal_type === params[8]
          );
          if (row) {
            row.integration_id = params[0];
            row.action1_org_id = params[1];
            row.watermark_value = params[2];
            row.watermark_at = params[3];
            row.metadata_json = params[4];
            row.created_at = params[5];
            row.updated_at = params[6];
          }
          return;
        }
        if (normalizedSql.startsWith('DELETE FROM jira_cloud_signal_watermarks')) {
          const next = state.watermarks.filter(
            (entry) => !(entry.org_link_id === params[0] && entry.signal_type === params[1])
          );
          state.watermarks.length = 0;
          state.watermarks.push(...next);
          return;
        }
        throw new Error(`Unexpected SQL write: ${sql}`);
      }
    },
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  };
}

function clone(value) {
  return value ? { ...value } : value;
}

function sqlLike(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function withMockedFetch(mock, worker) {
  global.fetch = mock;
  try {
    await worker();
  } finally {
    global.fetch = originalFetch;
  }
}

function buildHappyPathMock() {
  const issueStateByKey = new Map();
  let createCounter = 0;
  const fetchCalls = [];
  const mock = async (url, options = {}) => {
    const urlText = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    fetchCalls.push({ url: urlText, method, body: String(options.body || '') });
    const response = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get() { return 'application/json'; } },
      text: async () => JSON.stringify(payload)
    });

    if (urlText.endsWith('/oauth2/token')) {
      return response(200, { access_token: 'action1-token' });
    }
    if (urlText.endsWith('/rest/api/3/issue') && method === 'POST') {
      createCounter += 1;
      const key = `OPS-${createCounter}`;
      issueStateByKey.set(key, {
        id: String(10000 + createCounter),
        key,
        self: `https://example.atlassian.net/rest/api/3/issue/${10000 + createCounter}`,
        fields: { status: { name: 'To Do' } }
      });
      return response(201, {
        id: String(10000 + createCounter),
        key,
        self: `https://example.atlassian.net/rest/api/3/issue/${10000 + createCounter}`
      });
    }
    if (urlText.includes('/rest/api/3/issue/OPS-') && method === 'GET') {
      const key = decodeURIComponent(urlText.split('/rest/api/3/issue/')[1]);
      const issue = issueStateByKey.get(key);
      if (!issue) {
        return response(404, { message: 'not found' });
      }
      return response(200, issue);
    }
    if (urlText.includes('/rest/api/3/issue/OPS-') && method === 'PUT') {
      return {
        ok: true,
        status: 204,
        headers: { get() { return 'application/json'; } },
        text: async () => ''
      };
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return response(200, {
        items: [
          { id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'yes' },
          { id: 'ep-2', name: 'Endpoint Two', last_seen: '2026-06-20_00-00-00', reboot_required: 'no' }
        ],
        from: 0,
        total_items: 2
      });
    }
    if (urlText.includes('/vulnerabilities/org-1?')) {
      return response(200, {
        items: [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-1/endpoints')) {
      return response(200, {
        items: [{ id: 'ep-1' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/updates/org-1?')) {
      return response(200, {
        items: [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
      return response(200, {
        items: [{ id: 'ep-2' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/automations/instances/org-1?')) {
      return response(200, {
        items: [{ id: 'inst-1', end_time: '2026-06-22_00-00-00', action_name: 'Patch' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/automations/instances/org-1/inst-1/endpoint-results')) {
      return response(200, {
        items: [{ id: 'ep-2', status: 'Error', description: 'Failed to patch' }],
        from: 0,
        total_items: 1
      });
    }

    throw new Error(`Unexpected fetch ${urlText}`);
  };

  return { fetchCalls, mock };
}

async function runLifecycleSyncHappyPathTest() {
  const { fetchCalls, mock } = buildHappyPathMock();
  const runLogs = [];
  let assetsProcessed = null;

  await withMockedFetch(mock, async () => {
    const result = await runJiraCloudSync(createSyncContext(), {
      run: {
        async appendLog(message) {
          runLogs.push(String(message));
        },
        async setAssetsProcessed(value) {
          assetsProcessed = value;
        }
      }
    });

    assert.strictEqual(result.ok, true);
    assert(result.summary.candidatesSeen >= 3);
    assert(result.summary.created >= 3);
    assert.strictEqual(result.summary.updated, 0);
    assert.strictEqual(result.summary.failed, 0);
    assert.strictEqual(assetsProcessed, 2);
    assert.strictEqual(result.assetsProcessed, 2);
    assert.strictEqual(fetchCalls.some((entry) => entry.url.includes('/rest/api/3/issue') && entry.method === 'POST'), true);
    assert.strictEqual(fetchCalls.some((entry) => /\/rest\/api\/3\/issue\/.+\/transitions/i.test(entry.url)), false);
    assert.strictEqual(fetchCalls.some((entry) => /\/rest\/api\/3\/issue\/.+\/resolution/i.test(entry.url)), false);
    assert.strictEqual(runLogs.some((entry) => entry.includes('Starting Jira Cloud sync.')), true);
    assert.strictEqual(runLogs.some((entry) => entry.includes('Loading Jira Cloud runtime configuration.')), true);
    assert.strictEqual(runLogs.some((entry) => entry.includes('Jira candidate pipeline completed.')), true);
    assert.strictEqual(runLogs.some((entry) => entry.includes('Jira Cloud sync completed.')), true);
    assert.strictEqual(JSON.stringify(result).includes('jira-secret'), false);
    assert.strictEqual(runLogs.some((entry) => entry.includes('authorization=')), false);
    assert.strictEqual(String(result.details || '').includes('JIRA_CLOUD_SYNC_SUMMARY_BEGIN'), true, 'sync should emit an explicit Jira summary block');
    assert.strictEqual(result.diagnostics.executionPlan.enabledSignals.includes('OFFLINE'), true, 'diagnostics should include enabled signal planning');
    assert.strictEqual(result.diagnostics.settingsSummary.ticketModels.vulnerability, 'grouped', 'diagnostics should reflect settings-driven ticket model state');
  });
}

async function runNoEnabledSignalsNoOpTest() {
  const { fetchCalls, mock } = buildHappyPathMock();
  const runLogs = [];

  await withMockedFetch(mock, async () => {
    const result = await runJiraCloudSync(createSyncContext({
      settings: {
        JiraCloudOfflineEnabled: 'false',
        JiraCloudRebootRequiredEnabled: 'false',
        JiraCloudAutomationFailedEnabled: 'false',
        JiraCloudVulnerabilityEnabled: 'false',
        JiraCloudVulnerabilitySeverities: '',
        JiraCloudUpdateEnabled: 'false',
        JiraCloudUpdateSeverities: ''
      }
    }), {
      run: {
        async appendLog(message) {
          runLogs.push(String(message));
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'all-disabled settings should no-op successfully');
    assert.strictEqual(result.summary.candidatesSeen, 0);
    assert.strictEqual(result.assetsProcessed, 0);
    assert.strictEqual(fetchCalls.length, 0, 'all-disabled settings should skip external collection and Jira calls');
    assert.strictEqual(runLogs.some((entry) => entry.includes('no signals are enabled')), true, 'run logs should explain the no-op result');
  });
}

async function runOfflineOnlyCollectionGatingTest() {
  const { fetchCalls, mock } = buildHappyPathMock();
  const runLogs = [];

  await withMockedFetch(mock, async () => {
    const result = await runJiraCloudSync(createSyncContext({
      settings: {
        JiraCloudOfflineEnabled: 'true',
        JiraCloudOfflineThresholdDays: '7',
        JiraCloudRebootRequiredEnabled: 'false',
        JiraCloudAutomationFailedEnabled: 'false',
        JiraCloudVulnerabilityEnabled: 'false',
        JiraCloudVulnerabilitySeverities: '',
        JiraCloudUpdateEnabled: 'false',
        JiraCloudUpdateSeverities: ''
      }
    }), {
      run: {
        async appendLog(message) {
          runLogs.push(String(message));
        },
        async setAssetsProcessed() {}
      }
    });

    const urls = fetchCalls.map((entry) => entry.url);
    assert.strictEqual(result.ok, true, 'offline-only run should complete successfully');
    assert.strictEqual(urls.some((url) => url.includes('/endpoints/managed/org-1')), true, 'offline-only run should still fetch endpoints');
    assert.strictEqual(urls.some((url) => url.includes('/vulnerabilities/org-1')), false, 'offline-only run should not collect vulnerabilities');
    assert.strictEqual(urls.some((url) => url.includes('/updates/org-1')), false, 'offline-only run should not collect updates');
    assert.strictEqual(urls.some((url) => url.includes('/automations/instances/org-1')), false, 'offline-only run should not collect automation failures');
    assert.strictEqual(runLogs.some((entry) => entry.includes('Skipping Action1 vulnerability collection because VULNERABILITY is disabled.')), true);
    assert.strictEqual(runLogs.some((entry) => entry.includes('Skipping Action1 update collection because UPDATE is disabled.')), true);
    assert.strictEqual(runLogs.some((entry) => entry.includes('Skipping Action1 automation-failed collection because AUTOMATION_FAILED is disabled.')), true);
  });
}

async function runTransientAction1CollectionRetryParityTest() {
  const { fetchCalls, mock } = buildHappyPathMock();
  const runLogs = [];
  let endpointAttempts = 0;

  await withMockedFetch(async (url, options = {}) => {
    const urlText = String(url);
    if (urlText.includes('/endpoints/managed/org-1')) {
      endpointAttempts += 1;
      if (endpointAttempts === 1) {
        fetchCalls.push({ url: urlText, method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') });
        return {
          ok: false,
          status: 429,
          headers: {
            forEach(callback) {
              callback('application/json', 'content-type');
              callback('0', 'retry-after');
            }
          },
          text: async () => JSON.stringify({ message: 'rate limited' })
        };
      }
    }
    return mock(url, options);
  }, async () => {
    const result = await runJiraCloudSync(createSyncContext(), {
      run: {
        async appendLog(message) {
          runLogs.push(String(message));
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'transient Action1 collection failures should recover before they flip the whole Jira sync to failed');
    assert.strictEqual(result.summary.failed, 0, 'successful retry recovery should not leave a failed collection count behind');
    assert.strictEqual(result.summary.created >= 3, true, 'lifecycle should still run after the recovered Action1 read');
    assert.strictEqual(fetchCalls.filter((entry) => entry.url.includes('/endpoints/managed/org-1')).length >= 2, true, 'Action1 endpoint collection should retry the transient failing request');
    assert.strictEqual(runLogs.some((entry) => entry.includes('[Action1][rate-limit] 429')), true, 'request.run logs should surface the Halo-style safe internal retry instead of requiring a whole-sync retry');
    assert.strictEqual(runLogs.some((entry) => entry.includes('Action1 read-only collection failed for Org One.')), false, 'the org-level collection warning should not be emitted when the internal retry recovers');
  });
}

async function runCompletedStatusCategoryReasonSurfacedTest() {
  const { mock } = buildHappyPathMock();
  const runLogs = [];
  const context = createSyncContext({
    endpointCorrelations: [
      {
        org_link_id: '1',
        action1_org_id: 'org-1',
        endpoint_id: 'ep-1',
        signal_type: 'OFFLINE',
        jira_issue_id: '10001',
        jira_issue_key: 'OPS-1',
        jira_issue_url: 'https://example.atlassian.net/browse/OPS-1',
        payload_hash: 'old-hash',
        linked_issue_status: 'Done',
        created_at: '2026-06-24T00:00:00Z',
        updated_at: '2026-06-24T00:00:00Z'
      }
    ]
  });

  await withMockedFetch(async (url, options = {}) => {
    const urlText = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (urlText.includes('/rest/api/3/issue/10001') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          id: '10001',
          key: 'OPS-1',
          self: 'https://example.atlassian.net/rest/api/3/issue/10001',
          fields: {
            status: {
              name: 'Done',
              statusCategory: { key: 'done', name: 'Done' }
            }
          }
        })
      };
    }
    return mock(url, options);
  }, async () => {
    const result = await runJiraCloudSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(String(message));
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.summary.created >= 1, true, 'done linked Jira issues should recreate through the full sync seam');
    assert.strictEqual(context.__state.endpointCorrelations[0].jira_issue_key === 'OPS-1', false, 'recreated full-sync runs should repoint endpoint correlations to the new Jira issue');
    const combinedReasons = JSON.stringify(result.summary.skippedByReason || {});
    assert.strictEqual(/LINKED_ISSUE_COMPLETED_(NO_REOPEN|CREATE_NEW)/.test(combinedReasons) || JSON.stringify(result.candidatesPreview).includes('LINKED_ISSUE_COMPLETED_'), true, 'done linked-issue reasons should be surfaced deterministically from statusCategory.key');
    const decisionLog = runLogs.find((entry) => entry.includes('Jira lifecycle decision.') && entry.includes('LINKED_ISSUE_COMPLETED_CREATE_NEW'));
    assert(decisionLog, 'full sync runs should emit per-candidate Jira lifecycle decision logs');
    assert(decisionLog.includes('\"linkedIssueStatusCategoryKey\":\"done\"'), 'decision logs should include the normalized Jira status category key');
    assert(decisionLog.includes('\"linkedIssueCompleted\":\"true\"') || decisionLog.includes('\"linkedIssueCompleted\":true'), 'decision logs should include the completed boolean');
    assert(decisionLog.includes('\"decision\":\"CREATE\"'), 'decision logs should show recreate decisions explicitly');
    assert(decisionLog.includes('\"reason\":\"LINKED_ISSUE_COMPLETED_CREATE_NEW\"'), 'decision logs should explain completed linked-issue recreation');
    const summaryLog = runLogs.find((entry) => entry.includes('Jira lifecycle execution completed.'));
    assert(summaryLog && summaryLog.includes('\"skippedByReason\"') && summaryLog.includes('\"bySignalAndReason\"'), 'run logs should include lifecycle reason breakdown summaries');
  });
}

async function runAutomationLookbackAndUpdateParityTest() {
  const fetchCalls = [];
  const context = createSyncContext();

  await withMockedFetch(async (url, options = {}) => {
    const urlText = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    fetchCalls.push({ url: urlText, method, body: String(options.body || '') });
    const response = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get() { return 'application/json'; } },
      text: async () => JSON.stringify(payload)
    });

    if (urlText.endsWith('/oauth2/token')) {
      return response(200, { access_token: 'action1-token', expires_in: 3600 });
    }
    if (urlText.endsWith('/rest/api/3/issue') && method === 'POST') {
      return response(201, {
        id: '10001',
        key: 'OPS-1',
        self: 'https://example.atlassian.net/rest/api/3/issue/10001'
      });
    }
    if (urlText.includes('/rest/api/3/issue/OPS-1') && method === 'GET') {
      return response(200, {
        id: '10001',
        key: 'OPS-1',
        self: 'https://example.atlassian.net/rest/api/3/issue/10001',
        fields: { status: { name: 'To Do' } }
      });
    }
    if (urlText.includes('/rest/api/3/issue/OPS-1') && method === 'PUT') {
      return {
        ok: true,
        status: 204,
        headers: { get() { return 'application/json'; } },
        text: async () => ''
      };
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return response(200, {
        items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-24_12-00-00', reboot_required: 'no' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/vulnerabilities/org-1?')) {
      return response(200, { items: [], from: 0, total_items: 0 });
    }
    if (urlText.includes('/updates/org-1?')) {
      return response(200, {
        items: [
          {
            id: 'pkg-nested',
            package_name: 'Nested Package',
            security_severity: 'Important',
            update_sla_status: 'Overdue',
            versions: [{ id: 'ver-nested', version_name: '1.2.3' }]
          }
        ],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/updates/org-1/pkg-nested/versions/ver-nested/endpoints')) {
      return response(200, {
        items: [{ id: 'ep-1' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/automations/instances/org-1?')) {
      return response(200, {
        items: [
          { id: 'inst-recent', end_time: '2026-06-24_23-00-00', action_name: 'Patch recent' },
          { id: 'inst-old', end_time: '2026-05-01_10-00-00', action_name: 'Patch old' }
        ],
        from: 0,
        total_items: 2
      });
    }
    if (urlText.includes('/automations/instances/org-1/inst-recent/endpoint-results')) {
      return response(200, {
        items: [{ id: 'ep-1', status: 'Error', description: 'Failed recently' }],
        from: 0,
        total_items: 1
      });
    }
    if (urlText.includes('/automations/instances/org-1/inst-old/endpoint-results')) {
      throw new Error('old automation instance should not be fanned out');
    }

    throw new Error(`Unexpected fetch ${urlText}`);
  }, async () => {
    const result = await runJiraCloudSync(context, {
      run: {
        async appendLog() {},
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, true, 'nested update rows and in-scope automation failures should still sync successfully');
    assert.strictEqual(fetchCalls.some((entry) => entry.url.includes('/updates/org-1/pkg-nested/versions/ver-nested/endpoints')), true, 'Jira should fan out nested Halo-style update version descriptors');
    assert.strictEqual(fetchCalls.some((entry) => entry.url.includes('/automations/instances/org-1/inst-old/endpoint-results')), false, 'Jira should stop before fanning out old automation instances outside the lookback window');
    assert.strictEqual(context.__state.watermarks.length >= 1, true, 'successful automation collection should persist watermarks');
    assert.strictEqual(String(context.__state.watermarks[0].watermark_value || '').includes('2026-06-24_23-00-00'), true, 'persisted watermark should track the newest in-scope automation end_time');
  });
}

async function runMissingWatermarkTableFailureDiagnosticsTest() {
  const { mock } = buildHappyPathMock();
  const runLogs = [];
  const context = createSyncContext();
  const originalGet = context.db.get;

  context.db.get = async (sql, params = []) => {
    const normalizedSql = sqlLike(sql);
    if (normalizedSql.includes('FROM jira_cloud_signal_watermarks')) {
      const error = new Error('relation "jira_cloud_signal_watermarks" does not exist');
      error.code = '42P01';
      error.relation = 'jira_cloud_signal_watermarks';
      throw error;
    }
    return originalGet(sql, params);
  };

  await withMockedFetch(mock, async () => {
    const result = await runJiraCloudSync(context, {
      run: {
        async appendLog(message) {
          runLogs.push(String(message));
        },
        async setAssetsProcessed() {}
      }
    });

    assert.strictEqual(result.ok, false, 'missing runtime watermark tables should fail the overall Jira sync result');
    assert.strictEqual(result.summary.failed >= 1, true, 'missing runtime watermark tables should count as collection failures');
    assert.strictEqual(result.diagnostics.warnings.some((warning) => warning.reason === 'database_error'), true, 'sync diagnostics should classify missing runtime tables as safe database errors');
    assert.strictEqual(result.diagnostics.warnings.some((warning) => warning.code === '42P01'), true, 'sync diagnostics should preserve the PostgreSQL error code');
    assert.strictEqual(result.diagnostics.warnings.some((warning) => warning.relation === 'jira_cloud_signal_watermarks'), true, 'sync diagnostics should preserve the missing Jira table name');
    assert.strictEqual(result.diagnostics.warnings.some((warning) => warning.operation === 'loadAutomationFailedWatermark'), true, 'sync diagnostics should preserve the failing store operation');
    assert.strictEqual(runLogs.some((entry) => entry.includes('Action1 signal collection failed for Org One.')), true, 'request.run logs should identify the signal collection seam rather than misreporting a pure Action1 read-only failure');
    assert.strictEqual(runLogs.some((entry) => entry.includes('"code":"42P01"')), true, 'request.run logs should include the safe PostgreSQL error code');
    assert.strictEqual(runLogs.some((entry) => entry.includes('"relation":"jira_cloud_signal_watermarks"')), true, 'request.run logs should include the safe missing relation');
    assert.strictEqual(runLogs.some((entry) => entry.includes('"operation":"loadAutomationFailedWatermark"')), true, 'request.run logs should include the safe failing store operation');
  });
}

function runRegressionGuards() {
  const integrationDir = path.join(__dirname, '..');
  const runtimeFiles = fs.readdirSync(integrationDir).filter((fileName) => fileName.endsWith('.js'));
  const combinedSource = runtimeFiles
    .map((fileName) => fs.readFileSync(path.join(integrationDir, fileName), 'utf8'))
    .join('\n');

  assert.strictEqual(combinedSource.includes('@forge/'), false, 'runtime files must not import Forge');
  assert.strictEqual(combinedSource.includes("require('../database')"), false, 'runtime files must not import Marketplace backend internals');
  assert.strictEqual(/createIssue\s*\(/.test(combinedSource), true, 'Jira issue create methods should exist');
  assert.strictEqual(/updateIssue\s*\(/.test(combinedSource), true, 'Jira issue update methods should exist');
  assert.strictEqual(/getIssue\s*\(/.test(combinedSource), true, 'Jira issue get methods should exist');
  assert.strictEqual(/transitionIssue\s*\(/i.test(combinedSource), false, 'Jira transition behavior must not exist');
  assert.strictEqual(/\/rest\/api\/3\/issue\/[^"'`\s]+\/transitions/i.test(combinedSource), false, 'Jira transition endpoints must not exist');
  assert.strictEqual(/updateResolution\s*\(/i.test(combinedSource), false, 'Jira resolution mutation behavior must not exist');
  assert.strictEqual(/\/rest\/api\/3\/issue\/[^"'`\s]+\/resolution/i.test(combinedSource), false, 'Jira resolution mutation endpoints must not exist');
  assert.strictEqual(/setTicketStatus\s*\(/.test(combinedSource), false, 'close or status lifecycle behavior must not exist');
}

async function run() {
  await runLifecycleSyncHappyPathTest();
  await runNoEnabledSignalsNoOpTest();
  await runOfflineOnlyCollectionGatingTest();
  await runTransientAction1CollectionRetryParityTest();
  await runAutomationLookbackAndUpdateParityTest();
  await runMissingWatermarkTableFailureDiagnosticsTest();
  await runCompletedStatusCategoryReasonSurfacedTest();
  runRegressionGuards();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
