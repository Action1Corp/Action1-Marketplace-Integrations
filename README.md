# Action1 Marketplace Integrations Dev

Private development repository for Marketplace integrations.

This repo holds integration packages that can be loaded by the Action1 Integration Marketplace. Each integration owns its manifest, validation handler, and sync handler.

## Target Integration Shape

```text
integrations/
  vendor-id/
    manifest.json
    index.js
    README.md
```

See `INTEGRATION_REPO_STRATEGY.md` for the proposed contract, migration plan, and packaging approach.

See `MARKETPLACE_INTEGRATION_API.md` for the versioned API contract and `DEVELOPER_CONTRACT.md` for developer guidance.

Run validation before opening a pull request:

```bash
npm test
```
