# Display Reference

Each integration owns its visible Marketplace screens in `display.json` and `ui/`.

`marketplaceActions` define host services. `display.json` defines navigation and any screen metadata the integration's React views want to consume.

## Top-Level Shape

Only `navigation` has a Marketplace-level meaning. Every other top-level key is integration-owned metadata.

```json
{
  "navigation": [],
  "asset-risk": {
    "title": "Asset Risk",
    "columns": []
  },
  "deployment-status": {
    "title": "Deployment Status"
  }
}
```

Existing integrations use keys such as `dashboard`, `endpoints`, `vulnerabilities`, `history`, `settings`, and `customScreens`. Those are examples, not required screen types. A new integration can define `asset-risk`, `agent-deployment`, `license-usage`, or any other screen metadata that fits its domain.

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

## Optional View Metadata

Integration-owned React views can read any metadata shape from `display.json`. Use metadata to keep labels, columns, card definitions, thresholds, or query hints out of component code when that helps the integration stay maintainable.

The examples below are patterns used by existing integrations. They are not Marketplace-owned screen contracts.

## Dashboard Metadata

An integration dashboard can define any metadata its React view understands:

```json
{
  "dashboard": {
    "title": "Deployment Health",
    "description": "Current deployment state and operational signals.",
    "cards": [
      {
        "label": "Managed Devices",
        "metric": "managedDevices",
        "source": "intune_agent_state",
        "color": "#1D8EE6"
      }
    ],
    "sections": [
      {
        "id": "recent-failures",
        "title": "Recent Failures",
        "source": "intune_install_events"
      }
    ]
  }
}
```

The Marketplace does not require a `component` value and does not decide where dashboard metrics come from. The integration's React view can query its own integration tables, call Marketplace APIs, call custom action endpoints, or combine those sources.

For example, a vulnerability-management integration might choose to store summary metrics in its own `qualys_dashboard_metrics` table, while an Intune-style integration might read from `intune_app_state` or only from run history.

### Card Metadata

```json
{
  "label": "Open Findings",
  "metric": "openFindings",
  "source": "vendor_findings_summary",
  "color": "#111827",
  "to": "findings"
}
```

### Dashboard Sections

Section metadata is also integration-owned:

```json
{
  "id": "by-business-unit",
  "title": "Business Unit Distribution",
  "type": "bar-chart",
  "source": "vendor_business_unit_metrics"
}
```

## Endpoints Helper Metadata

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

## Vulnerabilities Helper Metadata

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

## History Helper Metadata

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

## Settings Helper Metadata

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

## Custom Action Screen Metadata

Custom action screen metadata is one pattern for a screen that contains integration-owned action buttons. The integration-owned React view renders the screen and calls Marketplace action endpoints, and the Marketplace dispatches those calls to handlers exported by the integration.

```json
{
  "navigation": [
    { "id": "actions-lab", "label": "Actions Lab", "path": "actions-lab", "icon": "FileText", "requiresWrite": true }
  ],
  "customScreens": {
    "actions-lab": {
      "title": "Actions Lab",
      "description": "Run integration-owned operations and display their results.",
      "actions": ["inspect-settings", "generate-summary", "runtime-diagnostics"]
    }
  }
}
```

Each action ID must also be declared in `manifest.json` and implemented by the integration entrypoint action map.

## Integration-Owned React Views

Every integration screen must be backed by React components under `ui/` and exported from `ui/index.jsx`.

```jsx
import Dashboard from './Dashboard.jsx';
import ActionsLab from './ActionsLab.jsx';

export const views = {
  dashboard: Dashboard,
  'actions-lab': ActionsLab
};
```

Every navigation path must have a matching view export. The Marketplace renders only integration-owned components for integration screens.

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
