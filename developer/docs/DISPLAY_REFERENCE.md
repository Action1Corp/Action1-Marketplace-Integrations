# Display Reference

`display.json` is intentionally small. It only tells the Marketplace which integration-owned screens should appear in the sidebar.

All screen layout, labels, columns, cards, buttons, empty states, and custom behavior belong in the integration's React files under `ui/`.

## Shape

```json
{
  "navigation": [
    { "id": "dashboard", "label": "Dashboard", "path": "dashboard", "icon": "Activity" },
    { "id": "history", "label": "History", "path": "history", "icon": "History" },
    { "id": "settings", "label": "Settings", "path": "settings", "icon": "Settings", "requiresWrite": true }
  ]
}
```

Fields:

- `id`: stable view identifier.
- `label`: sidebar label.
- `path`: route segment under `/apps/<integration_id>/`.
- `icon`: Marketplace icon name.
- `requiresWrite`: hides the screen from read-only users when true.

## React View Mapping

Every `navigation[].path` must have a matching export from `ui/index.jsx`.

```jsx
import Dashboard from './Dashboard.jsx';
import ActionsLab from './ActionsLab.jsx';
import History from './History.jsx';
import Settings from './Settings.jsx';

export const views = {
  dashboard: Dashboard,
  'actions-lab': ActionsLab,
  history: History,
  settings: Settings
};
```

For `/apps/acme-vm/dashboard`, the Marketplace asks the `acme-vm` package for the `dashboard` view and renders the matching React component. The Marketplace does not render dashboard cards, table columns, or settings fields from `display.json`.

## Screen Ownership

Put screen-specific details in the JSX component that renders the screen:

- Dashboard sections and metric cards belong in `ui/Dashboard.jsx`.
- Endpoint or finding table columns belong in the relevant table view component.
- Settings titles, buttons, validation messages, and schedule layout belong in `ui/Settings.jsx`.
- Custom action screens belong in their own React component, such as `ui/ActionsLab.jsx`.

The Marketplace still owns the shell, routing, authentication, authorization, settings storage, schedules, notifications, and runtime APIs. The integration owns the screens shown inside that shell.

## Custom Screens

Custom screens are just navigation entries plus React views.

```json
{
  "navigation": [
    { "id": "actions-lab", "label": "Actions Lab", "path": "actions-lab", "icon": "FileText", "requiresWrite": true }
  ]
}
```

```jsx
import ActionsLab from './ActionsLab.jsx';

export const views = {
  'actions-lab': ActionsLab
};
```

If the screen has buttons that call integration-owned backend actions, declare those actions in `manifest.json`, implement the handlers in the integration package, and call the Marketplace action endpoint from the React view.
