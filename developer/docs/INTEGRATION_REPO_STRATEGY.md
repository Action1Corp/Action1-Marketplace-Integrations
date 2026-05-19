# Marketplace and Integration Repository Strategy

## Goal

Separate the Action1 Integration Marketplace host from vendor-specific integrations so other developers can build integrations without changing the core Marketplace application.

## Recommended Repository Model

Use two private GitHub repositories:

1. `action1-marketplace`
   - Owns authentication, organization roles, setup wizard, scheduling UI, framework services, Docker image, navigation, marketplace cards, logs, standard renderers, and upgrade flow.
   - Does not contain vendor-specific API logic.

2. `action1-marketplace-integrations`
   - Private integration catalog.
   - Contains one folder or package per integration.
   - Owns vendor API clients, sync logic, validation logic, settings schema, default schedules, and integration metadata.

This keeps the customer-facing Marketplace stable while allowing integrations to be developed, reviewed, versioned, and released independently.

## Integration Package Shape

Each integration should expose a small manifest plus backend handlers.

```text
integrations/
  tenable/
    manifest.json
    index.js
    README.md
  qualys/
    manifest.json
    index.js
    README.md
  rapid7/
    manifest.json
    index.js
    README.md
```

Example `manifest.json`:

```json
{
  "id": "tenable",
  "name": "Tenable VM",
  "vendor": "Tenable",
  "category": "Vulnerability Management",
  "description": "Synchronize vulnerabilities from Tenable.io into Action1.",
  "settings": [
    { "key": "TenableAccessKey", "label": "Access Key", "type": "secret", "required": true },
    { "key": "TenableSecretKey", "label": "Secret Key", "type": "secret", "required": true },
    { "key": "Action1APIKey", "label": "Action1 API Key", "type": "secret", "required": true },
    { "key": "Action1APISecret", "label": "Action1 API Secret", "type": "secret", "required": true },
    { "key": "Action1OrgID", "label": "Action1 Organization ID", "type": "text", "required": true }
  ],
  "capabilities": ["sync", "validate", "dashboard", "endpoints", "vulnerabilities", "history"]
}
```

Example `index.js`:

```js
module.exports = {
  async validate({ settings, logger }) {
    // Validate credentials and return { ok, message }.
  },

  async sync({ settings, db, action1Client, nvdService, logger }) {
    // Run integration sync and write normalized data through Marketplace APIs.
  }
};
```

## Marketplace Contract

The Marketplace should load integrations from a configured directory such as:

```env
INTEGRATIONS_DIR=/app/integrations
```

At startup, the Marketplace should:

1. Scan each integration folder.
2. Read `manifest.json`.
3. Load `index.js`.
4. Register the integration in the marketplace catalog.
5. Render settings dynamically from the manifest.
6. Call `validate()` from the integration package when credentials are tested.
7. Call `sync()` from the integration package when a manual or scheduled sync runs.

The core app should continue to own auth, roles, secret masking, schedules, sync history, and shared normalized tables.

## Docker Packaging

For customer installs, keep one simple Marketplace container. Integrations can be included in one of two ways:

### Option A: Build-Time Bundling

The release pipeline clones the private integrations repo and copies selected integrations into the Marketplace image.

Best for:

- Simple customer installs
- Private integrations that should not be modified by customers
- Controlled release testing

### Option B: Runtime Volume

The customer mounts an integrations folder into the container.

```yaml
volumes:
  - ./integrations:/app/integrations:ro
```

Best for:

- Developer testing
- Partner-built integrations
- Faster iteration without rebuilding the Marketplace image

Recommended path: start with build-time bundling for production and support runtime volume loading for development.

## GitHub Workflow

Use the private integrations repository as the developer entry point.

Recommended branch flow:

1. Developer creates a branch in `action1-marketplace-integrations`.
2. Developer adds a new integration folder with manifest, sync handler, validation handler, and README.
3. CI runs contract tests against a Marketplace test harness.
4. Pull request is reviewed.
5. On merge, release workflow builds a new Marketplace image with the updated integration catalog.

## Migration Plan

1. Add an integration registry to the Marketplace.
2. Move hardcoded integration requirements from `backend/integrationConfig.js` into manifests.
3. Move `getSyncEngine()` from a switch statement to registry lookup.
4. Move credential validation out of `backend/server.js` and into integration `validate()` handlers.
5. Keep the Marketplace UI framework for dashboards, endpoints, vulnerabilities, and history, but have each integration define and own the data tables those views read from.
6. Extract existing integrations one at a time: Tenable, Qualys, Rapid7, Defender, CrowdStrike, Intune.
7. Add a template integration that developers can copy.

## First Implementation Target

The first technical milestone should be a local plugin registry while everything still lives in this repo:

```text
backend/integrations/
  tenable/
    manifest.json
    index.js
```

Once that works, move `backend/integrations/` into the private GitHub integrations repo and mount or bundle it into the Marketplace container.
