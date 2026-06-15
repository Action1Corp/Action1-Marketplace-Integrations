# Local Testing Guide

This guide explains how to test integrations against a local Marketplace environment. There are two local workflows:

- Backend package validation with a Marketplace container and `INTEGRATIONS_DIR`.
- Full custom UI development with Marketplace backend source, frontend source, PostgreSQL, `INTEGRATIONS_DIR`, and `INTEGRATION_UI_SOURCE`.

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

This workflow validates backend-loaded integration behavior. It does not add new custom React screens to the published Marketplace frontend because that frontend is already built.

## Run Full UI Development From Source

Use the Marketplace host-source workflow when changing custom React views under an integration's `ui/` folder.

The Marketplace backend must run with:

```env
INTEGRATIONS_DIR=/path/to/Action1-Marketplace-Integrations/integrations
```

The Marketplace frontend dev server must run with:

```env
INTEGRATION_UI_SOURCE=/path/to/Action1-Marketplace-Integrations/integrations
```

The Marketplace repository contains the full runbook:

```text
docs/host-source-development.md
```

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

## Test Integration-Owned UI

Every integration must have a `ui/index.jsx` file. The Marketplace frontend must be built with integration source available so those views can be bundled.

From the Marketplace repository, set `INTEGRATION_UI_SOURCE` to the folder that contains integration packages:

```bash
INTEGRATION_UI_SOURCE=/path/to/Action1-Marketplace-Integrations/integrations npm --prefix frontend run dev
```

From the Marketplace repository, use the developer example package with:

```bash
INTEGRATION_UI_SOURCE=/path/to/Action1-Marketplace-Integrations/developer/examples npm --prefix frontend run dev
```

For production Marketplace builds, the Marketplace build process bundles approved integrations before the Docker image is built. Backend integration code can still be mounted at runtime through `INTEGRATIONS_DIR` for backend package validation.

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

