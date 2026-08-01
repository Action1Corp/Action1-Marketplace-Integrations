import { clone } from './demoSeedData.js';

export function createDemoPolicyRepository() {
  const policies = [];

  return {
    listPolicies() {
      return clone(policies);
    },
    getPolicy(policyId) {
      const policy = policies.find((entry) => entry.policyId === policyId);
      return policy ? clone(policy) : null;
    },
    createPolicy(input) {
      const nextPolicy = clone(input);
      policies.push(nextPolicy);
      return clone(nextPolicy);
    },
    updatePolicy(policyId, input) {
      const index = policies.findIndex((entry) => entry.policyId === policyId);
      if (index === -1) {
        throw new Error(`Unknown demo policy: ${policyId}`);
      }

      const nextPolicy = clone(input);
      policies[index] = nextPolicy;
      return clone(nextPolicy);
    }
  };
}
