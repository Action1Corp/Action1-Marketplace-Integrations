const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'History.jsx'), 'utf8').replace(/\r\n/g, '\n');

  assert(source.includes("import { TIMESTAMP_LABEL, buildHistoryRows, resultTone } from '../historyViewModel.mjs';"), 'History.jsx should use the Entra history view-model helper');
  assert(source.includes('<h1 className="page-title" style={styles.title}>History</h1>'), 'History.jsx should render the compact History page title in the constrained shell');
  assert(source.includes('Review recent Microsoft Entra synchronization runs and Marketplace action results.'), 'History.jsx should render the Entra History description');
  assert(source.includes('Recent runs'), 'History.jsx should render the Recent runs card title');
  assert(source.includes('Refresh'), 'History.jsx should render the Refresh action');
  assert(source.includes('TIMESTAMP_LABEL'), 'History.jsx should source the timestamp column label from the Entra history view model');
  assert(source.includes('RESULT'), 'History.jsx should render the approved RESULT column header');
  assert(source.includes('SYNCED'), 'History.jsx should render the approved SYNCED column header');
  assert(source.includes('SKIPPED'), 'History.jsx should render the approved SKIPPED column header');
  assert(source.includes('FAILED'), 'History.jsx should render the approved FAILED column header');
  assert(source.includes('DETAILS'), 'History.jsx should render the compact DETAILS column header');
  assert(source.includes('Copy details'), 'History.jsx should expose the compact Copy details control');
  assert(source.includes('role="dialog"'), 'History.jsx should render a keyboard-accessible details dialog');
  assert(source.includes('aria-modal="true"'), 'History.jsx should render the details dialog as modal content');
  assert(source.includes('row.detailsLabel === \'View\''), 'History.jsx should render View only when the view model exposes structured diagnostics');
  assert(source.includes("maxWidth: 820"), 'History.jsx should use the constrained centered shell width from the Jira History reference');
  assert(source.includes("margin: '0 auto'"), 'History.jsx should center the Entra History page like the Jira History page');
  assert(source.includes('buildHistoryRows(rows).slice(0, HISTORY_PAGE_SIZE)'), 'History.jsx should cap rendered Entra history rows client-side through the view model');
  assert(source.includes("style={{ ...styles.resultText, ...resultTone(row.result) }}"), 'History.jsx should render result as plain text with optional text color only');
  assert(!source.includes('styles.pill'), 'History.jsx should not render result badges or pill containers');
  assert(!source.includes('Run ID'), 'History.jsx should not render the Run ID column');
  assert(!source.includes('<th style={styles.tableHead}>Action</th>'), 'History.jsx should not render the Action column');
  assert(!source.includes('Trigger'), 'History.jsx should not render the Trigger column');
  assert(!source.includes('Timestamp'), 'History.jsx should not keep the generic Timestamp column label');
  assert(!source.includes('Endpoints synchronized'), 'History.jsx should not keep the long synchronized column header');
  assert(!source.includes('Failed endpoint updates'), 'History.jsx should not keep the long failed column header');
  assert(!source.includes('Organizations'), 'History.jsx should not render an organizations column');
  assert(!source.includes('Entra devices'), 'History.jsx should not render an Entra devices column');
  assert(!source.includes('Action1 endpoints'), 'History.jsx should not render an Action1 endpoints column');
  assert(!source.includes('Items Processed'), 'History.jsx should not keep the generic items-processed column for Entra sync history');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
