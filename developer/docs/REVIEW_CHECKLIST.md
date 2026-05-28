# Integration Review Checklist

Use this checklist before merging an integration pull request.

## Required Checks

- `npm test` passes.
- Folder name matches `manifest.id`.
- `manifest.json` is valid JSON.
- `display.json` is valid JSON when present.
- `marketplaceApiVersion` is supported.
- `minimumMarketplaceVersion` is accurate.
- The integration does not declare Marketplace-owned Action1 settings:
  - `Action1APIKey`
  - `Action1APISecret`
  - `Action1OrgID`
- No integration imports Marketplace backend internals directly.
- No secrets, credentials, tokens, tenant IDs, or customer data are committed.

## Manifest Review

- Metadata is clear and customer-facing.
- `category` is appropriate.
- `hostServices` only includes services the integration supports.
- `schedule` is not declared unless `sync` is also declared.
- Required settings are marked `required`.
- Sensitive settings use `type: "secret"`.
- Select settings define valid options.

## Display Review

- Navigation only includes views the integration supports.
- Settings navigation uses `hostService: "settings"` and `requiresWrite: true`.
- History navigation uses `hostService: "history"` when history is declared.
- Dashboard metadata matches the integration-owned React view that consumes it.
- Columns and cards map to real integration-owned data sources.
- Column labels are clear to a customer.
- Empty states and search placeholders are useful.

## Schema Review

- Migration filenames use `001_description.sql` format.
- Tables are integration-prefixed.
- Helper views have the integration-owned tables and columns they expect.
- Indexes exist for run ID and common filters.
- Migrations are additive after release.
- Integration does not alter Marketplace-owned framework tables.

## Handler Review

- Validation handler exists only when the integration declares the validation action.
- Run handler exists only when the integration declares the run action.
- Handlers use `context` and `sdk/` helpers.
- Sync creates, updates, and completes/fails run history.
- Sync catches errors and records meaningful failure details.
- Vendor API calls have timeouts or bounded pagination.
- Large API responses are not stored blindly unless needed.
- Logs avoid secrets and sensitive customer data.

## Runtime Review

- Integration works in a local mounted Marketplace container.
- Settings save correctly.
- Validation reports success and failure accurately.
- Manual sync succeeds with valid credentials.
- Manual sync fails cleanly with bad credentials.
- Failure appears in History and Dashboard.
- Failure notifications can use Marketplace email/webhook settings.
- Read-only users cannot perform write actions.

## Documentation Review

- Integration `README.md` explains vendor prerequisites.
- Required vendor permissions/scopes are listed.
- Setup steps are customer-readable.
- Known limits and unsupported modes are documented.
- Any vendor rate-limit considerations are documented.

