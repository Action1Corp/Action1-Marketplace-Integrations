export function createPolicyDiscoveryApi(integration) {
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
      throw new Error(result?.message || 'Unable to complete the policy discovery request.');
    }

    return result;
  }

  return {
    listOrganizations: async () => (await invoke('discover-policy-organizations')).organizations || [],
    listEndpointGroups: async (organizationId, options = {}) => {
      const result = await invoke('discover-policy-endpoint-groups', {
        organizationId,
        policyId: options.policyId || ''
      });
      return {
        organizationId: result.organizationId || organizationId,
        allEndpointsAvailable: result.allEndpointsAvailable !== false,
        endpointGroups: result.endpointGroups || []
      };
    }
  };
}
