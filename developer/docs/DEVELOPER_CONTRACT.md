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
    validate.js
    sync.js
    migrations/
      001_create_schema.sql
    README.md
```

Only `manifest.json`, `index.js`, and `README.md` are always required. Other files depend on the integration's behavior.

## Core Principles

- The Marketplace is the host framework.
- The integration owns vendor-specific code, schema, views, and data mapping.
- Integrations must use the runtime `context` object as the compatibility boundary.
- Integrations must not import Marketplace backend files directly.
- Integrations should use integration-prefixed table names.
- Database migrations must be additive and safe to run once.

## Manifest `marketplaceActions`

`marketplaceActions` describe Marketplace services or actions, not integration screens.

Supported `marketplaceActions`:

- `settings`: render settings from `manifest.json`
- `validate`: show and run a credential validation action
- `sync`: show and run a manual sync action
- `history`: show the Marketplace run history view
- `schedule`: show schedule controls and run the integration on a schedule

Dashboards, endpoint tables, vulnerability tables, and other tabs are defined in `display.json`. They are not manifest marketplaceActions.

Example settings-only integration:

```json
{
  "marketplaceActions": ["settings"]
}
```

If an integration declares `schedule`, it must also declare `sync`. The Marketplace owns cron registration, timezone handling, storage, and execution.

## Handlers

Handlers are optional and should only be exported when the matching marketplaceAction exists.

```js
module.exports = {
  async validate(context) {
    return {
      "my-integration": { ok: true, message: "Connected" }
    };
  },

  async sync(context) {
    context.logger.info("Sync started");
  }
};
```

The Marketplace currently calls only:

- `validate(context)`
- `sync(context)`

Integrations can define any internal functions they need, but the Marketplace will not call arbitrary function names unless a future API version defines them.

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

Use `context.db.tables` when writing data for the standard Marketplace dashboard, endpoint, vulnerability, and export renderers.

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

For standard endpoint and vulnerability renderers, integrations should create:

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

Validation checks manifest shape, supported marketplaceActions, display definitions, migration naming, standard table requirements, and handler exports.
