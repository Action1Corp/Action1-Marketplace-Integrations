# Qualys VMDR

Ingest Qualys scan findings into Action1.

## Files

- `manifest.json` - Marketplace metadata, capabilities, and settings schema.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- `validate.js` - Optional Marketplace validation handler for configured credentials.
- `sync.js` - Optional Marketplace sync handler for collecting and writing integration data.

## Capabilities

- `sync`
- `validate`
- `dashboard`
- `endpoints`
- `vulnerabilities`
- `history`
- `schedule`
