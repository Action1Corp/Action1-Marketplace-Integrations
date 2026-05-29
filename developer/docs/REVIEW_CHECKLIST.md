# Integration Review Checklist

Use this checklist before merging an integration pull request.

## Required Checks

- `npm test` passes.
- Folder name matches `manifest.id`.
- `manifest.json` is valid JSON.
- `display.json` is valid JSON when present.
- `marketplaceApiVersion` is supported.
- `minimumMarketplaceVersion` is accurate.
- The integration does not declare Marketplace-owned Action1 credential settings.
- No integration imports Marketplace backend internals directly.
- No secrets, credentials, tokens, tenant IDs, or customer data are committed.

## Manifest Review

- Metadata is clear and customer-facing.
- `category` is appropriate.
- Runtime behavior is inferred from integration-owned files and exported handlers.
- `schedule` is not declared unless `sync` is also declared.
- Required settings are marked `required`.
- Sensitive settings use `type: "secret"`.
- Select settings define valid options.

## Display Review

- Navigation only includes views the integration supports.
- Settings navigation uses `requiresWrite: true`.
- History navigation points to a history view when the integration exposes one.
- `display.json` only contains Marketplace navigation.
- Dashboard cards, table columns, labels, empty states, and custom buttons are defined in integration-owned React views.
- Screen labels are clear to a customer.

## Schema Review

- Migration filenames use `001_description.sql` format.
- Tables are integration-prefixed.
- React views have the integration-owned tables and columns they expect.
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

