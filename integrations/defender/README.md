# Microsoft Defender

Correlates Microsoft Defender vulnerabilities with Action1 endpoint and patch context for shared dashboards.

## Files

- `manifest.json` - Marketplace catalog metadata.
- `display.json` - Marketplace sidebar navigation for integration-owned screens.
- ui/settingsSchema.json - Integration-owned settings schema.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace action handlers.
- Validation action - Integration-owned credential validation logic declared in `manifest.json`.
- Sync action - Integration-owned job logic for collecting and writing integration data declared in `manifest.json`.

## Runtime Behavior

The Marketplace infers supported operations from this integration's files, manifest actions, and exported action handlers:

- Settings are available because this package provides `ui/settingsSchema.json` and a settings view.
- Credential validation is available because this package declares a validation action and exports the matching action handler.
- Manual runs and scheduling are available because this package declares a sync action and exports the matching action handler.
- Run history is available to integration-owned views through Marketplace APIs.

## Integration-Owned Views

- dashboard
- endpoints
- vulnerabilities
- history
- settings
