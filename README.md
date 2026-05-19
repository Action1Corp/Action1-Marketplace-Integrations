# Action1 Marketplace Integrations Dev

Private development repository for Marketplace integrations.

This repo holds integration packages loaded by the Action1 Integration Marketplace. Each integration owns its manifest, display definition, validation handler, sync handler, and developer README.

## Create an Integration

```bash
npm run create-integration -- my-integration
npm test
```

The scaffold creates:

- `manifest.json`
- `display.json`
- `index.js`
- `validate.js`
- `sync.js`
- `migrations/001_create_schema.sql`
- `README.md`

Use `developer/examples/hello-integration` as the smallest complete example. Files under `developer/` are not loaded by the Marketplace runtime.

## Ownership Boundary

The Marketplace owns:

- navigation hosting
- settings forms
- credential validation button wiring
- manual sync button wiring
- per-integration schedules
- dashboard, endpoint, vulnerability, and history renderers

The integration owns:

- metadata and Marketplace service capabilities in `manifest.json`
- tabs, labels, columns, and dashboard sections in `display.json`
- optional `validate(context)`
- optional `sync(context)`
- integration-owned database migrations in `migrations/*.sql`
- vendor API calls and data mapping

Integration developers should use the runtime `context` and helpers from `sdk/`. Do not import Marketplace backend internals.

## References

- `developer/docs/MARKETPLACE_INTEGRATION_API.md`
- `developer/docs/DEVELOPER_CONTRACT.md`
- `developer/docs/INTEGRATION_REPO_STRATEGY.md`

Run validation before opening a pull request:

```bash
npm test
```
