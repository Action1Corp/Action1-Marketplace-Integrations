# Hello Integration

This is a minimal example integration for developers. It demonstrates the Marketplace integration lifecycle without calling a real vendor API.

## What It Demonstrates

- `manifest.json` catalog metadata
- `ui/settingsSchema.json` integration-owned settings fields
- `display.json` navigation, dashboard, history, settings, and schedule metadata
- Marketplace runtime services through `context` and HTTP APIs
- optional validation handler exported by the integration
- optional run handler exported by the integration
- custom integration-owned action declared in `manifest.json`
- custom action handler exported from `actions.js`
- custom action screen defined in `display.json`
- integration-owned React views in `ui/`
- `migrations/001_create_schema.sql`
- Marketplace SDK helpers from `../../../sdk`

## Behavior

The run handler writes a short run-history entry only. It does not collect vendor data.

The custom `check-configuration` action appears on the settings page because it is declared in `manifest.json` with `"placement": "settings"`. When a user clicks the button, the Marketplace posts to the integration action endpoint and dispatches the request to the matching handler exported from `actions.js`.

The `Actions Lab` screen demonstrates a custom integration-owned screen. It is added to navigation in `display.json`, defined under `customScreens.actions-lab`, and populated with three action IDs. Each ID maps to an action declared in `manifest.json`, and each action is implemented in `actions.js`.

The `ui/` folder demonstrates integration-owned React screens. When the Marketplace build includes this integration package, `ui/index.jsx` exports a `views` map. Each matching view, such as `dashboard` or `actions-lab`, is rendered by the integration component.

The Marketplace runtime services are different from integration screens:

- The settings view can call the validation endpoint, which dispatches to the exported validation handler.
- The UI or scheduler can start a run, which dispatches to the exported run handler.
- Integration-owned views can read Marketplace run history.
- The Marketplace stores schedule configuration and uses it to call the same run handler.

The migration file demonstrates integration-owned endpoint and vulnerability tables. Real integrations should define the database tables their own React views and handlers need in `migrations/*.sql`.

## Validation

Run repository checks after copying or modifying this example:

```bash
npm test
```

