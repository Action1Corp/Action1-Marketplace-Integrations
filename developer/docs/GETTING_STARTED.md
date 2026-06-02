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
    settingsSchema.json
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
- `actions`, when the integration exposes integration-owned operations

Do not declare runtime capabilities in the manifest. The Marketplace infers behavior from the files and handlers the integration provides.

Do not redeclare Marketplace-owned Action1 credentials. Use `context.action1.getCredentials()` when the integration needs Action1 API access.

## 3. Define Settings

Settings in `ui/settingsSchema.json` are vendor-specific configuration fields owned by the integration. The integration settings view can import this file to render controls, and the Marketplace backend reads it to protect secret values.

```json
[
  {
    "key": "AcmeApiToken",
    "label": "API Token",
    "type": "secret",
    "group": "ACME Configuration",
    "required": true
  }
]
```

Supported types:

- `text`
- `url`
- `secret`
- `select`
- `number`
- `checkbox`

Use `secret` for tokens, passwords, client secrets, private keys, and app passwords.

## 4. Define Screens

Edit `display.json` to declare only the integration-owned navigation shown in the Marketplace sidebar.

Example screen paths used by existing integrations:

- `dashboard`
- `endpoints`
- `vulnerabilities`
- `history`
- `settings`

These are examples, not required screen names. An integration can define any route-safe screen path, such as `asset-risk`, `deployment-status`, or `license-usage`.

Every visible screen path must also have a matching React view exported from `ui/index.jsx`.

Put screen titles, columns, cards, buttons, and empty states in the React views under `ui/`. See `DISPLAY_REFERENCE.md` for the full display contract.

## 5. Define Database Tables

Add integration-owned tables in `migrations/*.sql`.

For a vulnerability-management integration, you might create tables such as:

```text
<integration_id>_endpoints
<integration_id>_endpoint_cves
```

When an integration follows the common endpoint/CVE naming pattern, these table names are exposed at runtime:

```js
const { endpoints, endpointCves } = context.db.tables;
```

See `SCHEMA_REFERENCE.md` for required columns.

## 6. Implement Actions

Define integration-owned operations in `manifest.json`, then export matching handlers from the entrypoint.

Actions are tracked in Marketplace history by default and can be monitored for failure notifications. Handler code receives `request.run` helpers:

```js
module.exports = {
  actions: {
    "check-configuration": async (context, request) => {
      await request.run?.appendLog("Checking vendor configuration.");
      return { ok: true, message: "Configuration is valid." };
    }
  }
};
```

Set `history: false` on a manifest action only when it should not appear in run history.

## 7. Implement Validation Or Run Compatibility Hooks

Existing Marketplace screens still support optional exported `validate` and `sync`/`runSync` handlers. Use these compatibility hooks when an integration needs the standard settings validation button, "Run Sync Now" button, or scheduler wiring.

For new developer apps, prefer manifest actions for integration-owned operations. The Marketplace sends failure notifications automatically for failed tracked actions, manual runs, and scheduled runs.

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

