# Marketplace Integration API

Current API version: `1.0`

Integrations are folder-based packages loaded by the Marketplace at startup.

```text
integrations/
  vendor-id/
    manifest.json
    index.js
    README.md
```

## Manifest

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
  "capabilities": ["settings", "validate", "sync", "dashboard", "endpoints", "vulnerabilities", "history", "schedule"],
  "settings": []
}
```

Declare only the capabilities the integration actually supports. The Marketplace hides unsupported navigation and actions automatically.

## Capabilities And Handlers

Capabilities describe which Marketplace-provided UI surfaces and actions should be enabled for an integration.

Current built-in capabilities:

- `settings`: render settings from `manifest.json`
- `validate`: show the Marketplace credential validation action
- `sync`: show the Marketplace sync action
- `dashboard`: show the standard dashboard view backed by Marketplace data tables
- `endpoints`: show the standard endpoints view backed by Marketplace data tables
- `vulnerabilities`: show the standard vulnerabilities view backed by Marketplace data tables
- `history`: show the standard run history view backed by Marketplace data tables
- `schedule`: show the standard schedule controls

Declare only what the integration actually uses. An integration can be settings-only, dashboard-only, or use none of the current action handlers.

When an integration declares a built-in action capability, the Marketplace invokes the matching optional handler:

```js
module.exports = { validate, sync };
```

`validate(context)` is required only when the integration declares `validate`.

`sync(context)` is required only when the integration declares `sync`.

Integrations may define any internal functions they need. The Marketplace only calls handlers that are part of the supported integration API. Future Marketplace versions can add more built-in handlers without changing integrations that do not use them.

## Runtime Context

Handlers receive a context object:

```js
context.integrationId
context.logger.info(message)
context.logger.warn(message)
context.logger.error(message)

await context.settings.get(key)
await context.settings.set(key, value)
await context.settings.all(['KeyA', 'KeyB'])

await context.db.run(sql, params)
await context.db.get(sql, params)
await context.db.all(sql, params)
await context.db.statement(sql, params)
await context.db.row(sql, params)

context.http
context.services.nvd
context.services.computeAndSaveRunMetrics(runId, integrationId)
```

Integrations must not import Marketplace backend files directly. The context object is the compatibility boundary.

## Data Output

Integrations that use the standard Marketplace dashboard, endpoint, vulnerability, history, or export views should write to the shared Marketplace data tables those views read from:

- `sync_history`
- `endpoints`
- `endpoint_cves`
- `cve_details`
- `cve_cache` when NVD data is known

For sync-style integrations, call this after writing run data:

```js
await context.services.computeAndSaveRunMetrics(runId, context.integrationId);
```

Integrations that do not use those standard views do not need to write to those tables.

## Validation Results

If an integration declares `validate`, its validation handler should return keyed results:

```js
return {
  vendorId: { ok: true, message: 'Connected' },
  action1: { ok: true, message: 'Connected - token acquired' }
};
```

If an integration does not use Action1 credentials directly, omit `action1`.
