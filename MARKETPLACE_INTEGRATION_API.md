# Marketplace Integration API

Current API version: `1.0`

Integrations are folder-based packages loaded by the Marketplace at startup.

```text
integrations/
  vendor-id/
    manifest.json
    display.json
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
- `schedule`: show the standard schedule controls for this integration

Declare only what the integration actually uses. An integration can be settings-only, dashboard-only, or use none of the current action handlers.

`schedule` is per integration. The Marketplace owns cron registration, timezone handling, storage, and execution. If an integration declares `schedule`, it must also declare `sync`; when the schedule fires, the Marketplace calls only that integration's `sync(context)` handler.

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

## Scaffolding

Create a new integration from the repository root:

```bash
npm run create-integration -- my-integration
```

Use `integrations/hello-integration` as a minimal complete example.

Run validation before opening a pull request:

```bash
npm test
```

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

## Display Definitions

Integration-specific displays live with the integration in `display.json`. The Marketplace acts as the host shell: it loads these definitions, builds the left navigation from them, and renders the supported surfaces with the labels, columns, links, and button text supplied by the integration.

```json
{
  "navigation": [
    { "id": "dashboard", "label": "Dashboard", "path": "dashboard", "icon": "Activity", "capability": "dashboard" },
    { "id": "endpoints", "label": "Endpoints", "path": "endpoints", "icon": "Server", "capability": "endpoints" },
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
    "searchPlaceholder": "Global search across endpoint columns...",
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

The Marketplace provides renderer components such as `metric-dashboard`, endpoint tables, vulnerability tables, history tables, and settings forms. The integration owns the layout definition, labels, metric bindings, filters, navigation targets, and which tabs should appear. Declare only the display sections that match the capabilities in `manifest.json`.

For custom Marketplace-provided dashboard components, set the component name:

```json
{
  "dashboard": {
    "component": "intune-agent-status"
  }
}
```

## Validation Results

If an integration declares `validate`, its validation handler should return keyed results:

```js
return {
  vendorId: { ok: true, message: 'Connected' },
  action1: { ok: true, message: 'Connected - token acquired' }
};
```

If an integration does not use Action1 credentials directly, omit `action1`.
