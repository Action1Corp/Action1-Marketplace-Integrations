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
  capabilities: ['settings', 'validate', 'sync', 'dashboard', 'history', 'schedule'],
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
    { id: 'dashboard', label: 'Dashboard', path: 'dashboard', icon: 'Activity', capability: 'dashboard' },
    { id: 'history', label: 'History', path: 'history', icon: 'History', capability: 'history' },
    { id: 'settings', label: 'Settings', path: 'settings', icon: 'Settings', capability: 'settings', requiresWrite: true }
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
CREATE TABLE IF NOT EXISTS ${id.replace(/-/g, '_')}_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  name TEXT,
  raw_json TEXT,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_${id.replace(/-/g, '_')}_items_external_id
  ON ${id.replace(/-/g, '_')}_items(external_id);
`);

writeFile('README.md', `
# ${displayName}

This integration was generated with \`npm run create-integration -- ${id}\`.

## Capabilities

- Settings
- Credential validation
- Manual sync
- Dashboard
- Run history
- Per-integration scheduling

## Next Steps

1. Update \`manifest.json\` metadata, settings, category, and capabilities.
2. Implement real credential checks in \`validate.js\`.
3. Implement vendor data collection and Marketplace data writes in \`sync.js\`.
4. Update \`migrations/001_create_schema.sql\` with this integration's private tables.
5. Update \`display.json\` to match the tabs and metrics this integration supports.
6. Run \`npm test\` from the repository root.
`);

console.log(`Created integrations/${id}`);
