# Runtime Integrations

Each folder in this directory is loaded by the Marketplace runtime, unless the folder name starts with `_`.

Each integration should include:

- `manifest.json` for metadata, settings, and Marketplace service capabilities
- `display.json` for integration-owned navigation and views
- `migrations/` for integration-owned database schema
- `index.js` as the Marketplace entrypoint
- optional `validate.js` for credential validation
- optional `sync.js` for sync behavior
- `README.md` for setup notes and required vendor permissions

Developer examples and design notes belong under `developer/`, not in this runtime directory.
