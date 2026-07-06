const assert = require('assert');
const fs = require('fs');
const path = require('path');

const display = require('../display.json');
const manifest = require('../manifest.json');
const settingsSchema = require('../ui/settingsSchema.json');

function readSource(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', 'ui', fileName), 'utf8').replace(/\r\n/g, '\n');
}

function readExportedViews(indexSource) {
  const directMatch = indexSource.match(/export\s+const\s+views\s*=\s*{([\s\S]*?)}/m);
  if (!directMatch) {
    return new Set();
  }

  return new Set(
    Array.from(directMatch[1].matchAll(/['"]?([a-z][a-z0-9-]*)['"]?\s*:/g)).map((match) => match[1])
  );
}

function run() {
  const navigation = Array.isArray(display.navigation) ? display.navigation : [];
  const dashboardRoute = navigation.find((row) => row.path === 'dashboard');

  assert(dashboardRoute, 'display.json should keep the existing dashboard route as the Sync insertion point');
  assert.strictEqual(dashboardRoute.label, 'Sync', 'display.json should expose Sync as the visible navigation label');
  assert.strictEqual(dashboardRoute.path, 'dashboard', 'display.json should preserve the existing dashboard path');

  const syncAction = manifest.actions.find((row) => row.id === 'sync');
  assert(syncAction, 'manifest.json should continue declaring the sync action');
  assert.strictEqual(syncAction.placement, 'dashboard', 'sync should keep the existing dashboard placement for the minimal safe slice');

  const indexSource = readSource('index.jsx');
  const exportedViews = readExportedViews(indexSource);
  for (const item of navigation) {
    assert(exportedViews.has(item.path), `ui/index.jsx should export a view for navigation path ${item.path}`);
  }

  assert(indexSource.includes("import Sync from './Sync.jsx';"), 'ui/index.jsx should import the Sync view');
  assert(indexSource.includes('dashboard: Sync'), 'ui/index.jsx should map the existing dashboard route to the Sync view');
  assert(!indexSource.includes("import Dashboard from './Dashboard.jsx';"), 'ui/index.jsx should stop importing the old Dashboard placeholder');

  const syncSource = readSource('Sync.jsx');
  assert(syncSource.includes('Sync Status'), 'Sync.jsx should render the Sync Status section');
  assert(syncSource.includes('Last completed run'), 'Sync.jsx should render the Last completed run section');
  assert(syncSource.includes('Totals'), 'Sync.jsx should render the Totals section');
  assert(syncSource.includes('Scheduler'), 'Sync.jsx should render the Scheduler section');
  assert(syncSource.includes('Run synchronization, review the latest sync outcome, and manage the Marketplace schedule for this integration.'), 'Sync.jsx should render the updated customer-facing Sync description');
  assert(!syncSource.includes('host scheduler shell'), 'Sync.jsx should not use implementation-oriented host scheduler shell wording');
  assert(syncSource.includes('Run now starts or continues the single active job.'), 'Sync.jsx should render the standalone-style Sync Status copy');
  assert(syncSource.includes('Scheduled sync uses the Marketplace schedule configured below.'), 'Sync.jsx should render the neutral Marketplace scheduler copy');
  assert(!syncSource.includes('Scheduled sync is enabled every 24 hours.'), 'Sync.jsx should not keep the misleading static every-24-hours scheduler copy');
  assert(syncSource.includes('Run now'), 'Sync.jsx should render the Run now action');
  assert(syncSource.includes('Refresh status'), 'Sync.jsx should render the Refresh status action');
  assert(syncSource.includes('Save scheduler settings'), 'Sync.jsx should render the Save scheduler settings action');
  assert(syncSource.includes('Refresh scheduler status'), 'Sync.jsx should render the Refresh scheduler status action');
  assert(syncSource.includes('Scheduled sync:'), 'Sync.jsx should keep the live Scheduled sync status row visible');
  assert(syncSource.includes("maxWidth: 820"), 'Sync.jsx should use the same centered max-width convention as Settings and Client Mapping');
  assert(syncSource.includes("margin: '0 auto'"), 'Sync.jsx should center the page wrapper like Settings and Client Mapping');
  assert(syncSource.includes("display: 'grid',\n    gap: '0.5rem'"), 'Sync.jsx should use the shared page-shell grid spacing convention');
  assert(syncSource.includes("fontSize: '1.5rem'"), 'Sync.jsx should align the page title size with the Marketplace Settings and Client Mapping baseline');
  assert(syncSource.includes("sectionTitle: {\n    margin: 0,\n    fontSize: '1.125rem'"), 'Sync.jsx should align Sync section-heading typography with the Marketplace Settings and Client Mapping baseline');
  assert(syncSource.includes("totalsHeading: {\n    margin: 0,\n    fontSize: '1.125rem'"), 'Sync.jsx should keep Totals aligned with the shared card-heading typography');
  assert(syncSource.includes("fontSize: '1.7rem'"), 'Sync.jsx should keep the Totals numeric values large');
  assert(syncSource.includes("color: '#0B63F6'"), 'Sync.jsx should keep the Totals numeric values blue');
  assert(syncSource.includes("fetch(`/api/history?integration=${integration}&page=1&pageSize=20`)"), 'Sync.jsx should read Marketplace-supported integration history');
  assert(syncSource.includes("fetch('/api/settings')"), 'Sync.jsx should read Marketplace-backed settings for scheduler state');
  assert(syncSource.includes("fetch(`/api/integrations/${integration}/actions/sync`"), 'Sync.jsx should invoke the Marketplace sync action boundary for Run now');
  assert(syncSource.includes('CronSchedule_'), 'Sync.jsx should align scheduler controls with the Marketplace cron settings model');
  assert(syncSource.includes('CronTimezone_'), 'Sync.jsx should align scheduler timezone storage with the Marketplace cron settings model');
  assert(!syncSource.includes('Recent runs'), 'Sync.jsx should not render the standalone Recent runs table');
  assert(!syncSource.includes("label: 'Closed'"), 'Sync.jsx should not expose a Closed total metric');
  assert(!syncSource.includes('/api/lifecycle/run-once'), 'Sync.jsx should not call the standalone lifecycle endpoint');
  assert(!syncSource.includes('/api/scheduler/status'), 'Sync.jsx should not call the standalone scheduler status endpoint');
  assert(!syncSource.includes('/api/scheduler/config'), 'Sync.jsx should not call the standalone scheduler config endpoint');
  assert(!syncSource.includes('sync_history'), 'Sync.jsx should not write or query sync_history directly from the page');

  const action1Keys = settingsSchema
    .map((row) => String(row.key || ''))
    .filter((key) => /^Action1[A-Za-z0-9_]*$/.test(key));
  assert.strictEqual(action1Keys.length, 0, 'HaloPSA settings should continue excluding Action1 credential keys');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
