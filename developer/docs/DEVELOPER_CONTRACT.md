# Integration Developer Contract

For the versioned API reference, see `MARKETPLACE_INTEGRATION_API.md`.

Marketplace integrations are folder-based packages loaded by manifest.

```text
integrations/
  my-integration/
    manifest.json
    index.js
    README.md
```

## Capabilities Are Optional

Declare only the capabilities your integration actually supports.

Supported capabilities:

- `settings`
- `validate`
- `sync`
- `dashboard`
- `endpoints`
- `vulnerabilities`
- `history`
- `schedule`

An integration that only stores configuration can declare:

```json
{
  "capabilities": ["settings"]
}
```

The Marketplace hides unsupported buttons and navigation automatically.

`schedule` is a Marketplace-owned capability. If an integration declares `schedule`, it must also declare `sync`. The Marketplace stores a separate schedule per integration and calls that integration's `sync(context)` handler when the schedule fires. Integration developers should not implement cron logic.

## Scaffolding

Create a new integration with:

```bash
npm run create-integration -- my-integration
```

Then update the generated manifest, display definition, validation handler, sync handler, and README.

Use `developer/examples/hello-integration` as the minimal complete example. Developer examples are intentionally outside `integrations/` so the Marketplace does not load them as installable integrations.

## Optional Marketplace Handlers

Handlers are only required for capabilities that the Marketplace knows how to run.

For the current Marketplace API:

- Declare `validate` only if the Marketplace should show and run a credential validation action.
- Declare `sync` only if the Marketplace should show and run a sync action.
- Omit both for integrations that only provide settings, static metadata, standard views populated another way, or future/custom behavior.

`index.js` can export the Marketplace handlers it supports:

```js
module.exports = {
  async validate(context) {
    return { ok: true, message: 'Connected' };
  },

  async sync(context) {
    context.logger.info('Sync started');
  }
};
```

The integration can contain any internal functions it needs. The Marketplace will not call arbitrary function names unless a future API version defines them as supported handlers.

Do not import Marketplace backend files from an integration. Use the provided `context` object.

## Runtime Context

Handlers receive:

```js
context.integrationId
context.logger.info(message)
context.logger.warn(message)
context.logger.error(message)

await context.settings.get(key)
await context.settings.set(key, value)
await context.settings.all(['KeyA', 'KeyB'])

await context.db.run(sql, params)
await context.db.get(sql, params)
await context.db.all(sql, params)

context.http
context.services.nvd
context.services.computeAndSaveRunMetrics(runId, integrationId)
```

Integrations must not import Marketplace backend files directly. The runtime context is the compatibility boundary between the Marketplace and integration packages.

## SDK Helpers

The `sdk/` folder contains small helpers for common integration work. For sync-style integrations, prefer:

```js
const {
  createSyncRun,
  appendSyncLog,
  completeSyncRun,
  failSyncRun
} = require('../../../sdk');
```

These helpers keep run-history behavior consistent across integrations.
