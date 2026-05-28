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
fs.mkdirSync(path.join(targetDir, 'ui'), { recursive: true });

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
  category: 'Integration',
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
    title: '{integrationName} Dashboard',
    description: 'Operational summary for {integrationName}.',
    cards: [],
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

writeFile('ui/Dashboard.jsx', `
function Dashboard({ integration }) {
  return (
    <div>
      <h1 className="page-title">${displayName} Dashboard</h1>
      <div className="glass-panel">
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Build this screen with React components owned by the ${displayName} integration.
        </p>
      </div>
    </div>
  );
}

export default Dashboard;
`);

writeFile('ui/History.jsx', `
import { useEffect, useState } from 'react';

function History({ integration }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetch(\`/api/history?integration=\${integration}&page=1&pageSize=50\`)
      .then(response => response.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]));
  }, [integration]);

  return (
    <div>
      <h1 className="page-title">Run History</h1>
      <div className="glass-panel">
        {rows.length === 0 ? (
          <div style={{ color: '#6B7280' }}>No runs have been recorded yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Timestamp</th>
                <th>Status</th>
                <th>Items Processed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>#{row.id}</td>
                  <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : ''}</td>
                  <td>{row.status}</td>
                  <td>{Number(row.assets_processed || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default History;
`);

writeFile('ui/Settings.jsx', `
function Settings() {
  return (
    <div>
      <h1 className="page-title">Configuration</h1>
      <div className="glass-panel">
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Add ${displayName} settings controls here. Use Marketplace settings APIs for storage and secret handling.
        </p>
      </div>
    </div>
  );
}

export default Settings;
`);

writeFile('ui/index.jsx', `
import Dashboard from './Dashboard.jsx';
import History from './History.jsx';
import Settings from './Settings.jsx';

export const views = {
  dashboard: Dashboard,
  history: History,
  settings: Settings
};
`);

writeFile('migrations/001_create_schema.sql', `
CREATE TABLE IF NOT EXISTS ${id.replace(/-/g, '_')}_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT '${id}',
  external_id TEXT,
  name TEXT,
  status TEXT,
  raw_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_${id.replace(/-/g, '_')}_items_external_id
  ON ${id.replace(/-/g, '_')}_items(external_id);
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

Visible screens are declared in \`display.json\` navigation and rendered by React views exported from \`ui/index.jsx\`.
Every visible screen must also have a matching integration-owned React view exported from \`ui/index.jsx\`.

## Next Steps

1. Update \`manifest.json\` metadata, settings, category, and Marketplace actions.
2. Implement the integration-owned validation handler if this integration declares the validation action.
3. Implement the integration-owned run handler if this integration declares the run action.
4. Update \`migrations/001_create_schema.sql\` with this integration's private tables.
5. Update \`display.json\` to define the tabs, views, labels, and metrics this integration supports.
6. Update \`ui/index.jsx\` and add React view components for every visible screen.
7. Run \`npm test\` from the repository root.
`);

console.log(`Created integrations/${id}`);
