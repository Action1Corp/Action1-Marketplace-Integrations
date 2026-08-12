import { demoEndpointGroups, clone } from './demoSeedData.js';

export function createDemoEndpointGroupRepository() {
  return {
    listEndpointGroups(organizationId) {
      return clone(demoEndpointGroups[organizationId] || []);
    }
  };
}
