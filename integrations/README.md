# Runtime Integrations

Each folder in this directory is loaded by the Marketplace runtime, unless the folder name starts with `_`.

Each integration should include:

- `manifest.json` for metadata, settings, and `marketplaceActions`
- `display.json` for integration-owned navigation and views
- `migrations/` for integration-owned database schema
- `index.js` as the Marketplace entrypoint
- optional integration-owned `validate.js` handler when the integration declares `validate`
- optional integration-owned `sync.js` handler when the integration declares `sync`
- `README.md` for setup notes and required vendor permissions

Developer examples and design notes belong under `developer/`, not in this runtime directory.
