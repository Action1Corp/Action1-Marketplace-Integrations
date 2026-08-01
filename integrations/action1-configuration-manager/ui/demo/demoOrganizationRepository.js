import { demoOrganizations, clone } from './demoSeedData.js';

export function createDemoOrganizationRepository() {
  return {
    listOrganizations() {
      return clone(demoOrganizations);
    }
  };
}
