# Build Your First Integration

This guide walks through creating, running, and submitting a new Action1 Integration Marketplace package.

## Prerequisites

- Node.js installed locally.
- Access to this integrations repository.
- A local Marketplace container that can mount this repository during development.
- Vendor API credentials for the product you are integrating.

## 1. Create The Scaffold

From the repository root:

```bash
npm run create-integration -- acme-vm
```

This creates:

```text
integrations/acme-vm/
  manifest.json
  display.json
  index.js
  optional handler modules
  ui/
    index.jsx
    view components
  migrations/
    001_create_schema.sql
  README.md
```

Use lowercase kebab-case for integration IDs. The folder name and `manifest.id` must match.

## 2. Update Metadata

Edit `integrations/acme-vm/manifest.json`.

Required fields:

- `id`
- `name`
- `vendor`
- `version`
- `marketplaceApiVersion`
- `minimumMarketplaceVersion`
- `description`
- `category`
- `marketplaceActions`
- `actions`, when the integration exposes custom host-screen actions
- `settings`

Only declare Marketplace services the integration actually supports.

```json
{
  "marketplaceActions": ["settings", "validate", "sync", "history", "schedule"]
}
```

If the integration has no sync job, omit `sync`, `history`, and `schedule`.

Do not declare these shared Marketplace settings:

- `Action1APIKey`
- `Action1APISecret`
- `Action1OrgID`

Use `context.action1.getCredentials()` when the integration needs Action1 API access.

## 3. Define Settings

Settings in `manifest.json` are vendor-specific configuration fields rendered by the Marketplace.

```json
{
  "key": "AcmeApiToken",
  "label": "API Token",
  "type": "secret",
  "group": "ACME Configuration",
  "required": true
}
```

Supported types:

- `text`
- `url`
- `secret`
- `select`
- `number`
- `checkbox`

Use `secret` for tokens, passwords, client secrets, private keys, and app passwords.

## 4. Define Views

Edit `display.json` to declare the integration-owned tabs and UI behavior.

Common tabs:

- `dashboard`
- `endpoints`
- `vulnerabilities`
- `history`
- `settings`

Visible screens are defined in `display.json`, not in `marketplaceActions`.

See `DISPLAY_REFERENCE.md` for the full display contract.

## 5. Define Database Tables

Add integration-owned tables in `migrations/*.sql`.

For vulnerability-management integrations that use the shared helper views, create:

```text
<integration_id>_endpoints
<integration_id>_endpoint_cves
```

Use the table names exposed at runtime:

```js
const { endpoints, endpointCves } = context.db.tables;
```

See `SCHEMA_REFERENCE.md` for required columns.

## 6. Implement Validation Logic

If the integration declares the validation action, export an integration-owned validation handler.

Validation should check vendor credentials and any required base URL or region. If the integration also needs Action1 access, use:

```js
const { apiKey, apiSecret, organizationId } = await context.action1.getCredentials();
```

## 7. Implement Run Logic

If the integration declares the run action, export an integration-owned run handler.

Use the `sdk/` run-history helpers to create, update, complete, and fail run-history entries consistently.

The Marketplace sends failure notifications automatically for failed manual and scheduled sync runs.

## 8. Test Locally

Run validation:

```bash
npm test
```

Then mount the integrations repository into a Marketplace development container. See `LOCAL_TESTING.md`.

## 9. Submit For Review

Before opening a pull request:

```bash
npm test
```

Then follow `REVIEW_CHECKLIST.md`.
