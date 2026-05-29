# Marketplace Integration API

Current API version: `1.0`

The Action1 Integration Marketplace loads integrations as folder-based packages. Each package declares its catalog metadata, integration-owned settings schema, visible screens, database schema, and runtime handlers.

## Package Layout

```text
integrations/
  vendor-id/
    manifest.json
    display.json
    index.js
    optional handler modules
    ui/
      index.jsx
      settingsSchema.json
      view components
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
  "actions": []
}
```

### Inferred Runtime Behavior

Runtime behavior is inferred from the integration package instead of being declared in the manifest.

| Package Content | Marketplace Behavior |
| --- | --- |
| `ui/settingsSchema.json` plus a settings view | settings storage, secret masking, and configured-state detection |
| exported validation handler | credential validation endpoint can dispatch to the integration |
| exported run handler | manual runs and schedules can dispatch to the integration |
| history view or API calls | integration UI can read Marketplace run history |

### Integration Actions

Integrations can define custom actions in `manifest.json`. Integration-owned React views render those actions and call the Marketplace action endpoint, which dispatches the request back to the integration-owned handler.

```json
{
  "actions": [
    {
      "id": "publish-agent",
      "label": "Publish Agent",
      "buttonLabel": "Publish",
      "description": "Publishes the current agent package to the vendor platform.",
      "placement": "settings",
      "confirm": true,
      "confirmMessage": "Publish the agent package now?"
    }
  ]
}
```

Supported placements:

- `settings`
- any screen path declared in `display.navigation`, such as `actions-lab` or `asset-risk`

The action `id` must be lowercase kebab-case and must match an integration-owned handler exported from the entrypoint.

### Settings

Settings are defined by the integration in `ui/settingsSchema.json`. The integration-owned settings view imports this file for rendering, and the Marketplace backend reads the same file so secret values can be masked/encrypted and required configuration can be detected.

`ui/settingsSchema.json`:

```json
[
  {
    "key": "VendorApiToken",
    "label": "API Token",
    "type": "secret",
    "group": "Vendor Configuration",
    "required": true
  }
]
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
It exports whichever integration-owned handlers match the actions declared in `manifest.json`.

Generic actions are exported as an action map keyed by action id. Each action receives the runtime context and the submitted settings/payload from the Marketplace.

### Validation Handler

Optional. When exported by the integration entrypoint, the Marketplace validation endpoint can dispatch to it. The handler belongs to the integration and should contain the vendor-specific credential check.

Return keyed validation results:

```js
return {
  "vendor-id": { ok: true, message: "Connected" },
  action1: { ok: true, message: "Connected - token acquired" }
};
```

If the integration does not use Action1 credentials directly, omit `action1`.

### Run Handler

Optional. When exported by the integration entrypoint, the Marketplace can dispatch manual runs and scheduled runs to it. The handler belongs to the integration and should contain the vendor-specific job logic.

The run handler should:

1. Create a run-history entry.
2. Fetch vendor data.
3. Map vendor data into integration-owned tables.
4. Update shared CVE metadata/cache where useful.
5. Compute or store any metrics needed by the integration-owned React views.
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

await context.action1.getCredentials()
await context.notifications.sendFailureAlert({ error })

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

### Shared Action1 Credentials

The Marketplace owns the Action1 API credential settings:

- `Action1APIKey`
- `Action1APISecret`
- `Action1OrgID`

Do not declare those keys in an integration manifest. Integrations that need Action1 data can read the shared credentials through `context.action1.getCredentials()` or, for compatibility with older integrations, through `context.settings.get("Action1APIKey")`, `context.settings.get("Action1APISecret")`, and `context.settings.get("Action1OrgID")`.

### Failure Notifications

The Marketplace owns SMTP and webhook notification settings and automatically sends a failure alert when a manual or scheduled integration run finishes with a failed status. Integrations usually do not need to call notification APIs directly.

If an integration has a custom operation outside the normal sync runner, it can request the same Marketplace failure alert through:

```js
await context.notifications.sendFailureAlert({ error });
```

The integration should still record the failed run in Marketplace run history so the email and webhook payload can include the run ID and details.

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

For vulnerability-management integrations, one common table pattern is:

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

Visible integration screens are defined by `display.navigation`. `display.json` should not contain screen layout metadata; screen titles, columns, cards, buttons, and other UI details belong in the integration-owned React views.

```json
{
  "navigation": [
    { "id": "asset-risk", "label": "Asset Risk", "path": "asset-risk", "icon": "Activity" },
    { "id": "deployment-status", "label": "Deployment Status", "path": "deployment-status", "icon": "Server" },
    { "id": "settings", "label": "Settings", "path": "settings", "icon": "Settings", "requiresWrite": true }
  ]
}
```

The integration owns the labels, columns, metrics, and React views for every screen it exposes. `display.json` only tells the Marketplace which screens to show in the sidebar.

## Integration-Owned React Views

Every integration screen is rendered by integration-owned React. Each integration must provide a `ui/index.jsx` file that exports a `views` map. These views are bundled into the Marketplace frontend at image build time.

```jsx
import Dashboard from './Dashboard.jsx';
import ActionsLab from './ActionsLab.jsx';

export const views = {
  dashboard: Dashboard,
  'actions-lab': ActionsLab
};
```

Each key maps to a route segment under `/apps/<integration_id>/<view>`. Every `display.navigation[].path` entry must have a matching key in the exported `views` map. The Marketplace renders only integration-owned React views for integration screens.

View components receive Marketplace context props:

```jsx
function Dashboard({ integration, screen, runSync, canRunSync, integrationMeta }) {
  return <div>{integration}</div>;
}
```

Integration-owned UI can call Marketplace APIs such as:

```js
await fetch(`/api/integrations/${integration}/actions/my-action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: { source: 'integration-ui' } })
});
```

The Marketplace still owns authentication, authorization, routing, shell layout, backend runtime context, scheduler, settings storage, and notification services.

Shared UI helpers can live in the integrations repository for common patterns, but they are still integration-owned code bundled from the integrations repository.

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

## Additional Guides

- `GETTING_STARTED.md`: build your first integration.
- `DISPLAY_REFERENCE.md`: full `display.json` reference.
- `SCHEMA_REFERENCE.md`: integration table requirements.
- `LOCAL_TESTING.md`: test with a local Marketplace container.
- `NOTIFICATION_WEBHOOKS.md`: failure webhook payloads.
- `REVIEW_CHECKLIST.md`: pull request review checklist.

