# Marketplace And Integration Repository Strategy

## Objective

Separate the Action1 Integration Marketplace host from vendor-specific integrations so integrations can be developed, reviewed, versioned, and released without changing the core Marketplace application.

## Repository Model

Use two repositories:

1. `action1-marketplace`
   - Owns the customer-facing Marketplace application.
   - Owns authentication, setup, roles, deployment behavior, standard renderers, scheduling, logs, framework data tables, and upgrade behavior.
   - Does not contain vendor-specific API logic.

2. `action1-marketplace-integrations`
   - Owns the integration catalog.
   - Contains one folder per integration.
   - Owns vendor API clients, settings schema, validation handlers, sync handlers, display definitions, and integration-owned database schema.

This model keeps the Marketplace stable while allowing integrations to evolve independently.

## Runtime Model

At startup, the Marketplace:

1. Scans the configured integrations directory.
2. Reads each `manifest.json`.
3. Loads each entrypoint.
4. Applies integration migrations.
5. Registers integrations in the catalog.
6. Renders settings and display definitions.
7. Calls integration handlers for validation, manual sync, and scheduled sync.

The integrations directory is configured with:

```env
INTEGRATIONS_DIR=/app/integrations
```

## Packaging Model

For customer deployments, the preferred model is a prebuilt Marketplace image that already contains the approved integration catalog.

### Production: Build-Time Bundling

The release pipeline builds a Marketplace image and copies approved integrations into the image.

Benefits:

- simplest customer install
- predictable release contents
- controlled testing
- no customer dependency on GitHub source

### Development: Runtime Volume

Developers can mount the integrations repo into a running Marketplace container:

```yaml
volumes:
  - ./integrations:/app/integrations:ro
```

Benefits:

- fast local iteration
- no Marketplace image rebuild for integration-only changes
- useful for partner or internal development

## Developer Workflow

1. Create a branch in `action1-marketplace-integrations`.
2. Add or update an integration folder.
3. Run `npm test`.
4. Open a pull request.
5. Review manifest, settings, migrations, display definitions, and handlers.
6. Merge after validation passes.
7. Build a new Marketplace image containing the approved integration catalog.

## Integration Package Responsibilities

An integration package should contain:

- `manifest.json` for metadata, settings, and `marketplaceActions`
- `display.json` for integration-owned screens and navigation
- `migrations/*.sql` for integration-owned schema
- `index.js` as the entrypoint
- optional `validate.js`
- optional `sync.js`
- `README.md` for setup requirements and vendor permissions

## Marketplace Responsibilities

The Marketplace host remains responsible for:

- authentication and authorization
- organization/team management
- setup wizard and deployment configuration
- settings rendering and secret masking
- shared Action1 API credential storage
- run history
- schedules
- standard UI renderers
- shared CVE metadata/cache
- applying integration migrations
- invoking integration handlers through the runtime context

## Current Implementation State

The current architecture supports:

- loading integrations from the integrations repository
- integration-owned display definitions
- integration-owned database migrations
- integration-owned endpoint and vulnerability tables
- Marketplace-owned settings, auth, schedule, and run-history framework tables
- standard renderers backed by integration-owned tables
- test-data seeding for fresh development containers

Future work should focus on automated release packaging, CI validation against a Marketplace test harness, and customer-facing installation artifacts.
