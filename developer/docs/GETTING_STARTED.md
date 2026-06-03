# Build Your First Integration

This guide walks through creating, running, and submitting a new Action1 Integration Marketplace package. The examples use a fictional integration ID, `acme-vm`.

## Prerequisites

Before you start, make sure you have:

- Node.js installed locally.
- Access to this integrations repository.
- A local Marketplace container that can mount this repository during development.
- Vendor API credentials for the product you are integrating.

Example local setup:

```bash
git clone https://github.com/Action1Corp/Action1-Marketplace-Integrations.git
cd Action1-Marketplace-Integrations
npm test
```

## 1. Create The Scaffold

From the repository root, create a new package folder:

```bash
npm run create-integration -- acme-vm
```

This creates:

```text
integrations/acme-vm/
  manifest.json
  display.json
  index.js
  actions.js
  ui/
    index.jsx
    settingsSchema.json
    view components
  migrations/
    001_create_schema.sql
  README.md
```

Use lowercase kebab-case for integration IDs. The folder name and `manifest.id` must match:

```json
{
  "id": "acme-vm"
}
```

## 2. Update Metadata

Edit `integrations/acme-vm/manifest.json` so the catalog fields describe the integration.

Example:

```json
{
  "id": "acme-vm",
  "name": "Acme VM",
  "vendor": "Acme Security",
  "version": "1.0.0",
  "marketplaceApiVersion": "1.0",
  "minimumMarketplaceVersion": "1.0.0",
  "description": "Correlates Acme vulnerability findings with Action1 endpoint and patch context.",
  "category": "Vulnerability Management",
  "icon_color": "#2E8CEB",
  "entry": "index.js",
  "actions": []
}
```

Required fields:

- `id`
- `name`
- `vendor`
- `version`
- `marketplaceApiVersion`
- `minimumMarketplaceVersion`
- `description`
- `category`
- `actions`, when the integration exposes integration-owned operations

Do not declare runtime capabilities in the manifest. The Marketplace infers behavior from the files and handlers the integration provides.

Do not redeclare Marketplace-owned Action1 credentials. Use `context.action1.getCredentials()` when the integration needs Action1 API access.

## 3. Define Settings

Settings in `ui/settingsSchema.json` are vendor-specific configuration fields owned by the integration. The integration settings view can import this file to render controls, and the Marketplace backend reads it to protect secret values.

Example:

```json
[
  {
    "key": "AcmeApiBaseUrl",
    "label": "API Base URL",
    "type": "url",
    "group": "Acme Configuration",
    "required": true,
    "defaultValue": "https://api.acme.example"
  },
  {
    "key": "AcmeApiToken",
    "label": "API Token",
    "type": "secret",
    "group": "Acme Configuration",
    "required": true
  }
]
```

Supported types:

- `text`
- `url`
- `secret`
- `select`
- `number`
- `checkbox`

Use `secret` for tokens, passwords, client secrets, private keys, and app passwords.

## 4. Define Screens

Edit `display.json` to declare only the integration-owned navigation shown in the Marketplace sidebar.

Example:

```json
{
  "navigation": [
    { "id": "dashboard", "label": "Dashboard", "path": "dashboard", "icon": "Activity" },
    { "id": "assets", "label": "Assets", "path": "assets", "icon": "Server" },
    { "id": "history", "label": "History", "path": "history", "icon": "History" },
    { "id": "settings", "label": "Settings", "path": "settings", "icon": "Settings", "requiresWrite": true }
  ]
}
```

Every visible screen path must have a matching React view exported from `ui/index.jsx`.

Example:

```jsx
import Dashboard from './Dashboard.jsx';
import Assets from './Assets.jsx';
import History from './History.jsx';
import Settings from './Settings.jsx';

export const views = {
  dashboard: Dashboard,
  assets: Assets,
  history: History,
  settings: Settings
};
```

These are examples, not required screen names. An integration can define any route-safe screen path, such as `asset-risk`, `deployment-status`, or `license-usage`.

Put screen titles, columns, cards, buttons, and empty states in the React views under `ui/`. See `DISPLAY_REFERENCE.md` for the full display contract.

## 5. Define Database Tables

Add integration-owned tables in `migrations/*.sql`. The Marketplace applies these migrations at startup, but the integration owns the schema and table names.

Example `migrations/001_create_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS acme_vm_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'acme-vm',
  run_id INTEGER,
  external_id TEXT NOT NULL,
  hostname TEXT,
  risk_score INTEGER DEFAULT 0,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acme_vm_assets_run
  ON acme_vm_assets(run_id);
```

Define the table names in your integration code so they stay aligned with your migrations:

```js
const assetTable = 'acme_vm_assets';
```

For vulnerability-management integrations, you might also create endpoint and CVE tables:

```text
acme_vm_endpoints
acme_vm_endpoint_cves
```

See `SCHEMA_REFERENCE.md` for schema guidance.

## 6. Declare Actions In The Manifest

Define integration-owned operations in `manifest.json`. Each action needs a stable lowercase kebab-case `id`, customer-facing labels, and an optional `kind` when the Marketplace should treat it as validation or sync.

Example `manifest.json` actions:

```json
{
  "actions": [
    {
      "id": "validate-configuration",
      "kind": "validate",
      "label": "Validate Configuration",
      "buttonLabel": "Validate",
      "runningLabel": "Validating...",
      "description": "Checks the Acme API settings.",
      "placement": "settings",
      "history": false
    },
    {
      "id": "sync",
      "kind": "sync",
      "label": "Sync",
      "buttonLabel": "Run Sync",
      "runningLabel": "Syncing...",
      "description": "Collects Acme data and writes integration-owned tables.",
      "placement": "dashboard"
    }
  ]
}
```

Use `kind: "validate"` for configuration checks. Use `kind: "sync"` for manual or scheduled collection jobs.

Actions are tracked in Marketplace history by default and can be monitored for failure notifications. Set `history: false` only when an action should not appear in run history.

## 7. Implement Action Handlers

Export action handlers with IDs that exactly match the manifest actions. The entrypoint defaults to `index.js`.

Example `index.js`:

```js
const { actions } = require('./actions');

module.exports = {
  actions
};
```

Example `actions.js`:

```js
const assetTable = 'acme_vm_assets';

async function validateConfiguration(context, request) {
  const settings = request.settings || {};
  const apiBaseUrl = settings.AcmeApiBaseUrl || await context.settings.get('AcmeApiBaseUrl');
  const apiToken = settings.AcmeApiToken || await context.settings.get('AcmeApiToken');

  return {
    ok: Boolean(apiBaseUrl && apiToken),
    message: apiBaseUrl && apiToken
      ? 'Configuration is valid.'
      : 'API Base URL and API Token are required.'
  };
}

async function sync(context, request) {
  await request.run?.appendLog('Collecting Acme assets.');

  const runId = request.run?.id || null;
  await context.db.run(
    `INSERT INTO ${assetTable} (integration_id, run_id, external_id, hostname, risk_score)
     VALUES (?, ?, ?, ?, ?)`,
    [context.integrationId, runId, 'asset-001', 'example-host', 42]
  );

  await request.run?.setAssetsProcessed(1);
  return { ok: true, message: 'Sync completed.', assetsProcessed: 1 };
}

module.exports = {
  actions: {
    'validate-configuration': validateConfiguration,
    sync
  }
};
```

Handler code receives `context` for Marketplace runtime services and `request.run` helpers for tracked action logs and counts.

## 8. Wire Validation, Manual Runs, And Schedules

Use manifest actions for validation, manual operations, and scheduled jobs.

Example settings screen button:

```jsx
async function validate() {
  const response = await fetch('/api/integrations/acme-vm/actions/validate-configuration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: formValues })
  });
  const result = await response.json();
  setValidation(result);
}
```

Example dashboard button:

```jsx
async function runSync() {
  await fetch('/api/integrations/acme-vm/actions/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}
```

Schedules dispatch to the manifest action with `kind: "sync"`. The Marketplace sends failure notifications automatically for failed tracked actions, manual run actions, and scheduled sync actions.

## 9. Test Locally

Run repository validation:

```bash
npm test
```

Mount the integrations repository into a Marketplace development container, then open the local Marketplace app.

Example checks:

- Enable `Acme VM` in the catalog.
- Save settings.
- Click the validation action and confirm it returns success or a clear failure.
- Click the sync action and confirm a row appears in History.
- Open each screen declared in `display.json`.

See `LOCAL_TESTING.md` for the full local testing workflow.

## 10. Submit For Review

Before opening a pull request:

```bash
npm test
```

Review the package with `REVIEW_CHECKLIST.md`.

Example PR checklist:

- `manifest.json` metadata is customer-readable.
- Each manifest action has a matching exported handler.
- Settings, migrations, and React views are integration-owned.
- Logs and README content do not contain secrets or customer data.
