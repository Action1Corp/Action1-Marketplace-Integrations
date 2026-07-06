const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Dashboard.jsx'), 'utf8').replace(/\r\n/g, '\n');

  assert(source.includes('<h1 className="page-title" style={styles.title}>Sync</h1>'), 'Dashboard.jsx should render the Sync page title');
  assert(source.includes('Run synchronization, review the latest sync outcome, and manage the Marketplace schedule for this integration.'), 'Dashboard.jsx should render the Jira sync page description');
  assert(source.includes('Sync Status'), 'Dashboard.jsx should render the Sync Status card');
  assert(source.includes('Last completed run'), 'Dashboard.jsx should render the last completed run card');
  assert(source.includes('Totals'), 'Dashboard.jsx should render the totals card');
  assert(source.includes('Scheduler'), 'Dashboard.jsx should render the scheduler card');
  assert(source.includes('Run now'), 'Dashboard.jsx should expose the manual Run now action');
  assert(source.includes('Refresh status'), 'Dashboard.jsx should expose the refresh status action');
  assert(source.includes('Save scheduler settings'), 'Dashboard.jsx should expose the scheduler save action');
  assert(source.includes('Refresh scheduler status'), 'Dashboard.jsx should expose the scheduler refresh action');
  assert(source.includes('Assets processed:'), 'Dashboard.jsx should expose assets processed for the last completed run');
  assert(source.includes('/api/history?integration=${integration}&page=1&pageSize=20'), 'Dashboard.jsx should request Marketplace history for the latest runs');
  assert(source.includes('/api/marketplace/${integration}'), 'Dashboard.jsx should request Marketplace integration metadata');
  assert(source.includes('/api/settings'), 'Dashboard.jsx should request Marketplace settings');
  assert(source.includes('/api/integrations/${integration}/actions/sync'), 'Dashboard.jsx should invoke the tracked sync action');
  assert(source.includes("maxWidth: 820"), 'Dashboard.jsx should use the shared centered max-width shell');
  assert(source.includes("margin: '0 auto'"), 'Dashboard.jsx should center the Sync page like the other Jira pages');
  assert(source.includes("display: 'grid',\n    gap: '0.5rem'"), 'Dashboard.jsx should use the shared Jira page-shell gap convention');
  assert(!source.includes('Action1ApiKey'), 'Dashboard.jsx should not expose Action1 credentials');
  assert(!source.includes('JiraCloudApiToken'), 'Dashboard.jsx should not expose the Jira API token');
  assert(!source.includes('sync_history'), 'Dashboard.jsx should not write sync_history directly');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
