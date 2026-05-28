# Microsoft Defender

Connect Microsoft Defender for Endpoint vulnerabilities.

## Files

- `manifest.json` - Marketplace metadata, `marketplaceActions`, and settings schema.
- `display.json` - Integration-owned navigation, dashboards, and display definitions.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace handlers.
- Validation handler - Optional integration-owned credential validation logic.
- Run handler - Optional integration-owned job logic for collecting and writing integration data.

## Marketplace-Provided Actions

This integration declares the Marketplace services its integration-owned UI and handlers use:

- `sync` - allow manual or scheduled calls to the integration-owned run handler.
- `validate` - allow credential validation calls to the integration-owned validation handler.
- `history` - allow the integration-owned UI to read Marketplace run history for this integration.
- `schedule` - allow the Marketplace scheduler to run this integration on its configured schedule.

These are host services. Vendor-specific behavior, data mapping, screens, labels, and custom actions remain owned by the integration.

## Integration-Owned Views

- dashboard
- endpoints
- vulnerabilities
- history
- settings
