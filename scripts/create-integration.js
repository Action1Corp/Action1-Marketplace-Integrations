const fs = require('fs');
const path = require('path');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const rawName = process.argv[2];
const id = slugify(rawName);

if (!id) {
  console.error('Usage: npm run create-integration -- my-integration');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const targetDir = path.join(root, 'integrations', id);

if (fs.existsSync(targetDir)) {
  console.error(`Integration already exists: integrations/${id}`);
  process.exit(1);
}

const displayName = titleCase(id);
const vendorName = displayName;

fs.mkdirSync(targetDir, { recursive: true });
fs.mkdirSync(path.join(targetDir, 'migrations'), { recursive: true });

function writeJson(filename, value) {
  fs.writeFileSync(path.join(targetDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filename, content) {
  fs.writeFileSync(path.join(targetDir, filename), content.trimStart());
}

writeJson('manifest.json', {
  id,
  name: displayName,
  vendor: vendorName,
  version: '1.0.0',
  marketplaceApiVersion: '1.0',
  minimumMarketplaceVersion: '1.0.0',
  description: `Connect ${displayName} to the Action1 Integration Marketplace.`,
  category: 'Vulnerability Management',
  icon_color: '#2E8CEB',
  entry: 'index.js',
  marketplaceActions: ['settings', 'validate', 'sync', 'history', 'schedule'],
  settings: [
    {
      key: `${displayName.replace(/\s+/g, '')}ApiUrl`,
      label: 'API URL',
      type: 'url',
      group: `${displayName} Configuration`,
      required: true
    },
    {
      key: `${displayName.replace(/\s+/g, '')}ApiToken`,
      label: 'API Token',
      type: 'secret',
      group: `${displayName} Configuration`,
      required: true
    }
  ]
});

writeJson('display.json', {
  navigation: [
    { id: 'dashboard', label: 'Dashboard', path: 'dashboard', icon: 'Activity' },
    { id: 'history', label: 'History', path: 'history', icon: 'History', marketplaceAction: 'history' },
    { id: 'settings', label: 'Settings', path: 'settings', icon: 'Settings', marketplaceAction: 'settings', requiresWrite: true }
  ],
  dashboard: {
    component: 'metric-dashboard',
    title: '{integrationName} Dashboard',
    description: 'Operational summary for {integrationName}.',
    kpis: [
      { label: 'TOTAL ENDPOINTS', metric: 'totalEndpoints', color: '#1D8EE6', tone: 'blue' },
      { label: 'TOTAL VULNERABILITIES', metric: 'totalCves', color: '#111827', tone: 'gray' },
      { label: 'PATCHABILITY RATE', metric: 'patchRate', color: '#10b981', tone: 'green' }
    ],
    sections: []
  },
  history: {
    title: 'Run History',
    searchPlaceholder: 'Search history...',
    emptyText: 'No sync history found matching criteria.',
    defaultSort: { key: 'id', direction: 'desc' },
    columns: [
      { key: 'id', label: 'Run ID', type: 'runId' },
      { key: 'timestamp', label: 'Timestamp', type: 'datetime' },
      { key: 'status', label: 'Status', type: 'runStatus' },
      { key: 'assets_processed', label: 'Items Processed', type: 'number' },
      { key: 'actions', label: 'Actions', type: 'historyActions', sortable: false }
    ]
  },
  settings: {
    title: 'Configuration',
    validateButtonLabel: 'Validate Credentials',
    saveButtonLabel: 'Save Settings',
    scheduleTitle: 'Schedule'
  }
});

writeFile('index.js', `
const { validate } = require('./validate');
const { sync } = require('./sync');

module.exports = {
  validate,
  sync
};
`);

writeFile('validate.js', `
async function validate({ settings }) {
  const hasUrl = Object.values(settings || {}).some(value => typeof value === 'string' && value.startsWith('http'));
  const hasToken = Object.values(settings || {}).some(value => typeof value === 'string' && value.length > 12);

  return {
    '${id}': {
      ok: hasUrl && hasToken,
      message: hasUrl && hasToken ? 'Configuration values are present' : 'Missing API URL or token'
    }
  };
}

module.exports = {
  validate
};
`);

writeFile('sync.js', `
const {
  createSyncRun,
  appendSyncLog,
  completeSyncRun,
  failSyncRun
} = require('../../sdk');

async function sync(context) {
  const runId = await createSyncRun(context);
  let details = 'Started sync\\n';

  try {
    details = await appendSyncLog(context, runId, details, 'Add vendor API calls and data writes here.');
    await completeSyncRun(context, runId, details, 0);
  } catch (error) {
    await failSyncRun(context, runId, details, error);
  }
}

module.exports = {
  sync
};
`);

writeFile('migrations/001_create_schema.sql', `
CREATE TABLE IF NOT EXISTS ${id.replace(/-/g, '_')}_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT '${id}',
  run_id INTEGER,
  endpoint_name TEXT,
  ipv4 TEXT,
  mac TEXT,
  os TEXT,
  action1_id TEXT,
  tenable_has_agent BOOLEAN,
  missing_from_tenable BOOLEAN,
  missing_from_action1 BOOLEAN,
  defender_total_vulns INTEGER DEFAULT 0,
  critical_vulns INTEGER DEFAULT 0,
  high_vulns INTEGER DEFAULT 0,
  medium_vulns INTEGER DEFAULT 0,
  low_vulns INTEGER DEFAULT 0,
  action1_critical_vulns INTEGER DEFAULT 0,
  action1_high_vulns INTEGER DEFAULT 0,
  action1_medium_vulns INTEGER DEFAULT 0,
  action1_low_vulns INTEGER DEFAULT 0,
  patchable_vulns INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ${id.replace(/-/g, '_')}_endpoint_cves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT '${id}',
  run_id INTEGER,
  endpoint_name TEXT,
  cve TEXT,
  severity TEXT,
  status TEXT
);

CREATE INDEX IF NOT EXISTS idx_${id.replace(/-/g, '_')}_endpoints_run
  ON ${id.replace(/-/g, '_')}_endpoints(run_id);

CREATE INDEX IF NOT EXISTS idx_${id.replace(/-/g, '_')}_endpoint_cves_run
  ON ${id.replace(/-/g, '_')}_endpoint_cves(run_id);
`);

writeFile('README.md', `
# ${displayName}

This integration was generated with \`npm run create-integration -- ${id}\`.

## Marketplace Actions

- Settings
- Credential validation
- Manual sync
- Run history
- Per-integration scheduling

Views such as dashboards, endpoint lists, and vulnerability tables are defined in \`display.json\`.

## Next Steps

1. Update \`manifest.json\` metadata, settings, category, and Marketplace actions.
2. Implement integration-owned credential checks in \`validate.js\` if this integration declares \`validate\`.
3. Implement integration-owned vendor data collection and Marketplace data writes in \`sync.js\` if this integration declares \`sync\`.
4. Update \`migrations/001_create_schema.sql\` with this integration's private tables.
5. Update \`display.json\` to define the tabs, views, labels, and metrics this integration supports.
6. Run \`npm test\` from the repository root.
`);

console.log(`Created integrations/${id}`);
