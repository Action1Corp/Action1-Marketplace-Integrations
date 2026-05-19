# Hello Integration

This is a minimal example integration for developers.

It demonstrates:

- `manifest.json` metadata and settings
- `display.json` navigation, dashboard, history, settings, and schedule metadata
- `validate(context)`
- `sync(context)`
- `migrations/001_create_schema.sql`
- use of the Marketplace SDK helpers in `../../../sdk`

The sync handler intentionally does not call any vendor API. It only writes a short run history entry so developers can test the Marketplace integration lifecycle quickly.

The migration file demonstrates an integration-owned table. Real integrations should define their private storage needs in `migrations/*.sql`; the Marketplace applies those migrations at startup and records them in its migration ledger.

Run repository checks after copying or modifying this example:

```bash
npm test
```
