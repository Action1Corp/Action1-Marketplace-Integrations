# CrowdStrike Falcon

Correlate CrowdStrike detections and vulns with Action1 inventory.

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
