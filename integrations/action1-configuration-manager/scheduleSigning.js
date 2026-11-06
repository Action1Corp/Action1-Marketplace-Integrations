const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createAction1DiscoveryClient, requiresETPSigning, sanitizeMessage } = require('./action1DiscoveryClient');
const { buildAutomationDefinitions } = require('./automationDefinition');
const { buildApi4CreatePayload, buildApi4UpdatePayload, buildApi4InstancePayload, expectedInstanceConfiguration } = require('./action1AutomationClient');

async function isETPContext(context) {
  // Some local-only callers do not resolve an Action1 connection. Resource
  // clients still require credentials and enforce signing before any request.
  if (!context.action1?.getCredentials) return false;
  return requiresETPSigning(await createAction1DiscoveryClient(context).resolveConnection());
}

function signingKey(policy, operation, intentId) {
  if (!['create', 'enable', 'edit', 'delete'].includes(operation) || !/^[A-Za-z0-9_-]+$/.test(policy?.policyId || '')
    || !/^[0-9a-f-]{36}$/i.test(intentId || '')) throw new Error('A valid Policy signing intent is required.');
  return `a1cm:${operation}:${policy.policyId}:${intentId}`;
}

function provisioner(context) {
  const service = context.action1?.provisioner;
  if (typeof service?.prepareSigning !== 'function' || typeof service?.getSigning !== 'function') {
    throw new Error('Marketplace signing is unavailable. Enable the ETP framework and configure your signing key.');
  }
  return service;
}

function safeSigningError(error) {
  // Host messages are bounded and sanitized; never serialize an HTTP/CLI error.
  return new Error(sanitizeMessage(error?.isAxiosError ? 'Marketplace signing request failed. Check availability and permissions.' : error?.message || 'Marketplace signing failed.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240));
}

function configurationDigest(value) {
  // Comparison only, matching the documented host digest. No signature creation.
  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    return v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function signingEntries(policy, operation, editPlan) {
  if (operation === 'edit' || operation === 'delete') {
    if (!editPlan?.snapshot || !Array.isArray(editPlan.operations)) throw new Error('A verified Policy edit plan is required.');
    const fingerprint = configurationDigest(editPlan.snapshot);
    const entries = editPlan.operations.filter(o => ['CREATE', 'PATCH'].includes(o.type)).map((o, index) => ({
      id: `${operation}-${fingerprint}-${index}`, key: o.definition.automationGroupId, definition: o.definition, correlation: o.type === 'PATCH' ? o.correlation : null
    }));
    if (editPlan.cleanupInstance) entries.push({ id: `${operation}-${fingerprint}-cleanup`, key: 'cleanup', instance: editPlan.cleanupInstance });
    return entries;
  }
  return buildAutomationDefinitions(policy).map((definition, index) => ({ id: `${operation}-${policy.policyId}-${index}`, key: definition.automationGroupId, definition }));
}

async function prepareScheduleSigning(context, { policy, operation, intentId, editPlan }) {
  const idempotencyKey = signingKey(policy, operation, intentId);
  const connection = await createAction1DiscoveryClient(context).resolveConnection();
  if (!requiresETPSigning(connection)) throw new Error('This signing intent requires the Marketplace ETP connection mode.');
  const service = provisioner(context);
  const objects = signingEntries(policy, operation, editPlan).map(({ id, definition, correlation, instance }) => ({
    id,
    configuration: instance ? buildApi4InstancePayload(instance, policy.organizationId, () => crypto.randomUUID(), () => Date.now()).payload.configuration
      : correlation ? buildApi4UpdatePayload(definition, policy.organizationId, correlation.action1AutomationConfigurationId, correlation.action1AutomationActionId).configuration
      : buildApi4CreatePayload(definition, policy.organizationId, () => crypto.randomUUID()).payload.configuration
  }));
  // Marketplace owns batch capacity validation. Do not split or rewrite scripts.
  try {
    return await service.prepareSigning({ idempotencyKey, objects });
  } catch (error) { throw safeSigningError(error); }
}

async function getSignedSchedules(context, { policy, operation, intentId, signingId, digest, editPlan }) {
  const idempotencyKey = signingKey(policy, operation, intentId);
  const connection = await createAction1DiscoveryClient(context).resolveConnection();
  if (!requiresETPSigning(connection)) throw new Error('Marketplace connection changed. Prepare the Policy operation again.');
  const service = provisioner(context);
  let job;
  try { job = await service.getSigning(signingId); } catch (error) { throw safeSigningError(error); }
  if (!job || job.id !== signingId || job.purpose !== 'sign-only' || job.state !== 'signed'
    || job.integrationId !== context.integrationId || job.digest !== digest
    || !Number.isFinite(job.expiresAt) || Date.now() > job.expiresAt
    || job.origin !== new URL(connection.baseUrl).origin) {
    throw new Error('Policy signing is incomplete, changed or expired. Prepare and sign the operation again.');
  }
  const entries = signingEntries(policy, operation, editPlan);
  if (!Array.isArray(job.objects) || !Array.isArray(job.results)
    || job.objects.length !== entries.length || job.results.length !== entries.length) {
    throw new Error('Policy signing results are incomplete. Prepare the operation again.');
  }
  const objects = new Map(job.objects.map(o => [o.id, o]));
  const results = new Map(job.results.map(r => [r.id, r]));
  if (objects.size !== entries.length || results.size !== entries.length) throw new Error('Policy signing results contain duplicate object IDs.');
  const signed = new Map();
  for (const { id, key, definition, correlation, instance } of entries) {
    const configuration = objects.get(id)?.configuration;
    const result = results.get(id);
    const signature = result?.signature;
    const expected = configuration && (instance ? expectedInstanceConfiguration(instance, policy.organizationId, configuration)
      : buildApi4UpdatePayload(definition, policy.organizationId,
      correlation ? correlation.action1AutomationConfigurationId : configuration.id,
      correlation ? correlation.action1AutomationActionId : configuration.actions?.[0]?.id).configuration);
    if (!configuration || !isDeepStrictEqual(configuration, expected)
      || result?.configurationDigest !== configurationDigest(configuration)
      || typeof signature?.alg !== 'string' || !signature.alg || !Number.isInteger(signature.iat) || signature.iat <= 0
      || typeof signature.kid !== 'string' || !signature.kid || typeof signature.value !== 'string' || !signature.value) {
      throw new Error('Signed configuration does not match the current Policy or its signing result. Prepare the operation again.');
    }
    signed.set(key, { configuration, signature, origin: job.origin, expiresAt: job.expiresAt, kind: instance ? 'instance' : 'schedule',
      resourceId: correlation?.action1AutomationId || null });
  }
  // Repeating the ORIGINAL intent checks the CURRENT profile revision, mode,
  // origin and expiry in the existing host service, without signing or writes.
  let fresh;
  try { fresh = await service.prepareSigning({ idempotencyKey, objects: job.objects }); } catch (error) { throw safeSigningError(error); }
  if (fresh.signingId !== signingId || fresh.digest !== digest || fresh.outcome !== 'signed') {
    throw new Error('Policy signing intent changed. Prepare the operation again.');
  }
  return signed;
}

module.exports = { isETPContext, prepareScheduleSigning, getSignedSchedules };
