# Marketplace Integration API

Current API version: `1.0`

The Action1 Integration Marketplace loads integrations as folder-based packages. Each package declares its catalog metadata, integration-owned actions, settings schema, visible screens, database schema, and runtime handlers.

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
| manifest actions plus exported action handlers | integration-owned operations can run through the Marketplace action endpoint and history/notification framework |
| manifest action with `kind: "validate"` | settings screens can call the integration-owned validation action |
| manifest action with `kind: "sync"` | manual run buttons and schedules can dispatch to the integration-owned sync action |
| history view or API calls | integration UI can read Marketplace run history |

### Integration Actions

Integrations define custom actions in `manifest.json`. Integration-owned React views render those actions and call the Marketplace action endpoint, which dispatches the request back to the integration-owned handler.

```json
{
  "actions": [
    {
      "id": "publish-agent",
      "label": "Publish Agent",
      "buttonLabel": "Publish",
      "description": "Publishes the current agent package to the vendor platform.",
      "placement": "settings",
      "history": true,
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

Actions are tracked in Marketplace history by default. A tracked action creates a history row with:

- `action_id`
- `action_label`
- `status`
- `details`
- `assets_processed`

Failed tracked actions use the Marketplace failure notification path. Set `history: false` only for actions that should not create a history row. Set `preventConcurrent: false` only when this action can safely run while another action for the same integration is already running.

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

Generic actions are exported as an action map keyed by action id. Each action receives the runtime context, action metadata, submitted settings/payload, and tracked-run helpers from the Marketplace.

```js
module.exports = {
  actions: {
    "publish-agent": async (context, request) => {
      await request.run?.appendLog("Starting publish.");
      await request.run?.setAssetsProcessed(1);
      return { ok: true, message: "Publish completed." };
    }
  }
};
```

When history tracking is enabled, `request.run` includes:

- `id`
- `appendLog(message)`
- `setStatus(status, details)`
- `setAssetsProcessed(count)`

The Marketplace marks the action `Success` when the handler returns normally, and `Failed` when the handler throws or returns `{ ok: false }`.

### Validation Actions

When an integration needs credential or configuration validation, declare an action such as `validate-configuration` with `kind: "validate"` and export the matching action handler.

Return keyed validation results:

```js
return {
  "vendor-id": { ok: true, message: "Connected" },
  action1: { ok: true, message: "Connected - token acquired" }
};
```

If the integration does not use Action1 credentials directly, omit `action1`.

### Sync And Run Actions

When an integration needs a user-triggered or scheduled vendor job, declare an action such as `sync` with `kind: "sync"` and export the matching action handler.

The action handler should:

1. Use `request.run` for run-history logs when Marketplace history tracking is enabled.
2. Fetch vendor data.
3. Map vendor data into integration-owned tables.
4. Update shared CVE metadata/cache where useful.
5. Compute or store any metrics needed by the integration-owned React views.
6. Return success, return `{ ok: false }`, or throw an error so the Marketplace can record the final status.

Use the helpers in `sdk/` only when an integration intentionally disables Marketplace action history and manages run history directly.

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

The `context` object is the Marketplace host boundary. Do not import Marketplace backend files from an integration.

### Shared Action1 Credentials

The Marketplace owns the Action1 API credential settings. Do not declare Action1 credentials in an integration manifest or settings schema.

Integrations that need Action1 data must read the shared credentials through `context.action1.getCredentials()`.

### Failure Notifications

The Marketplace owns SMTP and webhook notification settings and automatically sends a failure alert when a tracked action, manual run action, or scheduled sync action finishes with a failed status. Integrations usually do not need to call notification APIs directly.

If an integration intentionally disables action history and runs outside the tracked action flow, it can request the same Marketplace failure alert through:

```js
await context.notifications.sendFailureAlert({ error });
```

Tracked actions do not need to create their own history row. Untracked actions should still record a failed run in Marketplace run history so the email and webhook payload can include the run ID and details.

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

The Marketplace framework owns shared tables for settings, authentication, schedules, run history, shared CVE metadata, and migration tracking.

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

