import { invokeSigningOperation } from './signingFlow.js';

export function createPolicyApi(integration) {
  async function invoke(actionId, payload) {
    const response = await fetch(`/api/integrations/${integration}/actions/${actionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload ? { payload } : {})
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.message || 'Unable to complete the policy request.');
    }

    return result;
  }

  return {
    reconcilePolicies: async () => invokeSigningOperation(invoke, integration, 'reconcile-policies', {}),
    getControlPack: async () => invoke('get-control-pack'),
    listPolicies: async () => (await invoke('list-policies')).policies || [],
    getPolicy: async (policyId) => (await invoke('get-policy', { policyId })).policy,
    savePolicy: async (draft, progressOperationId) => {
      const payload = { draft, ...(progressOperationId ? { progressOperationId } : {}) };
      const result = draft?.mode === 'create'
        ? await invokeSigningOperation(invoke, integration, 'create-policy', payload)
        : await invokeSigningOperation(invoke, integration, 'update-policy', payload);
      return result.policy;
    },
    setPolicyEnabled: async (policyId, enabled) => (await (enabled
      ? invokeSigningOperation(invoke, integration, 'enable-policy', { policyId, enabled })
      : invoke('disable-policy', { policyId, enabled }))).policy,
    deletePolicy: async (policyId, progressOperationId) => invokeSigningOperation(invoke, integration, 'delete-policy', {
      policyId, ...(progressOperationId ? { progressOperationId } : {})
    })
  };
}
