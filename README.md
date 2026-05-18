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
- `README.md`

Use `integrations/hello-integration` as the smallest complete example.

## Ownership Boundary

The Marketplace owns:

- navigation hosting
- settings forms
- credential validation button wiring
- manual sync button wiring
- per-integration schedules
- dashboard, endpoint, vulnerability, and history renderers

The integration owns:

- metadata and capabilities in `manifest.json`
- tabs, labels, columns, and dashboard sections in `display.json`
- optional `validate(context)`
- optional `sync(context)`
- vendor API calls and data mapping

Integration developers should use the runtime `context` and helpers from `sdk/`. Do not import Marketplace backend internals.

## References

- `MARKETPLACE_INTEGRATION_API.md`
- `DEVELOPER_CONTRACT.md`
- `INTEGRATION_REPO_STRATEGY.md`

Run validation before opening a pull request:

```bash
npm test
```
