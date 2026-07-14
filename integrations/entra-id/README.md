# Entra ID

This integration was generated with `npm run create-integration -- entra-id`.

This package currently contains only the Marketplace shell scaffold for the Entra ID integration. Vendor-specific settings, mapping, sync logic, diagnostics, and custom attribute behavior are intentionally deferred to later child changes.

## Runtime Behavior

The Marketplace infers supported operations from the handlers and UI files this package provides:

- `ui/settingsSchema.json` and the settings view enable integration settings.
- Manifest `actions` and exported action handlers define integration-owned operations.
- Tracked actions are written to Marketplace history and monitored for failures by default.
- A history view can read Marketplace action/run history for this integration.

Visible screens are declared in `display.json` navigation and rendered by React views exported from `ui/index.jsx`.
Every visible screen must also have a matching integration-owned React view exported from `ui/index.jsx`.

## Next Steps

1. Update `manifest.json` metadata and category.
2. Update manifest `actions` for the operations this integration owns.
3. Replace the placeholder action handlers in `actions.js` with Entra-specific behavior in later slices.
4. Update `migrations/001_create_schema.sql` with this integration's private tables.
5. Update `ui/settingsSchema.json` with this integration's settings.
6. Update `display.json` to define only the sidebar navigation for this integration.
7. Update `ui/index.jsx` and add React view components for every visible screen.
8. Run `npm test` from the repository root.
