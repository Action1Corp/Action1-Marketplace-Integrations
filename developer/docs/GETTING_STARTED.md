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
  validate.js
  sync.js
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

For standard vulnerability management views, create:

```text
<integration_id>_endpoints
<integration_id>_endpoint_cves
```

Use the table names exposed at runtime:

```js
const { endpoints, endpointCves } = context.db.tables;
```

See `SCHEMA_REFERENCE.md` for required columns.

## 6. Implement Validation

If `marketplaceActions` includes `validate`, export a validation handler.

```js
async function validate(context) {
  const apiToken = context.settings.get("AcmeApiToken");

  return {
    "acme-vm": {
      ok: Boolean(apiToken),
      message: apiToken ? "Configuration present" : "Missing API token"
    }
  };
}

module.exports = { validate };
```

Validation should check vendor credentials and any required base URL or region. If the integration also needs Action1 access, use:

```js
const { apiKey, apiSecret, organizationId } = await context.action1.getCredentials();
```

## 7. Implement Sync

If `marketplaceActions` includes `sync`, export a sync handler.

```js
const {
  createSyncRun,
  appendSyncLog,
  completeSyncRun,
  failSyncRun
} = require("../../sdk");

async function sync(context) {
  const runId = await createSyncRun(context);
  let details = "Started sync\n";

  try {
    details = await appendSyncLog(context, runId, details, "Fetching vendor assets...");

    const { endpoints } = context.db.tables;
    await context.db.run(
      `INSERT INTO ${endpoints} (integration_id, run_id, endpoint_name)
       VALUES (?, ?, ?)`,
      [context.integrationId, runId, "example-endpoint"]
    );

    await completeSyncRun(context, runId, details, 1);
  } catch (error) {
    await failSyncRun(context, runId, details, error);
  }
}

module.exports = { sync };
```

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

