# Hello Integration

This is a minimal example integration for developers. It demonstrates the Marketplace integration lifecycle without calling a real vendor API.

## What It Demonstrates

- `manifest.json` metadata and settings
- `display.json` navigation, dashboard, history, settings, and schedule metadata
- Marketplace-provided actions through `marketplaceActions`
- validation handler for the Marketplace `validate` action
- run handler for the Marketplace `sync` and `schedule` actions
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

The `ui/` folder demonstrates integration-owned React screens. When the Marketplace build includes this integration package, `ui/index.jsx` exports a `views` map. Any matching view, such as `dashboard` or `actions-lab`, is rendered by the integration component instead of the Marketplace fallback renderer.

The Marketplace actions are different:

- `validate` displays the standard validation button and calls the exported validation handler.
- `sync` displays the standard run action and calls the exported run handler.
- `history` displays the Marketplace run history view.
- `schedule` displays schedule controls and calls the same run handler on the configured schedule.

The migration file demonstrates integration-owned endpoint and vulnerability tables for the standard metric dashboard renderer. Real integrations should define the database tables they need in `migrations/*.sql`.

## Validation

Run repository checks after copying or modifying this example:

```bash
npm test
```
