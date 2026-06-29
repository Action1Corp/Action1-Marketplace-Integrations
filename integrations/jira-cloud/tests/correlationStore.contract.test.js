const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ENDPOINT_CORRELATIONS_TABLE,
  GROUPED_CORRELATIONS_TABLE,
  createDbCorrelationStore,
  getEndpointCorrelation,
  getGroupedCorrelation
} = require('../correlationStore');

function createContext() {
  const state = {
    endpoint: [],
    grouped: [],
    nextId: 1
  };

  function cloneRow(row) {
    return row ? { ...row } : row;
  }

  return {
    __state: state,
    db: {
      async get(sql, params = []) {
        if (sql.includes(`FROM ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          return cloneRow(
            state.endpoint.find(
              (item) => item.org_link_id === params[0] && item.endpoint_id === params[1] && item.signal_type === params[2]
            )
          ) || null;
        }

        if (sql.includes(`FROM ${GROUPED_CORRELATIONS_TABLE}`)) {
          return cloneRow(
            state.grouped.find(
              (item) => item.org_link_id === params[0] && item.signal_type === params[1] && item.issue_key === params[2]
            )
          ) || null;
        }

        throw new Error(`Unexpected get() SQL: ${sql}`);
      },
      async all(sql, params = []) {
        if (sql.includes(`FROM ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          return state.endpoint.filter((item) => item.org_link_id === params[0]).map(cloneRow);
        }

        if (sql.includes(`FROM ${GROUPED_CORRELATIONS_TABLE}`)) {
          return state.grouped.filter((item) => item.org_link_id === params[0]).map(cloneRow);
        }

        throw new Error(`Unexpected all() SQL: ${sql}`);
      },
      async run(sql, params = []) {
        if (sql.startsWith(`INSERT INTO ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          state.endpoint.push({
            id: state.nextId++,
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

        if (sql.startsWith(`UPDATE ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          const row = state.endpoint.find(
            (item) => item.org_link_id === params[10] && item.endpoint_id === params[11] && item.signal_type === params[12]
          );
          if (!row) throw new Error('endpoint row not found for update');
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
          return;
        }

        if (sql.startsWith(`DELETE FROM ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          state.endpoint = state.endpoint.filter(
            (item) => !(item.org_link_id === params[0] && item.endpoint_id === params[1] && item.signal_type === params[2])
          );
          return;
        }

        if (sql.startsWith(`INSERT INTO ${GROUPED_CORRELATIONS_TABLE}`)) {
          state.grouped.push({
            id: state.nextId++,
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

        if (sql.startsWith(`UPDATE ${GROUPED_CORRELATIONS_TABLE}`)) {
          const row = state.grouped.find(
            (item) => item.org_link_id === params[10] && item.signal_type === params[11] && item.issue_key === params[12]
          );
          if (!row) throw new Error('grouped row not found for update');
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
          return;
        }

        if (sql.startsWith(`DELETE FROM ${GROUPED_CORRELATIONS_TABLE}`)) {
          state.grouped = state.grouped.filter(
            (item) => !(item.org_link_id === params[0] && item.signal_type === params[1] && item.issue_key === params[2])
          );
          return;
        }

        throw new Error(`Unexpected run() SQL: ${sql}`);
      }
    }
  };
}

async function runEndpointAdapterTests() {
  const context = createContext();
  const store = createDbCorrelationStore(context);

  assert.strictEqual(await getEndpointCorrelation(context, 'org-1', 'ep-1', 'OFFLINE'), null);

  const created = await store.upsertEndpointCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'ep-1',
    signalType: 'offline',
    jiraIssueId: '10001',
    jiraIssueKey: 'OPS-1',
    jiraIssueUrl: 'https://example.atlassian.net/browse/OPS-1',
    payloadHash: 'hash-a',
    linkedIssueStatus: 'To Do',
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z'
  });

  assert.strictEqual(created.identityKey, 'org-1|ep-1|OFFLINE');
  assert.strictEqual(created.jiraIssueId, '10001');
  assert.strictEqual(created.jiraIssueKey, 'OPS-1');
  assert.strictEqual(created.payloadHash, 'hash-a');

  const updated = await store.upsertCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'ep-1',
    signalType: 'OFFLINE',
    jiraIssueId: '10001',
    jiraIssueKey: 'OPS-1',
    jiraIssueUrl: 'https://example.atlassian.net/browse/OPS-1',
    payloadHash: 'hash-b',
    linkedIssueStatus: 'In Progress',
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T11:00:00.000Z'
  });

  assert.strictEqual(context.__state.endpoint.length, 1);
  assert.strictEqual(updated.payloadHash, 'hash-b');
  assert.strictEqual(updated.linkedIssueStatus, 'In Progress');

  await store.upsertEndpointCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'ep-1',
    signalType: 'REBOOT_REQUIRED',
    jiraIssueId: '10002',
    jiraIssueKey: 'OPS-2'
  });
  await store.upsertEndpointCorrelation({
    orgLinkId: 'org-2',
    action1OrgId: 'a1-org-2',
    endpointId: 'ep-1',
    signalType: 'OFFLINE',
    jiraIssueId: '20001',
    jiraIssueKey: 'OPS-3'
  });

  assert.strictEqual(context.__state.endpoint.length, 3, 'endpoint correlations should stay isolated by orgLinkId and signal');
  assert.strictEqual((await store.listCorrelationsByOrgLink('org-1')).length, 2);

  await store.deleteCorrelation('org-1', 'ep-1', 'OFFLINE');
  assert.strictEqual(await store.getCorrelation('org-1', 'ep-1', 'OFFLINE'), null);
}

async function runGroupedAdapterTests() {
  const context = createContext();
  const store = createDbCorrelationStore(context);

  assert.strictEqual(await getGroupedCorrelation(context, 'org-1', 'VULNERABILITY', 'CVE-1'), null);

  const created = await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'vulnerability',
    issueKey: 'CVE-1',
    jiraIssueId: '30001',
    jiraIssueKey: 'OPS-10',
    payloadHash: 'hash-a'
  });

  assert.strictEqual(created.identityKey, 'org-1|VULNERABILITY|CVE-1');
  assert.strictEqual(created.jiraIssueKey, 'OPS-10');

  const updated = await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'VULNERABILITY',
    issueKey: 'CVE-1',
    jiraIssueId: '30001',
    jiraIssueKey: 'OPS-10',
    payloadHash: 'hash-b',
    linkedIssueStatus: 'Done'
  });

  assert.strictEqual(context.__state.grouped.length, 1);
  assert.strictEqual(updated.payloadHash, 'hash-b');

  await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'VULNERABILITY',
    issueKey: 'CVE-2',
    jiraIssueId: '30002',
    jiraIssueKey: 'OPS-11'
  });
  await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'UPDATE',
    issueKey: 'pkg-1:ver-1',
    jiraIssueId: '30003',
    jiraIssueKey: 'OPS-12'
  });
  await store.upsertEndpointCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'endpoint-1',
    signalType: 'VULNERABILITY',
    jiraIssueId: '40001',
    jiraIssueKey: 'OPS-13'
  });

  const allForOrg = await store.listCorrelationsByOrgLink('org-1', { includeGrouped: true });
  assert.strictEqual(allForOrg.length, 4);
  assert.strictEqual(context.__state.grouped.some((row) => row.issue_key === 'endpoint-1'), false);

  await store.deleteGroupedCorrelation('org-1', 'VULNERABILITY', 'CVE-1');
  assert.strictEqual(await store.getGroupedCorrelation('org-1', 'VULNERABILITY', 'CVE-1'), null);
}

function runSafetyTests() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'correlationStore.js'), 'utf8');
  assert(source.includes('context.db'), 'correlation store should use context.db');
  assert.strictEqual(source.includes('node:fs'), false, 'correlation store must not use local files');
  assert.strictEqual(source.includes('sync_history'), false, 'correlation store must not write Marketplace sync_history directly');
}

async function run() {
  await runEndpointAdapterTests();
  await runGroupedAdapterTests();
  runSafetyTests();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
