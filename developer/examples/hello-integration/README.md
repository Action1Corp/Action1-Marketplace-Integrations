# Hello Integration

This is a minimal example integration for developers. It demonstrates the Marketplace integration lifecycle without calling a real vendor API.

## What It Demonstrates

- `manifest.json` metadata and settings
- `display.json` navigation, dashboard, history, settings, and schedule metadata
- `validate(context)`
- `sync(context)`
- `migrations/001_create_schema.sql`
- Marketplace SDK helpers from `../../../sdk`

## Behavior

The sync handler writes a short run-history entry only. It does not collect vendor data.

The migration file demonstrates integration-owned endpoint and vulnerability tables for the standard metric dashboard renderer. Real integrations should define the database tables they need in `migrations/*.sql`.

## Validation

Run repository checks after copying or modifying this example:

```bash
npm test
```
