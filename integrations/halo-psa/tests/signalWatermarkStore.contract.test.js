const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  AUTOMATION_FAILED_SIGNAL,
  SIGNAL_WATERMARKS_TABLE,
  createDbSignalWatermarkStore,
  getWatermark,
  upsertWatermark
} = require('../signalWatermarkStore');

function createContext() {
  const state = {
    watermarks: [],
    nextId: 1
  };

  function cloneRow(row) {
    return row ? { ...row } : row;
  }

  return {
    __state: state,
    db: {
      async get(sql, params = []) {
        if (sql.includes(`FROM ${SIGNAL_WATERMARKS_TABLE}`)) {
          const row = state.watermarks.find(
            (item) => item.org_link_id === params[0] && item.signal_type === params[1]
          );
          return cloneRow(row) || null;
        }

        throw new Error(`Unexpected get() SQL: ${sql}`);
      },
      async run(sql, params = []) {
        if (sql.startsWith(`INSERT INTO ${SIGNAL_WATERMARKS_TABLE}`)) {
          state.watermarks.push({
            id: state.nextId++,
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

        if (sql.startsWith(`UPDATE ${SIGNAL_WATERMARKS_TABLE}`)) {
          const row = state.watermarks.find(
            (item) => item.org_link_id === params[7] && item.signal_type === params[8]
          );
          if (!row) throw new Error('watermark row not found for update');
          row.integration_id = params[0];
          row.action1_org_id = params[1];
          row.watermark_value = params[2];
          row.watermark_at = params[3];
          row.metadata_json = params[4];
          row.created_at = params[5];
          row.updated_at = params[6];
          return;
        }

        if (sql.startsWith(`DELETE FROM ${SIGNAL_WATERMARKS_TABLE}`)) {
          state.watermarks = state.watermarks.filter(
            (item) => !(item.org_link_id === params[0] && item.signal_type === params[1])
          );
          return;
        }

        throw new Error(`Unexpected run() SQL: ${sql}`);
      }
    }
  };
}

async function run() {
  await runGenericWatermarkTests();
  await runAutomationFailedAliasTests();
  runSafetyTests();
}

async function runGenericWatermarkTests() {
  const context = createContext();
  const store = createDbSignalWatermarkStore(context);

  assert.strictEqual(await getWatermark(context, 'org-1', 'AUTOMATION_FAILED'), null, 'missing watermark should return null');

  const created = await upsertWatermark(context, {
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'AUTOMATION_FAILED',
    watermarkValue: '2026-06-18_12-00-00',
    watermarkAt: '2026-06-18_12-00-00',
    metadata: {
      lastInstanceId: 'instance-1'
    },
    createdAt: '2026-06-18T12:00:00.000Z',
    updatedAt: '2026-06-18T12:00:00.000Z'
  });

  assert.strictEqual(created.watermarkValue, '2026-06-18_12-00-00');
  assert.strictEqual(created.metadata.lastInstanceId, 'instance-1');

  const updated = await store.upsertWatermark({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'AUTOMATION_FAILED',
    watermarkValue: '2026-06-18_13-00-00',
    watermarkAt: '2026-06-18_13-00-00',
    metadata: {
      lastInstanceId: 'instance-2'
    },
    createdAt: '2026-06-18T12:00:00.000Z',
    updatedAt: '2026-06-18T13:00:00.000Z'
  });

  assert.strictEqual(context.__state.watermarks.length, 1, 'watermark upsert should update existing row without duplicates');
  assert.strictEqual(updated.metadata.lastInstanceId, 'instance-2');

  await store.upsertWatermark({
    orgLinkId: 'org-1',
    action1OrgId: 'a1-org-1',
    signalType: 'UPDATE',
    watermarkValue: '2026-06-18_14-00-00'
  });
  await store.upsertWatermark({
    orgLinkId: 'org-2',
    action1OrgId: 'a1-org-2',
    signalType: 'AUTOMATION_FAILED',
    watermarkValue: '2026-06-18_15-00-00'
  });

  assert.strictEqual(context.__state.watermarks.length, 3, 'different orgs or signals should not collide');

  await store.deleteWatermark('org-1', 'UPDATE');
  assert.strictEqual(await store.getWatermark('org-1', 'UPDATE'), null, 'deleted watermark should be absent');
}

async function runAutomationFailedAliasTests() {
  const context = createContext();
  const store = createDbSignalWatermarkStore(context);

  assert.strictEqual(await store.getAutomationFailedWatermark('org-9'), null, 'missing automation watermark alias should return null');

  await store.upsertAutomationFailedWatermark('org-9', {
    action1OrgId: 'a1-org-9',
    lastSeenAt: '2026-06-18_16-00-00',
    lastInstanceId: 'instance-9',
    orgLinkId: 'org-9'
  });

  const watermark = await store.getAutomationFailedWatermark('org-9');
  assert.strictEqual(watermark.lastSeenAt, '2026-06-18_16-00-00');
  assert.strictEqual(watermark.lastInstanceId, 'instance-9');
  assert.strictEqual(watermark.action1OrgId, 'a1-org-9');
  assert.strictEqual(context.__state.watermarks[0].signal_type, AUTOMATION_FAILED_SIGNAL, 'automation watermark alias should persist AUTOMATION_FAILED signal type');
}

function runSafetyTests() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'signalWatermarkStore.js'), 'utf8');
  assert(source.includes('context.db'), 'signal watermark store should use context.db');
  assert.strictEqual(source.includes('node:fs'), false, 'signal watermark store must not use local files');
  assert.strictEqual(source.includes('sync_history'), false, 'signal watermark store must not write Marketplace sync_history directly');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
