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

## Handlers

`index.js` may export these async handlers:

```js
async function validate(context) {}
async function sync(context) {}

module.exports = { validate, sync };
```

The Marketplace runs the handlers. The integration owns vendor-specific behavior.

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

Sync-capable vulnerability integrations should write to:

- `sync_history`
- `endpoints`
- `endpoint_cves`
- `cve_details`
- `cve_cache` when NVD data is known

Then call:

```js
await context.services.computeAndSaveRunMetrics(runId, context.integrationId);
```

The Marketplace dashboards, endpoint lists, vulnerability lists, history pages, and exports read from those shared tables.

## Validation Results

Validation handlers should return keyed results:

```js
return {
  vendorId: { ok: true, message: 'Connected' },
  action1: { ok: true, message: 'Connected - token acquired' }
};
```

If an integration does not use Action1 credentials directly, omit `action1`.
