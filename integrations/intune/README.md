# Microsoft Intune

Sync Intune managed devices and compliance status with Action1.

## Files

- `manifest.json` - Marketplace metadata, `marketplaceActions`, and settings schema.
- `display.json` - Integration-owned navigation, dashboards, and display definitions.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- Validation handler - Optional integration-owned credential validation logic.
- Run handler - Optional integration-owned job logic for collecting and writing integration data.

## Marketplace-Provided Actions

This integration declares the Marketplace host actions it wants the host to render and wire:

- `sync` - show a manual run action and call the integration-owned run handler.
- `validate` - show a credential validation action and call the integration-owned validation handler.
- `history` - show the Marketplace run history view for this integration.
- `schedule` - show Marketplace schedule controls and run this integration on its configured schedule.

These are host-provided action slots. Vendor-specific behavior, data mapping, screens, labels, and custom actions remain owned by the integration.

## Integration-Owned Views

- dashboard
- history
- settings
