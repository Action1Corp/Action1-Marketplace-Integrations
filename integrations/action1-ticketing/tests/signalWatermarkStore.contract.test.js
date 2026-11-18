const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');
const { createDbMappingStore } = require('../mappingStore');
const {
  AUTOMATION_FAILED_SIGNAL,
  SIGNAL_WATERMARKS_TABLE,
  createDbSignalWatermarkStore,
  getWatermark,
  upsertWatermark
} = require('../signalWatermarkStore');

async function run() {
  await runGenericWatermarkTests();
  await runAutomationFailedAliasTests();
  runSafetyTests();
  console.log('Action1 Ticketing signal watermark store contract tests passed.');
}

async function runGenericWatermarkTests() {
  const { context, tables } = createInMemoryTicketingDb();
  const mappingA = await createDbMappingStore(context, 'provider-a').save({ action1OrgId: 'org-a', action1OrgName: 'A', destinationId: 'dest-a', destinationName: 'A' });
  const mappingB = await createDbMappingStore(context, 'provider-b').save({ action1OrgId: 'org-b', action1OrgName: 'B', destinationId: 'dest-b', destinationName: 'B' });
  const storeA = createDbSignalWatermarkStore(context, 'provider-a');
  const storeB = createDbSignalWatermarkStore(context, 'provider-b');

  assert.strictEqual(await getWatermark(context, 'provider-a', mappingA.id, 'AUTOMATION_FAILED'), null, 'missing watermark should return null');
  const created = await upsertWatermark(context, 'provider-a', {
    orgLinkId: String(mappingA.id), action1OrgId: 'org-a', signalType: 'AUTOMATION_FAILED',
    watermarkValue: '2026-06-18_12-00-00', watermarkAt: '2026-06-18_12-00-00', metadata: { lastInstanceId: 'instance-1' },
    createdAt: '2026-06-18T12:00:00.000Z', updatedAt: '2026-06-18T12:00:00.000Z'
  });
  assert.strictEqual(created.watermarkValue, '2026-06-18_12-00-00');
  assert.strictEqual(created.metadata.lastInstanceId, 'instance-1');

  const updated = await storeA.upsertWatermark({
    orgLinkId: String(mappingA.id), action1OrgId: 'org-a', signalType: 'AUTOMATION_FAILED',
    watermarkValue: '2026-06-18_13-00-00', watermarkAt: '2026-06-18_13-00-00', metadata: { lastInstanceId: 'instance-2' },
    createdAt: '2026-06-18T12:00:00.000Z', updatedAt: '2026-06-18T13:00:00.000Z'
  });
  assert.strictEqual(tables.get(SIGNAL_WATERMARKS_TABLE).length, 1, 'watermark upsert updates without duplication');
  assert.strictEqual(updated.metadata.lastInstanceId, 'instance-2');

  await storeA.upsertWatermark({ orgLinkId: String(mappingA.id), signalType: 'UPDATE', watermarkValue: 'A-update' });
  await storeB.upsertWatermark({ orgLinkId: String(mappingB.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'B-checkpoint' });
  assert.strictEqual(tables.get(SIGNAL_WATERMARKS_TABLE).length, 3, 'different providers and signals remain distinct');
  assert.strictEqual((await storeA.getWatermark(String(mappingB.id), 'AUTOMATION_FAILED')), null, 'provider A cannot read provider B checkpoint');
  await storeA.upsertWatermark({ orgLinkId: String(mappingA.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'A-advanced' });
  assert.strictEqual((await storeB.getWatermark(String(mappingB.id), 'AUTOMATION_FAILED')).watermarkValue, 'B-checkpoint');

  await storeA.deleteWatermark(String(mappingA.id), 'UPDATE');
  assert.strictEqual(await storeA.getWatermark(String(mappingA.id), 'UPDATE'), null, 'delete is scoped and deterministic');
  assert.strictEqual((await storeB.getWatermark(String(mappingB.id), 'AUTOMATION_FAILED')).watermarkValue, 'B-checkpoint', 'provider A delete cannot alter B checkpoint');
  await assert.rejects(() => storeA.upsertWatermark({ orgLinkId: String(mappingB.id), signalType: 'UPDATE', watermarkValue: 'wrong-owner' }), /mapping.*(not found|provider|owner)/i);
  await assert.rejects(() => storeA.upsertWatermark({ orgLinkId: String(mappingA.id), signalType: 'UPDATE', metadata: { accessToken: 'synthetic-secret' } }), /metadata/i);
}

async function runAutomationFailedAliasTests() {
  const { context, tables } = createInMemoryTicketingDb();
  const mapping = await createDbMappingStore(context, 'provider-a').save({ action1OrgId: 'org-9', action1OrgName: 'Nine', destinationId: 'dest-9', destinationName: 'Nine' });
  const store = createDbSignalWatermarkStore(context, 'provider-a');
  assert.strictEqual(await store.getAutomationFailedWatermark(String(mapping.id)), null, 'missing automation watermark alias should return null');
  await store.upsertAutomationFailedWatermark(String(mapping.id), {
    action1OrgId: 'org-9', lastSeenAt: '2026-06-18_16-00-00', lastInstanceId: 'instance-9', orgLinkId: String(mapping.id)
  });
  const watermark = await store.getAutomationFailedWatermark(String(mapping.id));
  assert.strictEqual(watermark.lastSeenAt, '2026-06-18_16-00-00');
  assert.strictEqual(watermark.lastInstanceId, 'instance-9');
  assert.strictEqual(watermark.action1OrgId, 'org-9');
  assert.strictEqual(tables.get(SIGNAL_WATERMARKS_TABLE)[0].signal_type, AUTOMATION_FAILED_SIGNAL);
}

function runSafetyTests() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'signalWatermarkStore.js'), 'utf8');
  assert(source.includes('context.db'), 'signal watermark store should use context.db');
  assert.strictEqual(source.includes('node:fs'), false, 'signal watermark store must not use local files');
  assert.strictEqual(source.includes('sync_history'), false, 'signal watermark store must not write Marketplace sync_history directly');
}

run().catch((error) => { console.error(error); process.exit(1); });
