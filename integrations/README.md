# Runtime Integrations

Each folder in this directory is loaded by the Marketplace runtime, unless the folder name starts with `_`.

Each integration should include:

- `manifest.json` for catalog metadata
- `ui/settingsSchema.json` for integration-owned settings fields
- `display.json` for Marketplace sidebar navigation
- `migrations/` for integration-owned database schema
- `index.js` as the Marketplace entrypoint
- optional integration-owned validation action and matching handler
- optional integration-owned sync/run action and matching handler
- `README.md` for setup notes and required vendor permissions

Developer examples and design notes belong under `developer/`, not in this runtime directory.

