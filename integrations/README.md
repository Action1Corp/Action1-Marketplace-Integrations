# Integrations

Add one folder per Marketplace integration here.

Each integration should include:

- `manifest.json` for metadata, settings, required secrets, and Marketplace service capabilities
- `display.json` for integration-owned navigation and views
- `migrations/` for integration-owned database schema
- `index.js` for `validate()` and `sync()` handlers
- `README.md` for setup notes and required vendor permissions
