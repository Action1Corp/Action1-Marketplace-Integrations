const SIGNING_CANCELLED_MESSAGE = 'Signing cancelled. No operations were submitted.';

export async function invokeSigningOperation(invoke, integration, actionId, payload) {
  const intentId = globalThis.crypto.randomUUID();
  const prepared = await invoke('prepare-policy-signing', {
    ...payload, operation: actionId === 'reconcile-policies' ? 'reconcile' : actionId === 'create-policy' ? 'create' : actionId === 'update-policy' ? 'edit' : actionId === 'delete-policy' ? 'delete' : 'enable', intentId
  });
  if (!prepared.signingRequired) return invoke(actionId, payload);
  const sign = window.Action1Marketplace?.provisioner?.sign;
  if (typeof sign !== 'function') throw new Error('Marketplace signing is unavailable. Reload Marketplace with the ETP framework enabled.');
  try {
    await sign({ integrationId: integration, signingId: prepared.signingId, digest: prepared.digest });
  } catch (error) {
    if (actionId !== 'create-policy' || error?.message !== SIGNING_CANCELLED_MESSAGE
      || typeof prepared.policyId !== 'string' || !/^POL-\d{6,}$/.test(prepared.policyId)) throw error;
    try {
      await invoke('rollback-prepared-policy', { operation: 'create', policyId: prepared.policyId });
    } catch (rollbackError) {
      const detail = String(rollbackError?.message || 'Rollback failed.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180);
      throw new Error(`Signing was cancelled, but the prepared Policy could not be removed: ${detail}`);
    }
    return { ok: true, cancelled: true };
  }
  return invoke(actionId, { ...payload, policyId: prepared.policyId, intentId,
    signingId: prepared.signingId, digest: prepared.digest });
}

export async function invokeReportingSigningOperation(invoke, integration, payload = {}) {
  const intentId = globalThis.crypto.randomUUID();
  const prepared = await invoke('prepare-reporting-signing', { ...payload, intentId });
  if (!prepared.signingRequired) return invoke('setup-reporting', payload);
  const sign = window.Action1Marketplace?.provisioner?.sign;
  if (typeof sign !== 'function') throw new Error('Marketplace signing is unavailable. Reload Marketplace with the ETP framework enabled.');
  await sign({ integrationId: integration, signingId: prepared.signingId, digest: prepared.digest });
  return invoke('setup-reporting', { ...payload, intentId, configurationId: prepared.configurationId, signingId: prepared.signingId, digest: prepared.digest });
}
