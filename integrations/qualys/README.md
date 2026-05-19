# Qualys VMDR

Ingest Qualys scan findings into Action1.

## Files

- `manifest.json` - Marketplace metadata, service capabilities, and settings schema.
- `display.json` - Integration-owned navigation, dashboards, and display definitions.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- `validate.js` - Optional Marketplace validation handler for configured credentials.
- `sync.js` - Optional Marketplace sync handler for collecting and writing integration data.

## Marketplace Service Capabilities

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
