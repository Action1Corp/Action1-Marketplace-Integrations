# Display Reference

Each integration owns its visible Marketplace screens in `display.json`.

`marketplaceActions` define host services. `display.json` defines screens, tabs, labels, columns, and dashboard sections.

## Top-Level Shape

```json
{
  "navigation": [],
  "dashboard": {},
  "endpoints": {},
  "vulnerabilities": {},
  "history": {},
  "settings": {}
}
```

Supported top-level sections:

- `navigation`
- `dashboard`
- `endpoints`
- `vulnerabilities`
- `history`
- `settings`

Only define sections the integration actually uses.

## Navigation

Navigation controls the tabs shown under the enabled integration in the sidebar.

```json
{
  "navigation": [
    { "id": "dashboard", "label": "Dashboard", "path": "dashboard", "icon": "Activity" },
    { "id": "endpoints", "label": "Endpoints", "path": "endpoints", "icon": "Server" },
    { "id": "vulnerabilities", "label": "Vulnerabilities", "path": "vulnerabilities", "icon": "ShieldAlert" },
    { "id": "history", "label": "History", "path": "history", "icon": "History", "marketplaceAction": "history" },
    { "id": "settings", "label": "Settings", "path": "settings", "icon": "Settings", "marketplaceAction": "settings", "requiresWrite": true }
  ]
}
```

Fields:

- `id`: stable view identifier.
- `label`: sidebar label.
- `path`: route segment under `/apps/<integration_id>/`.
- `icon`: Marketplace icon name.
- `marketplaceAction`: optional service dependency.
- `requiresWrite`: hide from read-only users when true.

Use `marketplaceAction` only for Marketplace services such as `settings`, `history`, `sync`, `validate`, or `schedule`.

## Dashboard

The standard vulnerability dashboard uses:

```json
{
  "dashboard": {
    "component": "metric-dashboard",
    "title": "{integrationName} Vulnerability Summary",
    "description": "Comprehensive analysis across {integrationName} and Action1.",
    "kpis": [],
    "sections": []
  }
}
```

Supported dashboard components:

- `metric-dashboard`
- `intune-agent-status`

`metric-dashboard` reads metrics computed from integration-owned endpoint and CVE tables.

### KPI Metrics

```json
{
  "label": "TOTAL VULNERABILITIES",
  "metric": "totalCves",
  "color": "#111827",
  "tone": "gray",
  "to": "vulnerabilities"
}
```

Common metrics:

- `totalEndpoints`
- `totalAction1Assets`
- `totalIntegrationAssets`
- `missingFromIntegration`
- `missingFromAction1`
- `totalCves`
- `totalCritical`
- `totalHigh`
- `totalMedium`
- `totalLow`
- `totalPatchable`
- `totalNotPatchable`
- `totalUnrecognized`
- `syncRate`
- `patchRate`

### Dashboard Sections

Card section:

```json
{
  "title": "Threat Severity Profile",
  "cards": [
    {
      "label": "Critical",
      "metric": "totalCritical",
      "color": "#ef4444",
      "to": "vulnerabilities?severity=Critical",
      "icon": "ShieldAlert",
      "subtitle": "Immediate corrective action required"
    }
  ]
}
```

Severity distribution section:

```json
{
  "title": "Distribution",
  "type": "severityDistribution"
}
```

## Endpoints View

```json
{
  "endpoints": {
    "title": "Endpoints",
    "searchPlaceholder": "Search endpoints...",
    "emptyText": "No endpoints match the current filters.",
    "defaultSort": { "key": "endpoint_name", "direction": "asc" },
    "columns": []
  }
}
```

Columns map to fields returned from the integration endpoint table.

```json
{
  "key": "endpoint_name",
  "label": "Name",
  "type": "strong"
}
```

## Vulnerabilities View

```json
{
  "vulnerabilities": {
    "title": "Vulnerabilities",
    "searchPlaceholder": "Search vulnerabilities...",
    "emptyText": "No vulnerabilities match the current filters.",
    "defaultSort": { "key": "severity", "direction": "asc" },
    "columns": []
  }
}
```

Use `filterParam` for column filters.

```json
{
  "key": "cve",
  "label": "CVE",
  "type": "nistLink",
  "filterParam": "cve"
}
```

## History View

```json
{
  "history": {
    "title": "Run History",
    "searchPlaceholder": "Search history...",
    "emptyText": "No sync history found matching criteria.",
    "defaultSort": { "key": "id", "direction": "desc" },
    "columns": [
      { "key": "id", "label": "Run ID", "type": "runId" },
      { "key": "timestamp", "label": "Timestamp", "type": "datetime" },
      { "key": "status", "label": "Status", "type": "runStatus" },
      { "key": "assets_processed", "label": "Items Processed", "type": "number" },
      { "key": "actions", "label": "Actions", "type": "historyActions", "sortable": false }
    ]
  }
}
```

## Settings View

```json
{
  "settings": {
    "title": "Configuration",
    "validateButtonLabel": "Validate Credentials",
    "saveButtonLabel": "Save Settings",
    "scheduleTitle": "Schedule"
  }
}
```

Settings fields come from `manifest.json`. Schedule controls appear when the integration declares `schedule` or `sync`.

## Supported Column Types

- `strong`
- `number`
- `syncStatus`
- `nistLink`
- `severityBadgeDynamic`
- `runId`
- `datetime`
- `runStatus`
- `historyActions`
- `text`
- `badge`
- `boolean`
- `monospace`
- `severityBadge`
- `muted`
- `patchStatus`

If `type` is omitted, the value renders as plain text.

