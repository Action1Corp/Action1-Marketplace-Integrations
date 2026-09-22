const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadControlPackArtifacts } = require('../controlPackResolver');
const actions = require('../actions').actions;
const { listPoliciesAction } = require('../policyActions');
const { getOverview } = require('../overviewService');
const { loadControlPackFixture } = require('./controlPackFixture');

function context(logs) {
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) logger[level] = async (message) => logs.push({ level, message });
  return { action1ConfigurationManagerRuntimeLogger: logger, logger, db: {}, integrationId: 'action1-configuration-manager' };
}

async function run() {
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'policies', 'PolicyPage.jsx'), 'utf8');
  assert(pageSource.includes('catalogError'));
  assert(!pageSource.includes('loadingPolicies || loadingCatalog || !catalog ?'));
  const actionsSource = fs.readFileSync(path.join(__dirname, '..', 'actions.js'), 'utf8');
  assert(actionsSource.includes('Control Pack action failed'));
  const logs = [];
  const fixture = loadControlPackFixture();
  const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a1cm-observability-pack-'));
  const releaseRoot = path.join(packRoot, fixture.packVersion);
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.writeFileSync(path.join(releaseRoot, 'pack.json'), JSON.stringify({ packId: fixture.packId, packVersion: fixture.packVersion }));
  fs.writeFileSync(path.join(releaseRoot, 'control-catalog.json'), JSON.stringify(fixture.catalog));
  fs.writeFileSync(path.join(releaseRoot, 'baselines.json'), JSON.stringify({ baselines: fixture.baselines }));
  const loaded = loadControlPackArtifacts({ context: context(logs), packRoot });
  assert(loaded.catalog.controls.length > 0);
  assert.strictEqual(logs.filter((entry) => entry.message.includes('Control Pack loaded')).length, 1);
  assert(logs.some((entry) => entry.message.includes('version=')));

  const failedLogs = [];
  assert.throws(() => loadControlPackArtifacts({ packRoot: path.join(__dirname, 'missing-pack-root'), context: context(failedLogs) }));
  assert(failedLogs.some((entry) => entry.level === 'error' && entry.message.includes('Control Pack load failed') && entry.message.includes('stage=discovery')));

  const actionLogs = [];
  await actions['get-control-pack'](context(actionLogs));
  assert(actionLogs.some((entry) => entry.message.includes('Control Pack action started')));
  assert(actionLogs.some((entry) => entry.message.includes('Control Pack action completed')));

  const policyLogs = [];
  const policyContext = context(policyLogs);
  policyContext.db = { all: async () => { throw new Error('policy read failed'); } };
  await assert.rejects(() => listPoliciesAction(policyContext), /policy read failed/);
  assert(policyLogs.some((entry) => entry.level === 'error' && entry.message.includes('Policies load failed')));

  const dashboardLogs = [];
  await assert.rejects(() => getOverview(context(dashboardLogs), {
    policyStore: { async listPolicies() { throw new Error('early dashboard failure'); } }
  }), /early dashboard failure/);
  assert(dashboardLogs.some((entry) => entry.message.includes('Dashboard load started')));
  assert(dashboardLogs.some((entry) => entry.level === 'error' && entry.message.includes('Dashboard load failed')));
  fs.rmSync(packRoot, { recursive: true, force: true });
}

run().catch((error) => { console.error(error); process.exit(1); });
