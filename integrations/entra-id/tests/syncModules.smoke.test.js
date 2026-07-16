const assert = require('assert');
const fs = require('fs');
const path = require('path');
const display = require('../display.json');
const manifest = require('../manifest.json');

function run() {
  const uiIndexSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.jsx'), 'utf8');
  const dashboardRoute = display.navigation.find((route) => route.path === 'dashboard');
  const historyRoute = display.navigation.find((route) => route.path === 'history');
  const syncAction = manifest.actions.find((action) => action.id === 'sync');

  assert(dashboardRoute, 'display.json should keep the dashboard route');
  assert.strictEqual(dashboardRoute.label, 'Sync', 'display.json should relabel the dashboard route to Sync');
  assert(historyRoute, 'display.json should keep the history route');
  assert(uiIndexSource.includes('dashboard: Dashboard'), 'ui/index.jsx should continue exporting the dashboard view');
  assert(uiIndexSource.includes('history: History'), 'ui/index.jsx should continue exporting the history view');
  assert(uiIndexSource.includes('mapping: Mapping'), 'ui/index.jsx should continue exporting the mapping view');
  assert(uiIndexSource.includes('settings: Settings'), 'ui/index.jsx should continue exporting the settings view');
  assert(syncAction, 'manifest.json should declare the sync action');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
