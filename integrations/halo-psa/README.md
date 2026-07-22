# Halo Psa

This integration was generated with `npm run create-integration -- halo-psa`.

## Runtime Behavior

The Marketplace infers supported operations from the handlers and UI files this package provides:

- `ui/settingsSchema.json` and the settings view enable integration settings.
- Manifest `actions` and exported action handlers define integration-owned operations.
- Tracked actions are written to Marketplace history and monitored for failures by default.
- A history view can read Marketplace action/run history for this integration.

Visible screens are declared in `display.json` navigation and rendered by React views exported from `ui/index.jsx`.
Every visible screen must also have a matching integration-owned React view exported from `ui/index.jsx`.

HaloPSA durable Marketplace setting keys are intentionally namespaced with the `HaloPsa` prefix because the Marketplace host stores integration settings in one flat global key/value table.

The Settings screen keeps Ticket Routing and Existing Open Ticket Behavior together in one `Ticket Routing & Lifecycle` section. Routing fields use concise labels, tooltip-style help, readable discovery labels, and a custom closed-status multi-select while still storing Halo IDs durably in Marketplace settings.

The HaloPSA connection section now follows a compact configured-state pattern: when required connection settings are already present, the form collapses to a safe summary with `Change Settings` and `Test Connection`, while keeping the stored client secret masked unless a new value is entered.

The Signal Filters area now follows the standalone connector more closely: core endpoint signal toggles, vulnerability/update severity and remediation filters, the shared ticket-creation-mode control, grouped-ticket endpoint limit, and the max-open-ticket safeguard now appear in one visible `Signal Filters` section, while internal/default-only controls stay hidden from operators.

The `Client Mapping` screen now follows the standalone connector more closely: one row-based mapping table lets operators refresh discovery, add mapping rows, choose Action1 organizations and HaloPSA clients from dropdowns, remove rows directly, and save DB-backed mappings that continue to live in `halo_psa_org_client_mappings`. IDs stay hidden from the main UI, mappings remain active by existence instead of an `Enabled` toggle, sanitized discovery diagnostics still appear in temporary `Technical details` sections when discovery fails, and Halo client discovery now walks paginated `/Client` results with bounded safety checks so multi-page tenants are not truncated at the first Halo response page.

## Next Steps

1. Update `manifest.json` metadata and category.
2. Update manifest `actions` for the operations this integration owns.
3. Implement matching action handlers in `actions.js`.
4. Update `migrations/001_create_schema.sql` with this integration's private tables.
5. Update `ui/settingsSchema.json` with this integration's settings.
6. Update `display.json` to define only the sidebar navigation for this integration.
7. Update `ui/index.jsx` and add React view components for every visible screen.
8. Run `npm test` from the repository root.
