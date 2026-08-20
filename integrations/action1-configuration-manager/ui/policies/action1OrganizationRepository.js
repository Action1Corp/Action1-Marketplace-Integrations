export function createAction1OrganizationRepository(discoveryApi) {
  return {
    async listOrganizations() {
      return discoveryApi.listOrganizations();
    }
  };
}
