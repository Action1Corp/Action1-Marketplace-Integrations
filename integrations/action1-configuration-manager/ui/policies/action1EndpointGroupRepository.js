export function createAction1EndpointGroupRepository(discoveryApi) {
  return {
    async listEndpointGroups(organizationId, options = {}) {
      return discoveryApi.listEndpointGroups(organizationId, options);
    }
  };
}
