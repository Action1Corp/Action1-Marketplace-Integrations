# Local Testing Guide

This guide explains how to test integrations against a local Marketplace environment. There are two local workflows:

- Repository validation and package building with `npm test` and `npm run package:all`.
- Runtime installation testing with a local package catalog and a Marketplace container.

## Validate The Integration Repository

From the integrations repository root:

```bash
npm test
```

This checks:

- manifest shape
- inferred runtime behavior from handlers and UI files
- sidebar navigation
- migration naming
- standard table requirements
- handler exports

## Build Downloadable Packages

From the integrations repository root:

```bash
npm run package:all
```

This writes package artifacts under `dist/integrations/`. Each package includes backend handlers, migrations, settings schema, and compiled `ui-dist/remote.js`.

## Run Marketplace With A Local Package Catalog

From the Marketplace repository, serve the package directory:

```bash
node scripts/serve-local-integration-catalog.js ../action1-marketplace-integrations-dev/dist/integrations
```

Run the Marketplace container with:

```env
INTEGRATION_CATALOG_URL=http://host.docker.internal:4199/catalog.json
INTEGRATION_PACKAGE_ALLOWED_HOSTS=host.docker.internal
INTEGRATION_PACKAGE_ALLOW_INSECURE_HTTP=true
```

`INTEGRATION_PACKAGE_ALLOW_INSECURE_HTTP=true` is only for local testing.

## Run Marketplace With A Mounted Integrations Repo

In development, the Marketplace can mount this repository's `integrations/` folder into the container.

Example compose volume:

```yaml
volumes:
  - ../action1-marketplace-integrations-dev/integrations:/app/integrations:ro
```

The Marketplace container should have:

```env
INTEGRATIONS_DIR=/app/integrations
```

When the container starts, the Marketplace:

1. scans `/app/integrations`
2. reads each `manifest.json`
3. loads each entrypoint
4. applies migrations
5. registers integrations in the catalog

Folders starting with `_` are ignored.

This workflow is useful for backend iteration only. Downloadable-package testing should use the local package catalog so the Marketplace exercises the same install, checksum, extract, and remote UI load path used in production.

## Test Data

For local development containers, the Marketplace can seed test settings and sample data when configured with:

```env
MARKETPLACE_SEED_TEST_DATA=true
```

Seed data is for UI and workflow testing only. Do not rely on it for production behavior.

## Manual Test Checklist

After starting the Marketplace:

1. Open the Marketplace UI.
2. Confirm the integration appears in the catalog.
3. Enable the integration.
4. Open Settings and confirm vendor fields render correctly.
5. Save settings.
6. Run validation if the integration declares a validation action.
7. Start a manual run if the integration declares a sync/run action.
8. Open History and confirm run logs appear.
9. Open Dashboard, Endpoints, and Vulnerabilities if those views are defined.
10. Confirm a failed run shows a failure state and triggers configured Marketplace notifications.

## Troubleshooting

If the integration does not appear:

- confirm the folder is under `integrations/`
- confirm the folder name does not start with `_`
- confirm `manifest.json` is valid JSON
- confirm `manifest.id` matches the folder name
- run `npm test`
- check Marketplace container logs

If migrations do not apply:

- confirm files are under `migrations/`
- confirm filenames match `001_description.sql`
- confirm SQL statements end cleanly with semicolons
- check Marketplace container logs for migration errors

If validation or a manual/scheduled action does not execute:

- confirm the action is declared in `manifest.json`
- confirm `index.js` exports `actions` with a matching handler for the action ID
- confirm the handler returns or resolves a promise
- check Marketplace run history and container logs

