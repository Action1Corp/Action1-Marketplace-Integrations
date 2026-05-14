# Microsoft Intune

Sync Intune managed devices and compliance status with Action1.

## Files

- `manifest.json` - Marketplace metadata, capabilities, and settings schema.
- `display.json` - Integration-owned dashboard and display definitions.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- `validate.js` - Optional Marketplace validation handler for configured credentials.
- `sync.js` - Optional Marketplace sync handler for collecting and writing integration data.

## Capabilities

- `sync`
- `validate`
- `dashboard`
- `history`
- `schedule`
