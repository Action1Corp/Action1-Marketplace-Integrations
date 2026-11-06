export async function invokeSigningOperation(invoke, integration, actionId, payload) {
  const intentId = globalThis.crypto.randomUUID();
  const prepared = await invoke('prepare-policy-signing', {
    ...payload, operation: actionId === 'create-policy' ? 'create' : actionId === 'update-policy' ? 'edit' : actionId === 'delete-policy' ? 'delete' : 'enable', intentId
  });
  if (!prepared.signingRequired) return invoke(actionId, payload);
  const sign = window.Action1Marketplace?.provisioner?.sign;
  if (typeof sign !== 'function') throw new Error('Marketplace signing is unavailable. Reload Marketplace with the ETP framework enabled.');
  await sign({ integrationId: integration, signingId: prepared.signingId, digest: prepared.digest });
  return invoke(actionId, { ...payload, policyId: prepared.policyId, intentId,
    signingId: prepared.signingId, digest: prepared.digest });
}
