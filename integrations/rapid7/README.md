# Rapid7 InsightVM

Correlates Rapid7 InsightVM exposure data with Action1 endpoint and patch context for shared dashboards.

## Files

- `manifest.json` - Marketplace catalog metadata.
- `display.json` - Marketplace sidebar navigation for integration-owned screens.
- ui/settingsSchema.json - Integration-owned settings schema.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- Validation handler - Optional integration-owned credential validation logic.
- Run handler - Optional integration-owned job logic for collecting and writing integration data.

## Runtime Behavior

The Marketplace infers supported operations from this integration's files and exported handlers:

- Settings are available because this package provides `ui/settingsSchema.json` and a settings view.
- Credential validation is available when the entrypoint exports a validation handler.
- Manual runs and scheduling are available when the entrypoint exports a run handler.
- Run history is available to integration-owned views through Marketplace APIs.

## Integration-Owned Views

- dashboard
- endpoints
- vulnerabilities
- history
- settings

