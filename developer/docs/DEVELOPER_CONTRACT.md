# Integration Developer Contract

This document defines the rules an integration must follow to run inside the Action1 Integration Marketplace. For the full API reference, see `MARKETPLACE_INTEGRATION_API.md`.

## Package Shape

Each runtime integration lives in its own folder under `integrations/`.

```text
integrations/
  my-integration/
    manifest.json
    display.json
    index.js
    optional handler modules
    ui/
      index.jsx
      view components
    migrations/
      001_create_schema.sql
    README.md
```

`manifest.json`, `index.js`, `ui/index.jsx`, and `README.md` are always required. Other files depend on the integration's behavior.

## Core Principles

- The Marketplace is the host framework.
- The integration owns vendor-specific code, schema, views, and data mapping.
- Integrations must use the runtime `context` object as the compatibility boundary.
- Integrations must not import Marketplace backend files directly.
- Integrations should use integration-prefixed table names.
- Database migrations must be additive and safe to run once.

## Manifest `hostServices`

`hostServices` describe Marketplace services or actions, not integration screens.

Supported `hostServices`:

- `settings`: expose Marketplace settings storage APIs and settings host actions
- `validate`: allow an integration-owned validation handler to be called
- `sync`: allow an integration-owned run handler to be called manually or by schedules
- `history`: allow integration UI to read Marketplace run history
- `schedule`: allow the Marketplace scheduler to run the integration on a schedule

Dashboards, endpoint tables, vulnerability tables, and other tabs are defined in `display.json`. They are not manifest hostServices.

Example settings-only integration:

```json
{
  "hostServices": ["settings"]
}
```

If an integration declares `schedule`, it must also declare `sync`. The Marketplace owns cron registration, timezone handling, storage, and execution.

## Integration Actions

Use `actions` in `manifest.json` for custom integration-owned operations that should appear in integration-owned screens. The integration UI renders the button and calls the host service endpoint; the Marketplace dispatches the request to the integration-owned handler.

Action IDs must be stable lowercase kebab-case values. The entrypoint must export an action map with a matching handler for each declared action.

## Handlers

Handlers are integration-owned. The Marketplace does not implement vendor validation or vendor run logic; it only exposes host APIs/actions and calls the matching handler when the integration declares that host service.

The Marketplace currently supports two optional integration-owned handler types:

- validation handler
- run handler

Integrations can also expose generic action handlers through the action map. These are invoked by action id and receive the runtime context plus submitted settings and payload values.

Integrations can define any internal functions they need. The Marketplace will not call arbitrary function names unless a future API version defines them.

## Runtime Context

Handlers receive a `context` object:

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

Use `context.db.tables` only when the integration follows the common endpoint/CVE table naming pattern. Otherwise, integrations can query their own tables directly through `context.db`.

## Shared Action1 Credentials

The Marketplace owns shared Action1 API credentials. Integrations must not declare `Action1APIKey`, `Action1APISecret`, or `Action1OrgID` in `manifest.json`.

When an integration needs Action1 data, use:

```js
const { apiKey, apiSecret, organizationId } = await context.action1.getCredentials();
```

Older integrations may still read these values from `context.settings`, but new integrations should prefer `context.action1.getCredentials()`.

## Failure Notifications

The Marketplace owns SMTP and webhook notification settings and automatically sends an alert when a manual or scheduled integration run fails. Integrations should rely on that framework for normal sync failures.

For custom integration operations that run outside the normal sync runner, use:

```js
await context.notifications.sendFailureAlert({ error });
```

The integration must still write an accurate failed run-history entry before requesting an alert so email and webhook payloads include useful run details.

## Database Ownership

Integrations define their database needs through migration files.

```text
migrations/
  001_create_schema.sql
  002_add_indexes.sql
```

The Marketplace applies migrations at startup and records completed migrations in its migration ledger. Migration filenames must be stable and ordered.

The Marketplace owns framework tables for:

- authentication and organizations
- settings and secret storage
- schedules
- sync history
- shared CVE metadata/cache
- migration tracking

Integrations own tables for:

- vendor assets
- vendor findings
- endpoint mappings
- vulnerability mappings
- any vendor-specific state

For vulnerability-management integrations, one common table pattern is:

```text
<integration_id>_endpoints
<integration_id>_endpoint_cves
```

The Marketplace resolves these names from the integration ID.

## SDK Helpers

The `sdk/` folder provides helpers for common integration behavior.

```js
const {
  createSyncRun,
  appendSyncLog,
  completeSyncRun,
  failSyncRun,
  getDataTables
} = require("../../sdk");
```

For an integration in `developer/examples`, use `../../../sdk`.

`getDataTables(context)` returns the Marketplace-resolved endpoint and vulnerability table names for the current integration.

## Validation

Run repository validation before opening a pull request:

```bash
npm test
```

Validation checks manifest shape, supported hostServices, display definitions, integration-owned UI exports, migration naming, table requirements, and handler exports.

