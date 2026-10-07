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
    getControlPack: async () => invoke('get-control-pack'),
    listPolicies: async () => (await invoke('list-policies')).policies || [],
    getPolicy: async (policyId) => (await invoke('get-policy', { policyId })).policy,
    savePolicy: async (draft, progressOperationId) => (await invoke(draft?.mode === 'create' ? 'create-policy' : 'update-policy', {
      draft, ...(progressOperationId ? { progressOperationId } : {})
    })).policy,
    setPolicyEnabled: async (policyId, enabled) => (await invoke(enabled ? 'enable-policy' : 'disable-policy', { policyId, enabled })).policy,
    deletePolicy: async (policyId, progressOperationId) => invoke('delete-policy', {
      policyId, ...(progressOperationId ? { progressOperationId } : {})
    })
  };
}
