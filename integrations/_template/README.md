# Integration Template

Use this folder as a reference for the minimum files an integration package should provide.

Template folders are ignored by the Marketplace runtime because the directory name starts with `_`.

Recommended files:

- `manifest.json` for metadata, settings, and `marketplaceActions`
- `display.json` for integration-owned navigation and views
- `migrations/` for integration-owned database schema
- `index.js` as the Marketplace entrypoint
- optional integration-owned `validate.js` handler when the integration declares `validate`
- optional integration-owned `sync.js` handler when the integration declares `sync`
- `README.md` for setup requirements and vendor permissions
