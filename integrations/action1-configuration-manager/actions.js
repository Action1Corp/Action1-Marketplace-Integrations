const {
  deletePolicyAction,
  getPolicyAction,
  listPoliciesAction,
  savePolicyAction,
  setPolicyEnabledAction
} = require('./policyActions');
const {
  discoverPolicyEndpointGroupsAction,
  discoverPolicyOrganizationsAction
} = require('./policyDiscoveryActions');

module.exports = {
  actions: {
    'list-policies': listPoliciesAction,
    'get-policy': getPolicyAction,
    'save-policy': savePolicyAction,
    'set-policy-enabled': setPolicyEnabledAction,
    'delete-policy': deletePolicyAction,
    'discover-policy-organizations': discoverPolicyOrganizationsAction,
    'discover-policy-endpoint-groups': discoverPolicyEndpointGroupsAction
  }
};
