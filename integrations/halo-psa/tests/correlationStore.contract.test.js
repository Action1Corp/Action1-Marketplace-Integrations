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
          const row = state.endpoint.find(
            (item) => item.org_link_id === params[0] && item.endpoint_id === params[1] && item.signal_type === params[2]
          );
          return cloneRow(row) || null;
        }

        if (sql.includes(`FROM ${GROUPED_CORRELATIONS_TABLE}`)) {
          const row = state.grouped.find(
            (item) => item.org_link_id === params[0] && item.signal_type === params[1] && item.issue_key === params[2]
          );
          return cloneRow(row) || null;
        }

        throw new Error(`Unexpected get() SQL: ${sql}`);
      },
      async all(sql, params = []) {
        if (sql.includes(`FROM ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          return state.endpoint
            .filter((item) => item.org_link_id === params[0])
            .map(cloneRow);
        }

        if (sql.includes(`FROM ${GROUPED_CORRELATIONS_TABLE}`)) {
          return state.grouped
            .filter((item) => item.org_link_id === params[0])
            .map(cloneRow);
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
            linked_ticket_id: params[6],
            payload_hash: params[7],
            linked_ticket_status: params[8],
            created_at: params[9],
            updated_at: params[10]
          });
          return;
        }

        if (sql.startsWith(`UPDATE ${ENDPOINT_CORRELATIONS_TABLE}`)) {
          const row = state.endpoint.find(
            (item) => item.org_link_id === params[8] && item.endpoint_id === params[9] && item.signal_type === params[10]
          );
          if (!row) throw new Error('endpoint row not found for update');
          row.integration_id = params[0];
          row.identity_key = params[1];
          row.action1_org_id = params[2];
          row.linked_ticket_id = params[3];
          row.payload_hash = params[4];
          row.linked_ticket_status = params[5];
          row.created_at = params[6];
          row.updated_at = params[7];
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
            linked_ticket_id: params[6],
            payload_hash: params[7],
            linked_ticket_status: params[8],
            created_at: params[9],
            updated_at: params[10]
          });
          return;
        }

        if (sql.startsWith(`UPDATE ${GROUPED_CORRELATIONS_TABLE}`)) {
          const row = state.grouped.find(
            (item) => item.org_link_id === params[8] && item.signal_type === params[9] && item.issue_key === params[10]
          );
          if (!row) throw new Error('grouped row not found for update');
          row.integration_id = params[0];
          row.identity_key = params[1];
          row.action1_org_id = params[2];
          row.linked_ticket_id = params[3];
          row.payload_hash = params[4];
          row.linked_ticket_status = params[5];
          row.created_at = params[6];
          row.updated_at = params[7];
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

async function run() {
  await runEndpointAdapterTests();
  await runGroupedAdapterTests();
  runSafetyTests();
}

async function runEndpointAdapterTests() {
  const context = createContext();
  const store = createDbCorrelationStore(context);

  assert.strictEqual(await getEndpointCorrelation(context, 'org-1', 'ep-1', 'OFFLINE'), null, 'missing endpoint correlation should return null');

  const created = await store.upsertEndpointCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'ep-1',
    signalType: 'offline',
    haloTicketId: '1001',
    payloadHash: 'hash-a',
    linkedTicketStatus: 'Open',
    createdAt: '2026-06-18T10:00:00.000Z',
    updatedAt: '2026-06-18T10:00:00.000Z'
  });

  assert.strictEqual(created.identityKey, 'org-1|ep-1|OFFLINE');
  assert.strictEqual(created.haloTicketId, '1001');
  assert.strictEqual(created.payloadHash, 'hash-a');

  const updated = await store.upsertCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'ep-1',
    signalType: 'OFFLINE',
    haloTicketId: '1001',
    payloadHash: 'hash-b',
    linkedTicketStatus: 'Pending',
    createdAt: '2026-06-18T10:00:00.000Z',
    updatedAt: '2026-06-18T11:00:00.000Z'
  });

  assert.strictEqual(context.__state.endpoint.length, 1, 'endpoint upsert should update existing row without duplicates');
  assert.strictEqual(updated.payloadHash, 'hash-b');
  assert.strictEqual(updated.linkedTicketStatus, 'Pending');

  await store.upsertEndpointCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'ep-1',
    signalType: 'REBOOT_REQUIRED',
    haloTicketId: '1002',
    payloadHash: 'hash-c'
  });
  await store.upsertEndpointCorrelation({
    orgLinkId: 'org-2',
    action1OrgId: 'a1-org-2',
    endpointId: 'ep-1',
    signalType: 'OFFLINE',
    haloTicketId: '2001',
    payloadHash: 'hash-d'
  });

  assert.strictEqual(context.__state.endpoint.length, 3, 'different orgs or signals should not collide');
  assert.strictEqual((await store.listCorrelationsByOrgLink('org-1')).length, 2, 'listCorrelationsByOrgLink should return endpoint correlations for one org');

  await store.deleteCorrelation('org-1', 'ep-1', 'OFFLINE');
  assert.strictEqual(await store.getCorrelation('org-1', 'ep-1', 'OFFLINE'), null, 'deleted endpoint correlation should be absent');
}

async function runGroupedAdapterTests() {
  const context = createContext();
  const store = createDbCorrelationStore(context);

  assert.strictEqual(await getGroupedCorrelation(context, 'org-1', 'VULNERABILITY', 'CVE-1'), null, 'missing grouped correlation should return null');

  const created = await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'vulnerability',
    issueKey: 'CVE-1',
    linkedTicketId: '3001',
    payloadHash: 'hash-a'
  });

  assert.strictEqual(created.identityKey, 'org-1|VULNERABILITY|CVE-1');
  assert.strictEqual(created.linkedTicketId, '3001');

  const updated = await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'VULNERABILITY',
    issueKey: 'CVE-1',
    linkedTicketId: '3001',
    payloadHash: 'hash-b',
    linkedTicketStatus: 'Open'
  });

  assert.strictEqual(context.__state.grouped.length, 1, 'grouped upsert should update existing row without duplicates');
  assert.strictEqual(updated.payloadHash, 'hash-b');

  await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'VULNERABILITY',
    issueKey: 'CVE-2',
    linkedTicketId: '3002',
    payloadHash: 'hash-c'
  });
  await store.upsertGroupedCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'UPDATE',
    issueKey: 'pkg-1:ver-1',
    linkedTicketId: '3003',
    payloadHash: 'hash-d'
  });
  await store.upsertEndpointCorrelation({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    endpointId: 'endpoint-1',
    signalType: 'VULNERABILITY',
    haloTicketId: '4001',
    payloadHash: 'endpoint-hash'
  });

  const allForOrg = await store.listCorrelationsByOrgLink('org-1', { includeGrouped: true });
  assert.strictEqual(allForOrg.length, 4, 'endpoint and grouped correlations should coexist without collision');
  assert.strictEqual(context.__state.grouped.some((row) => row.issue_key === 'endpoint-1'), false, 'grouped correlations must not use synthetic endpoint ids');

  await store.deleteGroupedCorrelation('org-1', 'VULNERABILITY', 'CVE-1');
  assert.strictEqual(await store.getGroupedCorrelation('org-1', 'VULNERABILITY', 'CVE-1'), null, 'deleted grouped correlation should be absent');
}

function runSafetyTests() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'correlationStore.js'), 'utf8');
  assert(source.includes('context.db'), 'correlation store should use context.db');
  assert.strictEqual(source.includes('node:fs'), false, 'correlation store must not use local files');
  assert.strictEqual(source.includes('sync_history'), false, 'correlation store must not write Marketplace sync_history directly');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
