const assert = require('assert');
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');
const { createDbMappingStore } = require('../mappingStore');
const { createDbCorrelationStore } = require('../correlationStore');
const { createDbSignalWatermarkStore } = require('../signalWatermarkStore');
const { buildRuntimeConfig } = require('../runtimeConfig');

async function run() {
  const { context, tables } = createInMemoryTicketingDb();
  const mapA = createDbMappingStore(context, 'provider-a');
  const mapB = createDbMappingStore(context, 'provider-b');
  const endpointA = createDbCorrelationStore(context, 'provider-a');
  const endpointB = createDbCorrelationStore(context, 'provider-b');
  const watermarkA = createDbSignalWatermarkStore(context, 'provider-a');
  const watermarkB = createDbSignalWatermarkStore(context, 'provider-b');

  const rowA = await mapA.save({ action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: 'dest-1', destinationName: 'Acme PSA' });
  const rowB = await mapB.save({ action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: 'dest-1', destinationName: 'Acme PSA', providerId: 'provider-a' });
  assert.notStrictEqual(rowA.id, rowB.id);
  assert.strictEqual(rowB.providerId, 'provider-b', 'caller-supplied provider identity is ignored');
  assert.strictEqual((await mapA.list()).length, 1);
  assert.strictEqual(await mapA.getById(rowB.id), null, 'mapping IDs are provider-owned');
  assert.strictEqual((await mapA.delete(rowB.id)).deleted, false, 'provider A cannot delete provider B mapping');

  await endpointA.upsertEndpointCorrelation({ orgLinkId: String(rowA.id), endpointId: 'ep-1', signalType: 'OFFLINE', linkedTicketId: 'ticket-1', externalTicketRef: { id: 'ticket-1', displayId: 'A-1' }, payloadHash: 'hash-a' });
  await endpointB.upsertEndpointCorrelation({ orgLinkId: String(rowB.id), endpointId: 'ep-1', signalType: 'OFFLINE', linkedTicketId: 'ticket-1', externalTicketRef: { id: 'ticket-1', displayId: 'B-1' }, payloadHash: 'hash-b' });
  await endpointA.upsertGroupedCorrelation({ orgLinkId: String(rowA.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', linkedTicketId: 'group-1', externalTicketRef: { id: 'group-1' }, payloadHash: 'group-a' });
  await endpointB.upsertGroupedCorrelation({ orgLinkId: String(rowB.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', linkedTicketId: 'group-1', externalTicketRef: { id: 'group-1' }, payloadHash: 'group-b' });
  await watermarkA.upsertWatermark({ orgLinkId: String(rowA.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'A-checkpoint' });
  await watermarkB.upsertWatermark({ orgLinkId: String(rowB.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'B-checkpoint' });

  const sourceRenamedA = await mapA.save({
    id: rowA.id,
    action1OrgId: 'org-1',
    action1OrgName: 'Acme Renamed',
    destinationId: 'dest-1',
    destinationName: 'Acme PSA'
  });
  assert.strictEqual(sourceRenamedA.id, rowA.id, 'source label changes must preserve the relationship row ID');
  const destinationRenamedA = await mapA.save({
    id: rowA.id,
    action1OrgId: 'org-1',
    action1OrgName: 'Acme Renamed',
    destinationId: 'dest-1',
    destinationName: 'Acme PSA Renamed'
  });
  assert.strictEqual(destinationRenamedA.id, rowA.id, 'destination label changes must preserve the relationship row ID');
  assert.strictEqual(destinationRenamedA.action1OrgName, 'Acme Renamed');
  assert.strictEqual(destinationRenamedA.destinationName, 'Acme PSA Renamed');
  assert.strictEqual((await endpointA.getEndpointCorrelation(String(rowA.id), 'ep-1', 'OFFLINE')).linkedTicketId, 'ticket-1');
  assert.strictEqual((await endpointA.getGroupedCorrelation(String(rowA.id), 'VULNERABILITY', 'CVE-1')).linkedTicketId, 'group-1');
  assert.strictEqual((await watermarkA.getWatermark(String(rowA.id), 'AUTOMATION_FAILED')).watermarkValue, 'A-checkpoint');
  await assert.rejects(() => mapA.save({
    id: rowA.id,
    action1OrgId: 'org-1',
    action1OrgName: 'Acme Renamed',
    destinationId: 'dest-replaced',
    destinationName: 'Replacement'
  }), /relationship identity cannot be changed/i, 'existing row identity must be immutable');
  await assert.rejects(() => mapA.save({
    id: rowA.id,
    action1OrgId: 'org-replaced',
    action1OrgName: 'Replacement',
    destinationId: 'dest-1',
    destinationName: 'Acme PSA Renamed'
  }), /relationship identity cannot be changed/i, 'source organization identity must be immutable too');
  assert.strictEqual((await mapA.getById(rowA.id)).destinationId, 'dest-1', 'rejected identity mutation must not change the row');

  assert.strictEqual((await endpointA.listEndpointCorrelationsByOrgLink(String(rowA.id))).length, 1);
  assert.strictEqual((await endpointA.listEndpointCorrelationsByOrgLink(String(rowB.id))).length, 0);
  assert.strictEqual((await endpointA.listCorrelationsByOrgLink(String(rowA.id), { includeGrouped: true })).length, 2);
  assert.strictEqual((await endpointB.listCorrelationsByOrgLink(String(rowB.id), { includeGrouped: true })).length, 2);
  assert.strictEqual((await endpointA.getGroupedCorrelation(String(rowA.id), 'VULNERABILITY', 'CVE-1')).externalTicketRef.id, 'group-1');
  await endpointA.upsertGroupedCorrelation({ orgLinkId: String(rowA.id), signalType: 'VULNERABILITY', issueKey: 'CVE-2', linkedTicketId: 'shared-group', payloadHash: 'A-only' });
  await endpointB.upsertGroupedCorrelation({ orgLinkId: String(rowB.id), signalType: 'VULNERABILITY', issueKey: 'CVE-2', linkedTicketId: 'shared-group', payloadHash: 'B-only' });
  await endpointA.deleteGroupedCorrelation(String(rowA.id), 'VULNERABILITY', 'CVE-2');
  assert.strictEqual(await endpointA.getGroupedCorrelation(String(rowA.id), 'VULNERABILITY', 'CVE-2'), null, 'provider A can delete its own grouped correlation');
  assert.strictEqual((await endpointB.getGroupedCorrelation(String(rowB.id), 'VULNERABILITY', 'CVE-2')).payloadHash, 'B-only', 'provider A cannot delete provider B grouped correlation');
  await endpointA.upsertGroupedCorrelation({ orgLinkId: String(rowA.id), signalType: 'VULNERABILITY', issueKey: 'CVE-2', linkedTicketId: 'shared-group', payloadHash: 'A-only' });
  assert.strictEqual((await watermarkA.getWatermark(String(rowB.id), 'AUTOMATION_FAILED')), null);

  await endpointA.upsertEndpointCorrelation({ orgLinkId: String(rowA.id), endpointId: 'ep-1', signalType: 'OFFLINE', linkedTicketId: 'ticket-2', externalTicketRef: { id: 'ticket-2', url: 'https://tickets.example.test/2' }, payloadHash: 'hash-a2' });
  await watermarkA.upsertWatermark({ orgLinkId: String(rowA.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'A-advanced' });
  const providerBEndpoint = await endpointB.getEndpointCorrelation(String(rowB.id), 'ep-1', 'OFFLINE');
  assert(providerBEndpoint, `provider B endpoint should remain present: ${JSON.stringify(tables.get('action1_ticketing_endpoint_correlations'))}`);
  assert.strictEqual(providerBEndpoint.externalTicketRef.displayId, 'B-1');
  assert.strictEqual((await watermarkB.getWatermark(String(rowB.id), 'AUTOMATION_FAILED')).watermarkValue, 'B-checkpoint');

  const mapId = String(rowA.id);
  const deleted = await mapA.delete(rowA.id);
  assert.strictEqual(deleted.deleted, true, 'mapping deletion remains allowed with tracking rows present');
  assert.strictEqual(await mapA.getById(rowA.id), null, 'deleted mapping is excluded from normal mapping lookup');
  assert.strictEqual((await mapA.list()).length, 0, 'deleted mapping is excluded from subsequent runtime mapping lists');
  assert.strictEqual(buildRuntimeConfig({ mappings: await mapA.list() }).orgClientMappings.length, 0, 'a later normal runtime configuration cannot route through the deleted mapping');
  assert.strictEqual((await endpointA.getEndpointCorrelation(mapId, 'ep-1', 'OFFLINE')).linkedTicketId, 'ticket-2', 'endpoint history stays under its old mapping ID');
  assert.strictEqual((await endpointA.getGroupedCorrelation(mapId, 'VULNERABILITY', 'CVE-1')).linkedTicketId, 'group-1', 'grouped history remains after mapping deletion');
  assert.strictEqual((await watermarkA.getWatermark(mapId, 'AUTOMATION_FAILED')).watermarkValue, 'A-advanced', 'watermark remains after mapping deletion');
  await assert.rejects(() => endpointA.upsertEndpointCorrelation({ orgLinkId: mapId, endpointId: 'ep-2', signalType: 'OFFLINE', linkedTicketId: 'ticket-3' }), /mapping.*(not found|provider|owner)/i, 'orphaned mapping IDs cannot receive new tracking writes');

  const recreated = await mapA.save({ action1OrgId: 'org-1', action1OrgName: 'Acme Renamed', destinationId: 'dest-1', destinationName: 'Acme PSA Renamed' });
  assert.notStrictEqual(recreated.id, rowA.id, 'recreated relationship receives a new internal mapping ID');
  assert.strictEqual(await endpointA.getEndpointCorrelation(String(recreated.id), 'ep-1', 'OFFLINE'), null, 'new mapping does not inherit endpoint tracking');
  assert.strictEqual(await endpointA.getGroupedCorrelation(String(recreated.id), 'VULNERABILITY', 'CVE-1'), null, 'new mapping does not inherit grouped tracking');
  assert.strictEqual(await watermarkA.getWatermark(String(recreated.id), 'AUTOMATION_FAILED'), null, 'new mapping does not inherit watermarks');

  assert.strictEqual(tables.get('action1_ticketing_endpoint_correlations').length, 2, 'mapping deletion does not remove endpoint rows');
  assert.strictEqual(tables.get('action1_ticketing_grouped_correlations').length, 4, 'mapping deletion does not remove grouped rows');
  assert.strictEqual(tables.get('action1_ticketing_signal_watermarks').length, 2, 'mapping deletion does not remove watermarks');

  const stateCalls = context.db.calls.filter((call) => /action1_ticketing_(?:endpoint_correlations|grouped_correlations|signal_watermarks)/.test(call.sql));
  assert(stateCalls.every((call) => /provider_id\s*=\s*\?/i.test(call.sql) || /provider_id/.test(call.sql)), 'all tracking queries carry provider ownership');
  assert(stateCalls.every((call) => !/\b(?:DELETE|UPDATE)\s+action1_ticketing_(?:endpoint_correlations|grouped_correlations|signal_watermarks)/i.test(call.sql) || call.params.includes('provider-a') || call.params.includes('provider-b')), 'tracking mutations include provider-scoped parameters');

  console.log('Action1 Ticketing provider persistence isolation tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
