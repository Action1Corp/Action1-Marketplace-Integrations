# Rapid7 InsightVM

Import Rapid7 asset risk scores into Action1.

## Files

- `manifest.json` - Marketplace metadata, `marketplaceActions`, and settings schema.
- `display.json` - Integration-owned navigation, dashboards, and display definitions.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- Validation handler - Optional integration-owned credential validation logic.
- Run handler - Optional integration-owned job logic for collecting and writing integration data.

## Marketplace Actions

- `sync`
- `validate`
- `history`
- `schedule`

## Integration-Owned Views

- dashboard
- endpoints
- vulnerabilities
- history
- settings
