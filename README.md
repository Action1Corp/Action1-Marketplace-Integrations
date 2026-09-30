# Action1 Marketplace Integrations

This private repository contains downloadable integration packages for the Action1 Integration Marketplace. Packages are built as immutable `.tgz` artifacts, published to GitHub Releases, listed in the integration catalog, and installed by Marketplace admins at runtime.

The goal is to let integration developers build and maintain vendor integrations without changing the Marketplace application itself.

## Repository Layout

```text
integrations/
  vendor-id/
    manifest.json
    display.json
    index.js
    optional handler modules
    ui/
      index.jsx
      settingsSchema.json
      view components
    ui-dist/
      remote.js
    migrations/
      001_create_schema.sql
    docs/
      index.json
      user-guide.pdf
    README.md

developer/
  docs/
  examples/

sdk/
scripts/
tests/
```

## Ownership Model

The Marketplace owns the host framework:

- authentication and organization roles
- setup and deployment behavior
- integration catalog loading
- settings and secret storage APIs
- shared Action1 API credentials
- SMTP and webhook failure notification framework
- action endpoint dispatch for integration-owned custom actions
- per-integration schedules
- shared framework tables such as settings, run history, schedules, auth, CVE metadata, and migration tracking

Each integration owns its vendor-specific behavior:

- catalog metadata in `manifest.json`
- Marketplace sidebar navigation in `display.json`
- settings schema in `ui/settingsSchema.json`
- React views for every visible screen in `ui/`
- optional validation action for credential checks
- optional sync/run action for vendor jobs, collection, or synchronization
- custom actions and matching action handlers
- vendor API calls and data mapping
- integration-owned database schema in `migrations/*.sql`
- setup notes and required vendor permissions in `README.md`
- customer documentation in `README.md` or `docs/index.json` with Markdown/PDF files

Integrations should use the provided runtime `context` and helpers from `sdk/`. They must not import Marketplace backend internals directly.

## Marketplace Documentation

The Marketplace automatically shows an integration's root `README.md` as its Overview document. To publish multiple documents or an illustrated PDF guide, add `docs/index.json` inside that integration folder:

```json
{
  "documents": [
    {
      "id": "user-guide",
      "title": "User Guide",
      "description": "Setup and daily use.",
      "file": "user-guide.pdf"
    }
  ]
}
```

Place each listed `.md` or `.pdf` file directly in `docs/`. IDs use lowercase letters, numbers, and hyphens. The package build copies the files automatically; the Marketplace serves only files listed in the index. Keep Markdown under 1 MB and PDFs under 20 MB. If `docs/index.json` exists, it replaces the README fallback. Bump the integration version when changing published documentation so an updated package can be released.

## Create An Integration

From the repository root:

```bash
npm run create-integration -- my-integration
npm test
```

The scaffold creates a complete starting point:

- `manifest.json`
- `display.json`
- `index.js`
- `actions.js` for manifest action handlers
- `ui/index.jsx` and any view components
- `ui/settingsSchema.json`
- `migrations/001_create_schema.sql`
- `README.md`

Use `developer/examples/hello-integration` as the smallest complete example. Files under `developer/` are documentation and examples only; they are not loaded by the Marketplace runtime.

For a step-by-step walkthrough, start with `developer/docs/GETTING_STARTED.md`.

## Development Checklist

Before opening a pull request:

1. Keep all vendor-specific code inside the integration folder.
2. Define required settings in `ui/settingsSchema.json`.
3. Define sidebar navigation in `display.json`.
4. Export one React view for every visible screen from `ui/index.jsx`.
5. Define any required database tables in `migrations/*.sql`.
6. Use integration-prefixed table names.
7. Use Marketplace-level Action1 credentials through `context.action1.getCredentials()`.
8. Use `context` and `sdk/` helpers instead of importing Marketplace internals.
9. Run:

```bash
npm test
npm run package:all
```

## Reference Docs

- `developer/docs/GETTING_STARTED.md`
- `developer/docs/MARKETPLACE_INTEGRATION_API.md`
- `developer/docs/DEVELOPER_CONTRACT.md`
- `developer/docs/DISPLAY_REFERENCE.md`
- `developer/docs/SCHEMA_REFERENCE.md`
- `developer/docs/LOCAL_TESTING.md`
- `developer/docs/NOTIFICATION_WEBHOOKS.md`
- `developer/docs/REVIEW_CHECKLIST.md`
- `developer/docs/INTEGRATION_REPO_STRATEGY.md`

