# Action1 Marketplace Integrations

This private repository contains integration packages for the Action1 Integration Marketplace. The Marketplace host loads these packages at startup and uses them to render integration-specific screens, collect settings, validate credentials, run sync jobs, and apply integration-owned database migrations.

The goal is to let integration developers build and maintain vendor integrations without changing the Marketplace application itself.

## Repository Layout

```text
integrations/
  vendor-id/
    manifest.json
    display.json
    index.js
    validate.js
    sync.js
    migrations/
      001_create_schema.sql
    README.md

developer/
  docs/
  examples/

sdk/
scripts/
tests/
```

## Ownership Model

The Marketplace owns the host framework:

- authentication and organization roles
- setup and deployment behavior
- integration catalog loading
- settings forms and secret masking
- shared Action1 API credentials
- SMTP and webhook failure notification framework
- validation and sync button wiring
- per-integration schedules
- standard renderers for dashboards, tables, history, and settings
- shared framework tables such as settings, sync history, schedules, auth, CVE metadata, and migration tracking

Each integration owns its vendor-specific behavior:

- metadata and `marketplaceActions` in `manifest.json`
- navigation, tabs, dashboard sections, labels, and columns in `display.json`
- optional credential validation in `validate.js`
- optional sync behavior in `sync.js`
- vendor API calls and data mapping
- integration-owned database schema in `migrations/*.sql`
- setup notes and required vendor permissions in `README.md`

Integrations should use the provided runtime `context` and helpers from `sdk/`. They must not import Marketplace backend internals directly.

## Create An Integration

From the repository root:

```bash
npm run create-integration -- my-integration
npm test
```

The scaffold creates a complete starting point:

- `manifest.json`
- `display.json`
- `index.js`
- `validate.js`
- `sync.js`
- `migrations/001_create_schema.sql`
- `README.md`

Use `developer/examples/hello-integration` as the smallest complete example. Files under `developer/` are documentation and examples only; they are not loaded by the Marketplace runtime.

For a step-by-step walkthrough, start with `developer/docs/GETTING_STARTED.md`.

## Development Checklist

Before opening a pull request:

1. Keep all vendor-specific code inside the integration folder.
2. Define required settings in `manifest.json`.
3. Define visible screens in `display.json`.
4. Define any required database tables in `migrations/*.sql`.
5. Use integration-prefixed table names.
6. Use Marketplace-level Action1 credentials instead of redefining `Action1APIKey`, `Action1APISecret`, or `Action1OrgID`.
7. Use `context` and `sdk/` helpers instead of importing Marketplace internals.
8. Run:

```bash
npm test
```

## Reference Docs

- `developer/docs/GETTING_STARTED.md`
- `developer/docs/MARKETPLACE_INTEGRATION_API.md`
- `developer/docs/DEVELOPER_CONTRACT.md`
- `developer/docs/DISPLAY_REFERENCE.md`
- `developer/docs/SCHEMA_REFERENCE.md`
- `developer/docs/LOCAL_TESTING.md`
- `developer/docs/NOTIFICATION_WEBHOOKS.md`
- `developer/docs/REVIEW_CHECKLIST.md`
- `developer/docs/INTEGRATION_REPO_STRATEGY.md`
