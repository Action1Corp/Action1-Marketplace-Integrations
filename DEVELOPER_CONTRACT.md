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

## Optional Handlers

`index.js` may export any of these handlers:

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
