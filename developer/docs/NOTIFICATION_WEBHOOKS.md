# Failure Notification Webhooks

The Marketplace owns failure alert delivery. Integrations do not configure SMTP or webhook settings themselves.

When a manual or scheduled integration run ends as failed or interrupted, the Marketplace can:

- send an email through configured SMTP settings
- send an HTTP POST to a configured webhook URL

## Webhook Configuration

Webhook settings live in Marketplace Settings:

- Enable Failure Webhook
- Webhook URL
- Webhook Secret
- Additional Headers JSON

The optional webhook secret is sent as:

```text
X-Marketplace-Webhook-Secret: <secret>
```

Additional headers must be a JSON object:

```json
{
  "Authorization": "Bearer example-token"
}
```

## Failure Payload

Example payload:

```json
{
  "event": "integration.run.failed",
  "sentAt": "2026-05-19T18:25:43.511Z",
  "integration": {
    "id": "tenable",
    "name": "Tenable VM"
  },
  "run": {
    "id": 42,
    "status": "Failed",
    "startedAt": "2026-05-19T18:20:00.000Z",
    "assetsProcessed": 125
  },
  "details": "18:20:00 - Started run\n18:25:43 - Error: Vendor API returned 401\n"
}
```

Fields:

- `event`: event name. Current value is `integration.run.failed`.
- `sentAt`: time the Marketplace sent the webhook.
- `integration.id`: integration ID.
- `integration.name`: integration display name.
- `run.id`: Marketplace run-history ID.
- `run.status`: `Failed` or `Interrupted`.
- `run.startedAt`: run timestamp from Marketplace history.
- `run.assetsProcessed`: number of processed assets when available.
- `details`: run log details, truncated by the Marketplace when very large.

## Test Payload

The Send Test Webhook action sends:

```json
{
  "event": "marketplace.notification.test",
  "sentAt": "2026-05-19T18:25:43.511Z",
  "marketplace": "Action1 Integration Marketplace",
  "message": "This is a test webhook from the Action1 Integration Marketplace notification settings."
}
```

## Integration Responsibilities

For normal tracked action failures, integrations should:

1. let the Marketplace create the action-history entry
2. write useful progress through `request.run.appendLog(...)`
3. throw an error or return `{ "ok": false }` when the action fails
4. let the Marketplace send configured alerts

For intentionally untracked operations, integrations may call:

```js
await context.notifications.sendFailureAlert({ error });
```

The integration should write a failed run-history entry before calling this helper. Tracked actions do not need to call this helper directly.


