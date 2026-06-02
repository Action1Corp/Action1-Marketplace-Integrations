# Integration Template

Use this folder as a reference for the minimum files an integration package should provide.

Template folders are ignored by the Marketplace runtime because the directory name starts with `_`.

Recommended files:

- `manifest.json` for catalog metadata
- `ui/settingsSchema.json` for settings
- `display.json` for Marketplace sidebar navigation
- `migrations/` for integration-owned database schema
- `index.js` as the Marketplace entrypoint
- optional manifest actions plus matching integration-owned action handlers
- optional compatibility validation/run handlers for integrations that need legacy Marketplace lifecycle hooks
- `README.md` for setup requirements and vendor permissions

