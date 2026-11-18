const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');
const {
  ENDPOINT_CORRELATIONS_TABLE,
  GROUPED_CORRELATIONS_TABLE,
  createDbCorrelationStore,
  getEndpointCorrelation,
  getGroupedCorrelation
} = require('../correlationStore');
const { createDbMappingStore } = require('../mappingStore');

async function run() {
  await runEndpointAdapterTests();
  await runGroupedAdapterTests();
  runSafetyTests();
  console.log('Action1 Ticketing correlation store contract tests passed.');
}

async function runEndpointAdapterTests() {
  const { context, tables } = createInMemoryTicketingDb();
  const mappingsA = createDbMappingStore(context, 'provider-a');
  const mappingsB = createDbMappingStore(context, 'provider-b');
  const mapA = await mappingsA.save({ action1OrgId: 'source-1', action1OrgName: 'Alpha', destinationId: 'dest-1', destinationName: 'Alpha' });
  const mapB = await mappingsB.save({ action1OrgId: 'source-1', action1OrgName: 'Alpha', destinationId: 'dest-1', destinationName: 'Alpha' });
  const storeA = createDbCorrelationStore(context, 'provider-a');
  const storeB = createDbCorrelationStore(context, 'provider-b');

  assert.strictEqual(await getEndpointCorrelation(context, 'provider-a', mapA.id, 'ep-1', 'OFFLINE'), null, 'missing endpoint correlation should return null');
  const created = await storeA.upsertEndpointCorrelation({
    orgLinkId: String(mapA.id), action1OrgId: 'source-1', endpointId: 'ep-1', signalType: 'offline',
    externalTicketRef: { id: '0001001', displayId: 'CASE-1001', url: 'https://tickets.example.test/1001', metadata: { queue: 'service' } },
    payloadHash: 'hash-a', comparisonVersion: '1', linkedTicketStatus: 'Open',
    createdAt: '2026-06-18T10:00:00.000Z', updatedAt: '2026-06-18T10:00:00.000Z'
  });
  assert.strictEqual(created.identityKey, `${mapA.id}|ep-1|OFFLINE`);
  assert.strictEqual(created.externalTicketRef.id, '0001001', 'external IDs remain opaque strings');
  assert.strictEqual(created.haloTicketId, '0001001', 'copied lifecycle alias remains temporarily available');
  assert.strictEqual(created.comparisonVersion, '1');
  assert.strictEqual((await storeA.upsertEndpointCorrelation({
    orgLinkId: String(mapA.id), endpointId: 'ep-1', signalType: 'OFFLINE', linkedTicketId: '1001', payloadHash: 'hash-b', linkedTicketStatus: 'Pending',
    createdAt: '2026-06-18T10:00:00.000Z', updatedAt: '2026-06-18T11:00:00.000Z'
  })).payloadHash, 'hash-b');

  await storeB.upsertEndpointCorrelation({ orgLinkId: String(mapB.id), endpointId: 'ep-1', signalType: 'OFFLINE', linkedTicketId: '1001', payloadHash: 'provider-b' });
  await storeA.upsertEndpointCorrelation({ orgLinkId: String(mapA.id), endpointId: 'ep-1', signalType: 'REBOOT_REQUIRED', linkedTicketId: '1002' });
  await storeA.upsertEndpointCorrelation({ orgLinkId: String(mapA.id), endpointId: 'ep-2', signalType: 'OFFLINE', linkedTicketId: '2001' });

  assert.strictEqual(tables.get(ENDPOINT_CORRELATIONS_TABLE).length, 4, 'provider or signal differences remain distinct');
  assert.strictEqual((await storeA.listEndpointCorrelationsByOrgLink(String(mapA.id))).length, 3);
  assert.strictEqual((await storeA.listEndpointCorrelationsByOrgLink(String(mapB.id))).length, 0, 'A cannot list B mapping records');
  assert.strictEqual((await storeB.getEndpointCorrelation(String(mapB.id), 'ep-1', 'OFFLINE')).payloadHash, 'provider-b', 'A upsert does not overwrite a colliding provider B ticket');

  await storeA.deleteEndpointCorrelation(String(mapA.id), 'ep-1', 'OFFLINE');
  assert.strictEqual(await storeA.getEndpointCorrelation(String(mapA.id), 'ep-1', 'OFFLINE'), null, 'endpoint delete is scoped and deterministic');
  assert.strictEqual((await storeB.getEndpointCorrelation(String(mapB.id), 'ep-1', 'OFFLINE')).linkedTicketId, '1001', 'A delete cannot remove B correlation');
}

async function runGroupedAdapterTests() {
  const { context, tables } = createInMemoryTicketingDb();
  const mappingStore = createDbMappingStore(context, 'provider-a');
  const mapping = await mappingStore.save({ action1OrgId: 'source-1', action1OrgName: 'Alpha', destinationId: 'dest-1', destinationName: 'Alpha' });
  const store = createDbCorrelationStore(context, 'provider-a');
  assert.strictEqual(await getGroupedCorrelation(context, 'provider-a', mapping.id, 'VULNERABILITY', 'CVE-1'), null, 'missing grouped correlation should return null');

  const created = await store.upsertGroupedCorrelation({ orgLinkId: String(mapping.id), action1OrgId: 'source-1', signalType: 'vulnerability', issueKey: 'CVE-1', linkedTicketId: '3001', payloadHash: 'hash-a' });
  assert.strictEqual(created.identityKey, `${mapping.id}|VULNERABILITY|CVE-1`);
  assert.strictEqual(created.externalTicketRef.id, '3001');
  const updated = await store.upsertGroupedCorrelation({ orgLinkId: String(mapping.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', linkedTicketId: '3001', payloadHash: 'hash-b', linkedTicketStatus: 'Open' });
  assert.strictEqual(tables.get(GROUPED_CORRELATIONS_TABLE).length, 1, 'grouped upsert updates without duplication');
  assert.strictEqual(updated.payloadHash, 'hash-b');

  await store.upsertGroupedCorrelation({ orgLinkId: String(mapping.id), signalType: 'VULNERABILITY', issueKey: 'CVE-2', linkedTicketId: '3002' });
  await store.upsertGroupedCorrelation({ orgLinkId: String(mapping.id), signalType: 'UPDATE', issueKey: 'pkg-1:ver-1', linkedTicketId: '3003' });
  await store.upsertEndpointCorrelation({ orgLinkId: String(mapping.id), endpointId: 'endpoint-1', signalType: 'VULNERABILITY', linkedTicketId: '4001' });
  assert.strictEqual((await store.listCorrelationsByOrgLink(String(mapping.id), { includeGrouped: true })).length, 4, 'endpoint and grouped correlations coexist');
  assert.strictEqual(tables.get(GROUPED_CORRELATIONS_TABLE).some((row) => row.issue_key === 'endpoint-1'), false, 'grouped rows do not use synthetic endpoint IDs');

  await store.deleteGroupedCorrelation(String(mapping.id), 'VULNERABILITY', 'CVE-1');
  assert.strictEqual(await store.getGroupedCorrelation(String(mapping.id), 'VULNERABILITY', 'CVE-1'), null, 'grouped delete is deterministic');
}

function runSafetyTests() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'correlationStore.js'), 'utf8');
  assert(source.includes('context.db'), 'correlation store should use context.db');
  assert.strictEqual(source.includes('node:fs'), false, 'correlation store must not use local files');
  assert.strictEqual(source.includes('sync_history'), false, 'correlation store must not write Marketplace sync_history directly');
}

run().catch((error) => { console.error(error); process.exit(1); });
