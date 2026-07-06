const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const display = require('../display.json');

function readSource(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', 'ui', fileName), 'utf8').replace(/\r\n/g, '\n');
}

async function run() {
  const navigation = Array.isArray(display.navigation) ? display.navigation : [];
  const historyRoute = navigation.find((row) => row.path === 'history');
  assert(historyRoute, 'display.json should declare the History route');
  assert.strictEqual(historyRoute.label, 'History', 'display.json should expose History as the visible navigation label');

  const indexSource = readSource('index.jsx');
  assert(indexSource.includes("import History from './History.jsx';"), 'ui/index.jsx should import the History view');
  assert(indexSource.includes('history: History'), 'ui/index.jsx should export the History view for the history route');

  const historySource = readSource('History.jsx');
  assert(historySource.includes("import { buildHistoryRows } from '../historyViewModel.mjs';"), 'History.jsx should use the browser-safe named ESM history helper import');
  assert(historySource.includes('<h1 className="page-title" style={styles.title}>History</h1>'), 'History.jsx should render the History page title');
  assert(historySource.includes('Review recent HaloPSA synchronization runs and Marketplace action results.'), 'History.jsx should render the requested page description');
  assert(historySource.includes('Recent runs'), 'History.jsx should render the Recent runs card title');
  assert(historySource.includes('Showing latest 30 runs'), 'History.jsx should explain the latest-30-runs limit');
  assert(historySource.includes('Refresh'), 'History.jsx should render a Refresh action');
  assert(historySource.includes('Started'), 'History.jsx should render the Started column');
  assert(historySource.includes('Result'), 'History.jsx should render the Result column');
  assert(historySource.includes('Created'), 'History.jsx should render the Created column');
  assert(historySource.includes('Updated'), 'History.jsx should render the Updated column');
  assert(historySource.includes('Skipped'), 'History.jsx should render the Skipped column');
  assert(historySource.includes('Failed'), 'History.jsx should render the Failed column');
  assert(historySource.includes('No HaloPSA runs have been recorded yet.'), 'History.jsx should render a HaloPSA-specific empty state');
  assert(historySource.includes('const HISTORY_PAGE_SIZE = 30;'), 'History.jsx should keep the HaloPSA History limit in one local constant');
  assert(historySource.includes("fetch(`/api/history?integration=${integration}&page=1&pageSize=${HISTORY_PAGE_SIZE}`)"), 'History.jsx should request Marketplace history scoped by integration with pageSize=30');
  assert(historySource.includes('buildHistoryRows(rows).slice(0, HISTORY_PAGE_SIZE)'), 'History.jsx should also cap rendered rows client-side as a safe fallback');
  assert(historySource.includes("maxWidth: 820"), 'History.jsx should use the same centered max-width shell as the other HaloPSA pages');
  assert(historySource.includes("margin: '0 auto'"), 'History.jsx should center the History page like Settings, Mapping, and Sync');
  assert(historySource.includes("display: 'grid',\n    gap: '0.5rem'"), 'History.jsx should use the shared HaloPSA page-shell gap convention');
  assert(historySource.includes("fontSize: '1.125rem'"), 'History.jsx should use the shared card-heading typography baseline');
  assert(!historySource.includes('sync_history'), 'History.jsx should not query or write sync_history directly');
  assert(!historySource.includes('lifecycle audit'), 'History.jsx should not expose standalone lifecycle audit terminology');
  assert(!historySource.includes('/api/scheduler/status'), 'History.jsx should not call standalone scheduler endpoints');
  assert(!historySource.includes('/api/lifecycle/run-once'), 'History.jsx should not call standalone lifecycle endpoints');
  assert(!historySource.includes('Recent runs</h2>') || historySource.includes('Recent runs'), 'History.jsx should keep the Recent runs card on History, not Sync');

  const historyViewModel = await import(pathToFileURL(path.join(__dirname, '..', 'historyViewModel.mjs')).href);

  const mockedRows = historyViewModel.buildHistoryRows([
    {
      id: 101,
      timestamp: '2026-06-18T10:15:00.000Z',
      status: 'completed',
      action_id: 'sync',
      action_label: 'Sync',
      details: JSON.stringify({
        summary: {
          created: 4,
          updated: 3,
          skipped: 2,
          failed: 1
        }
      }),
      assets_processed: 10
    },
    {
      id: 102,
      timestamp: '2026-06-18T12:30:00.000Z',
      status: 'failed',
      details: 'created: 1\nupdated: 0\nskipped: 5\nfailed: 2'
    },
    {
      id: 103,
      timestamp: '2026-06-18T14:00:00.000Z',
      status: 'success',
      details: {
        summary: {
          created: 6,
          updated: 5,
          skipped: 4,
          failed: 3
        }
      }
    },
    {
      id: 104,
      timestamp: '2026-06-18T15:00:00.000Z',
      status: 'success',
      details: [
        '10:00:00 - [INFO] intermediate created: 1',
        '10:00:01 - [INFO] intermediate updated: 2',
        '10:00:02 - [INFO] intermediate skipped: 3',
        '10:00:03 - [INFO] intermediate failed: 4',
        'HALO_PSA_SYNC_SUMMARY_BEGIN',
        'candidatesSeen: 25',
        'created: 6',
        'updated: 5',
        'skipped: 8',
        'failed: 1',
        'HALO_PSA_SYNC_SUMMARY_END'
      ].join('\n')
    }
  ]);

  assert.strictEqual(mockedRows.length, 4, 'history view model should keep mocked Marketplace rows');
  assert.strictEqual(mockedRows[0].result, 'Completed', 'history view model should normalize successful run status');
  assert.strictEqual(mockedRows[0].created, 4, 'history view model should parse created count from structured summary details');
  assert.strictEqual(mockedRows[0].updated, 3, 'history view model should parse updated count from structured summary details');
  assert.strictEqual(mockedRows[0].skipped, 2, 'history view model should parse skipped count from structured summary details');
  assert.strictEqual(mockedRows[0].failed, 1, 'history view model should parse failed count from structured summary details');
  assert.strictEqual(mockedRows[1].result, 'Failed', 'history view model should normalize failed run status');
  assert.strictEqual(mockedRows[1].created, 1, 'history view model should parse created count from safe text details when JSON is unavailable');
  assert.strictEqual(mockedRows[1].failed, 2, 'history view model should parse failed count from safe text details when JSON is unavailable');
  assert.strictEqual(mockedRows[2].created, 6, 'history view model should parse created count when the host returns object details');
  assert.strictEqual(mockedRows[2].updated, 5, 'history view model should parse updated count when the host returns object details');
  assert.strictEqual(mockedRows[2].details.includes('"summary"'), true, 'history view model should keep object details renderable as JSON text');
  assert.strictEqual(mockedRows[3].created, 6, 'history view model should parse created count from the explicit HaloPSA summary block');
  assert.strictEqual(mockedRows[3].updated, 5, 'history view model should parse updated count from the explicit HaloPSA summary block');
  assert.strictEqual(mockedRows[3].skipped, 8, 'history view model should ignore earlier skipped-looking log text when a summary block is present');
  assert.strictEqual(mockedRows[3].failed, 1, 'history view model should ignore earlier failed-looking log text when a summary block is present');
  assert.strictEqual(historyViewModel.buildHistoryRows([]).length, 0, 'history view model should keep the empty state representable');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
