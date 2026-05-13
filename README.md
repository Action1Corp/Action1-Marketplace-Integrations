# Action1 Marketplace Integrations Dev

Temporary private development repository for Marketplace integrations.

This repo is intended to hold integration packages that can be loaded by the Action1 Integration Marketplace. The current `legacy-services` and `legacy-scripts` folders are seed material copied from the existing Marketplace app while the plugin contract is being built.

## Target Integration Shape

```text
integrations/
  vendor-id/
    manifest.json
    index.js
    README.md
```

See `INTEGRATION_REPO_STRATEGY.md` for the proposed contract, migration plan, and packaging approach.

See `DEVELOPER_CONTRACT.md` for the current handler API and optional capability model.
