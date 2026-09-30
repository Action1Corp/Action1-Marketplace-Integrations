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
    docs/
      index.json
      user-guide.pdf
      setup-guide.md
    README.md
```

`manifest.json`, `index.js`, `ui/index.jsx`, and `README.md` are always required. Other files depend on the integration's behavior.

## Customer Documentation

Keep customer-facing documentation in the integration's own `docs/` folder. Add a `docs/index.json` file to list the documents shown in the Marketplace Docs view, in display order:

```json
{
  "documents": [
    {
      "id": "user-guide",
      "title": "User Guide",
      "description": "Install, configure, and use the integration.",
      "file": "user-guide.pdf"
    },
    {
      "id": "setup-guide",
      "title": "Setup Guide",
      "file": "setup-guide.md"
    }
  ]
}
```

Each entry needs a unique lowercase `id` using letters, numbers, and hyphens, a `title`, and a `file` name. `description` is optional. Place `.pdf` or `.md` files directly in `docs/`; nested paths and other file types are not supported. Markdown files must be at most 1 MB and PDFs at most 20 MB. The package script includes `docs/` automatically, so keep the index and referenced files in the integration folder before packaging.

If `docs/index.json` is absent, the Marketplace shows the integration's root `README.md` as a single Overview document. If an index exists, only its valid listed documents are shown; the README is not added automatically. Documentation is available for an installed integration even when that integration is disabled.

## Core Principles

- The Marketplace is the host framework.
- The integration owns vendor-specific code, schema, views, and data mapping.
- Integrations must use the runtime `context` object as the host boundary.
- Integrations must not import Marketplace backend files directly.
- Integrations should use integration-prefixed table names.
- Database migrations must be additive and safe to run once.

## Manifest Metadata

`manifest.json` identifies the integration, version, category, icon color, entrypoint, and integration-owned actions.

The Marketplace infers supported runtime behavior from the integration package:

- settings are available when `ui/settingsSchema.json` and a settings view exist
- validation is available when the integration declares a validation action and exports the matching action handler
- manual operations are available when the integration declares actions and exports matching action handlers
- manual runs and schedules are available when the integration declares a sync/run action and exports the matching action handler
- history is available to any integration-owned view through Marketplace APIs

Visible tabs are listed in `display.json` navigation. Dashboards, endpoint tables, vulnerability tables, settings layouts, and other screens are defined in integration-owned React views.

## Integration Actions

Use `actions` in `manifest.json` for integration-owned operations that should appear in integration-owned screens. The integration UI renders the button and calls the Marketplace action endpoint; the Marketplace dispatches the request to the integration-owned handler.

Action IDs must be stable lowercase kebab-case values. The entrypoint must export an action map with a matching handler for each declared action.

Actions are tracked in Marketplace history by default. A tracked action creates a run-history row with `action_id`, `action_label`, `status`, `details`, and `assets_processed`. Failed tracked actions are eligible for Marketplace email/webhook failure notifications.

Optional action fields:

- `history: false` disables Marketplace history tracking for read-only or purely local UI actions.
- `preventConcurrent: false` allows this action to run while another action for the same integration is running. The default is to block overlapping tracked actions.

## Handlers

Handlers are integration-owned. The Marketplace does not implement vendor validation or vendor run logic; it only exposes host APIs/actions and calls the matching handler when the integration exports it.

The Marketplace supports integration-owned action handlers as the primary extension point:

```js
module.exports = {
  actions: {
    "check-configuration": async (context, request) => ({ ok: true })
  }
};
```

Action handlers receive `request.action`, `request.actionId`, `request.settings`, `request.payload`, and `request.run`. When history tracking is enabled, `request.run` contains:

```js
await request.run.appendLog("Downloaded vendor inventory.");
await request.run.setAssetsProcessed(42);
```

The Marketplace will mark the action `Success` when the handler returns normally, and `Failed` when it throws or returns `{ ok: false }`.

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

context.http
context.services.nvd
context.services.computeAndSaveRunMetrics(runId, context.integrationId)
```

Integrations own their table names. Define table-name constants in integration code that match the integration's migration files.

## Shared Action1 Credentials

The Marketplace owns shared Action1 API credentials. Integrations must not declare their own Action1 credential settings.

When an integration needs Action1 data, use:

```js
const { apiKey, apiSecret, organizationId } = await context.action1.getCredentials();
```

Use `context.action1.getCredentials()` whenever an integration needs Action1 API access.

## Failure Notifications

The Marketplace owns SMTP and webhook notification settings and automatically sends an alert when a tracked action, manual run, or scheduled run action fails. Integrations should rely on that framework for normal operation failures.

For untracked operations that intentionally bypass Marketplace history, use:

```js
await context.notifications.sendFailureAlert({ error });
```

Tracked actions do not need to create their own run-history rows. If an integration disables history tracking for an action, it must create an accurate failed run-history entry before requesting an alert so email and webhook payloads include useful run details.

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
- run history
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

If an integration uses this pattern, it should still define those names in its own code and migrations.

## SDK Helpers

The `sdk/` folder provides helpers for advanced cases where an integration intentionally manages run history itself.

```js
const {
  createRun,
  appendRunLog,
  completeRun,
  failRun
} = require("../../sdk");
```

For an integration in `developer/examples`, use `../../../sdk`.

New action handlers should prefer the Marketplace-provided `request.run` helpers for action logs and status.

## Validation

Run repository validation before opening a pull request:

```bash
npm test
```

Validation checks manifest shape, sidebar navigation, integration-owned UI exports, migration naming, table requirements, and handler exports.

