# Marketplace Integration API

Current API version: `1.0`

The Action1 Integration Marketplace loads integrations as folder-based packages. Each package declares its metadata, settings, optional Marketplace actions, visible screens, database schema, and runtime handlers.

## Package Layout

```text
integrations/
  vendor-id/
    manifest.json
    display.json
    index.js
    validate.js
    sync.js
    migrations/
      001_create_schema.sql
    README.md
```

## `manifest.json`

Every integration must provide `manifest.json`.

```json
{
  "id": "vendor-id",
  "name": "Vendor Product",
  "vendor": "Vendor",
  "version": "1.0.0",
  "marketplaceApiVersion": "1.0",
  "minimumMarketplaceVersion": "1.0.0",
  "description": "What this integration does.",
  "category": "Vulnerability Management",
  "icon_color": "#2E8CEB",
  "entry": "index.js",
  "capabilities": ["settings", "validate", "sync", "history", "schedule"],
  "settings": []
}
```

### Supported Capabilities

Capabilities enable Marketplace services and actions. They do not define integration screens.

| Capability | Purpose |
| --- | --- |
| `settings` | Render settings from `manifest.json`. |
| `validate` | Show and run the credential validation action. |
| `sync` | Show and run the manual sync action. |
| `history` | Show Marketplace run history for this integration. |
| `schedule` | Show schedule controls and run scheduled syncs. |

If `schedule` is declared, `sync` must also be declared.

### Settings

Settings are rendered by the Marketplace and stored by key.

```json
{
  "key": "VendorApiToken",
  "label": "API Token",
  "type": "secret",
  "group": "Vendor Configuration",
  "required": true
}
```

Supported setting types:

- `text`
- `url`
- `secret`
- `select`
- `number`
- `checkbox`

Use `secret` for API keys, tokens, passwords, and client secrets.

## Runtime Handlers

The integration entrypoint defaults to `index.js`, or the file specified by `manifest.entry`.

```js
const { validate } = require("./validate");
const { sync } = require("./sync");

module.exports = {
  validate,
  sync
};
```

### `validate(context)`

Required only when the integration declares `validate`.

Return keyed validation results:

```js
return {
  "vendor-id": { ok: true, message: "Connected" },
  action1: { ok: true, message: "Connected - token acquired" }
};
```

If the integration does not use Action1 credentials directly, omit `action1`.

### `sync(context)`

Required only when the integration declares `sync`.

The sync handler should:

1. Create a run-history entry.
2. Fetch vendor data.
3. Map vendor data into integration-owned tables.
4. Update shared CVE metadata/cache where useful.
5. Compute run metrics if using the standard metric dashboard.
6. Mark the run as success or failure.

Prefer the helpers in `sdk/` for run-history consistency.

## Runtime Context

Handlers receive:

```js
context.integrationId

context.logger.info(message)
context.logger.warn(message)
context.logger.error(message)

await context.settings.get(key)
await context.settings.set(key, value)
await context.settings.all(["KeyA", "KeyB"])

await context.db.run(sql, params)
await context.db.get(sql, params)
await context.db.all(sql, params)
await context.db.statement(sql, params)
await context.db.row(sql, params)

context.db.tables.endpoints
context.db.tables.endpointCves

context.http
context.services.nvd
context.services.computeAndSaveRunMetrics(runId, context.integrationId)
```

The `context` object is the Marketplace compatibility boundary. Do not import Marketplace backend files from an integration.

## Database Migrations

Integrations own their database schema through `migrations/*.sql`.

```text
migrations/
  001_create_schema.sql
  002_add_indexes.sql
```

The Marketplace applies migrations at startup and records completed migrations. Migrations run once per integration and filename.

Use integration-prefixed table names:

```sql
CREATE TABLE IF NOT EXISTS vendor_id_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  raw_json TEXT,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

For standard endpoint and vulnerability renderers, create:

```text
<integration_id>_endpoints
<integration_id>_endpoint_cves
```

The Marketplace exposes these names at runtime:

```js
const endpointTable = context.db.tables.endpoints;
const cveTable = context.db.tables.endpointCves;
```

The Marketplace framework owns shared tables for settings, authentication, schedules, sync history, shared CVE metadata, and migration tracking.

## Display Definitions

Visible integration screens are defined in `display.json`.

```json
{
  "navigation": [
    { "id": "dashboard", "label": "Dashboard", "path": "dashboard", "icon": "Activity" },
    { "id": "endpoints", "label": "Endpoints", "path": "endpoints", "icon": "Server" },
    { "id": "settings", "label": "Settings", "path": "settings", "icon": "Settings", "capability": "settings", "requiresWrite": true }
  ],
  "dashboard": {
    "component": "metric-dashboard",
    "title": "{integrationName} Vulnerability Summary",
    "description": "Comprehensive analysis across {integrationName} and Action1.",
    "kpis": [],
    "sections": []
  },
  "endpoints": {
    "title": "Endpoints",
    "searchPlaceholder": "Search endpoints...",
    "defaultSort": { "key": "endpoint_name", "direction": "asc" },
    "columns": [
      { "key": "endpoint_name", "label": "Name", "type": "strong" },
      { "key": "integration_total_vulns", "label": "{integrationName} Total", "type": "number" },
      { "key": "status", "label": "Status", "type": "syncStatus" }
    ]
  },
  "vulnerabilities": {
    "title": "Vulnerabilities",
    "columns": [
      { "key": "cve", "label": "CVE", "type": "nistLink", "filterParam": "cve" },
      { "key": "severity", "label": "Severity", "type": "severityBadgeDynamic", "filterParam": "severityColumn" }
    ]
  },
  "history": {
    "title": "Run History",
    "columns": [
      { "key": "id", "label": "Run ID", "type": "runId" },
      { "key": "status", "label": "Status", "type": "runStatus" }
    ]
  },
  "settings": {
    "title": "Configuration",
    "validateButtonLabel": "Validate Credentials",
    "saveButtonLabel": "Save Settings",
    "scheduleTitle": "Schedule"
  }
}
```

The Marketplace provides renderers. The integration owns the labels, columns, metrics, navigation, and which screens should appear.

For a custom Marketplace-provided dashboard component:

```json
{
  "dashboard": {
    "component": "intune-agent-status"
  }
}
```

## Scaffolding And Validation

Create a new integration:

```bash
npm run create-integration -- my-integration
```

Validate the repository:

```bash
npm test
```

Use `developer/examples/hello-integration` as the minimal complete example. The `developer/` directory is not loaded by the Marketplace runtime.
