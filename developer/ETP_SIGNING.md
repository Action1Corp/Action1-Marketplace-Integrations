# ETP integration development

This is the `feature/etp-signing-framework` preview. Use the matching [Marketplace branch](https://github.com/Action1Corp/Action1-Marketplace/tree/feature/etp-signing-framework) and its [setup guide](https://github.com/Action1Corp/Action1-Marketplace/blob/feature/etp-signing-framework/docs/ETP_SETUP.md). No production catalog entry or release is published by this work. Main is merged manually after testing.

## Shared SDK

Every authenticated integration action has `context.action1.provisioner` version 1. It is the shared service: do not bundle a signer, read a user's key, ask for a passphrase inside an integration, or write your own Action1 signature algorithm.

```js
// Backend handler. Generate complete, immutable definitions first.
const result = await context.action1.provisioner.prepareSchedules({
  idempotencyKey: request.payload.intentId, // retain across retries of this intent
  schedules: definitions.map((definition, index) => ({
    id: `family-${index}`,
    organizationId: policy.organizationId,
    payload: definition.payload // includes name, actions, settings and endpoints
  }))
});
return result;
```

Gather all definitions before calling `prepareSchedules` once. A batch contains 1–100 schedules. The framework allocates stable configuration and action IDs for creates, presents the complete batch, prompts the acting user once, and signs/verifies every configuration before submitting. For an update pass `resourceId` and the existing configuration/action IDs inside `payload`; never substitute the schedule resource ID for the configuration ID.

The low-level `prepare` operation schema and failure states are documented in [the framework contract](https://github.com/Action1Corp/Action1-Marketplace/blob/feature/etp-signing-framework/docs/ETP_FRAMEWORK.md). Only schedule create/update are implemented. Instance execution, custom data sources, scripts and other protected resource types need their own adapters. Custom attribute updates and read-only operations do not acquire a passphrase just because ETP is enabled.

`context.action1.getCredentials()` adds `etpMode: 'etp' | 'legacy'`. Ordinary existing credentials/base URLs remain available for compatible non-signing operations. The provisioner selects API 3.1 for ETP and 3.0 for legacy. Never catch an ETP error and retry an unsigned request to 3.0.

## Pending is not success

Preparation returns `{ ok: true, outcome, batchId, reviewUrl }`, with outcome `awaiting_signature` for ETP or `awaiting_approval` for non-ETP. It has not created a remote object. The UI should expose the same-origin `/signing?batch=...` link, retain pending state and avoid inventing an automation ID. See the Intune `create-action1-automation` backend handler and the corresponding `Policies.jsx` dialog for an implementation.

After review/submission, read `await context.action1.provisioner.get(batchId)`. This is restricted to the authenticated batch owner and the calling integration. Persist returned resource IDs into your own correlation model only after the operations are `submitted`. Submission/readback still does not establish successful endpoint execution; use execution history separately.

Cancelled, expired, changed-key or changed-connection plans need a newly reviewed intent. A `reconciliation_required` or interrupted `submitting` batch must not be blindly replayed. Some operations may already exist. Inspect each result/resource ID and the stable configuration IDs, reconcile partial success, and replan only what remains. The preview deliberately has no automatic recovery endpoint.

Scheduled handlers do not have an interactive actor. They must report that fresh signing approval is needed rather than reuse a cached passphrase or another user's identity. Previously signed schedules may continue to execute according to Action1's behavior; creating/changing protected configurations needs the appropriate review workflow.

When a known protected action is actually migrated, declare `etpSupport: "schedule-provisioner-v1"` and `retry: false` on that action in `manifest.json`. This does not confer signing access or remove user approval. Do not mark an unsupported handler as migrated merely to bypass the Marketplace compatibility gate. Third-party integrations remain trusted server code, not sandboxed plugins.

## Configuration Management migration

`integrations/action1-configuration-manager/etpProvisioning.js` contains `preparePolicySigning(context, policy, definitions, idempotencyKey)`, a reusable adapter for complete generated family definitions. Its 24-family test proves one framework call is made and payloads/targets are preserved. It is not yet wired into the existing lifecycle. The existing CM lifecycle writes and reporting setup are blocked in ETP mode by the Marketplace guard.

Complete the following as a coordinated lifecycle change after the repaired API's contracts are verified:

1. Persist a pending intent, owner, complete plan and batch ID separately from applied policy/correlations. Reserve the policy/scope against concurrent submissions by different users.
2. Replace the per-family creation loop with one preparation call. Resume after the user's submission; record returned resource/configuration/action IDs and desired definition fingerprints without marking a pending policy applied.
3. Reconcile partial success before retry. Preserve unchanged signatures. For edits, use the actual remote configuration IDs and compare remote versions; validate supported PATCH behavior rather than using guessed POST upserts.
4. Implement protected cleanup execution instances and reporting data-source adapters. Separate schedule deletion and ordinary metadata changes according to confirmed API requirements.
5. Make scheduled reconciliation raise a user-review task when new signatures are needed, never impersonate the policy creator.

Do not call the adapter once per family or drop it into the old synchronous create loop: that would defeat one-prompt batching and break correlation persistence. Do not turn the adapter into an untracked alternate policy creation endpoint.

## Current support and test boundaries

| Path | Feature-branch behavior |
| --- | --- |
| Existing non-ETP integrations | Existing execution path retained |
| New shared schedule batch API | ETP and non-ETP modes, offline tests |
| Intune disabled automation creation | Prepares a signing review in ETP mode |
| Intune enable/delete protected paths | Blocked in ETP mode pending migration/validation |
| Configuration Management family batching | Adapter and 24-family contract test; lifecycle wiring pending |
| Configuration Management lifecycle/reporting writes | Blocked in ETP mode pending migration |
| Attribute updates/readers | No new signing prompt; live regression testing still required |
| Cloud-only key provider, instances, data sources | Not implemented in this preview |

Tests:

```sh
npm test
node --test integrations/intune/action1Automation.test.js integrations/action1-configuration-manager/tests/etpProvisioning.test.js
node scripts/package-integration.js integrations/intune
node scripts/package-integration.js integrations/action1-configuration-manager
```

The adapter tests and Marketplace signer tests use mocks. After API 3.1 recovers on `integration-product-03`, test two users/two keys, 24 disabled schedules, bad/revoked keys, readback, update invalidation, cancellation, restart/response loss, rate limits and actual harmless endpoint execution. Do not merge based on local tests alone. Generated preview packages keep current versions for local build verification; assign proper prerelease versions before any distribution, and do not publish them over existing releases.
