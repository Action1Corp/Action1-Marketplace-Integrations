# Integration Template

Use this folder as a reference for the minimum files an integration package should provide.

Template folders are ignored by the Marketplace runtime because the directory name starts with `_`.

Recommended files:

- `manifest.json` for catalog metadata
- `ui/settingsSchema.json` for settings
- `display.json` for Marketplace sidebar navigation
- `migrations/` for integration-owned database schema
- `index.js` as the Marketplace entrypoint
- optional integration-owned validation handler when the integration declares the validation action
- optional integration-owned run handler when the integration declares the run action
- `README.md` for setup requirements and vendor permissions

