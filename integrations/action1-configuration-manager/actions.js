const {
  deletePolicyAction,
  deleteTrackedPolicyAction,
  disablePolicyAction,
  enablePolicyAction,
  getPolicyAction,
  listPoliciesAction,
  savePolicyAction,
  setPolicyEnabledAction,
  createPolicyAction,
  updatePolicyAction
} = require('./policyActions');
const {
  discoverPolicyEndpointGroupsAction,
  discoverPolicyOrganizationsAction
} = require('./policyDiscoveryActions');
const { reconcilePoliciesAction } = require('./reconciliation');

module.exports = {
  actions: {
    'list-policies': listPoliciesAction,
    'get-policy': getPolicyAction,
    'save-policy': savePolicyAction,
    'create-policy': createPolicyAction,
    'update-policy': updatePolicyAction,
    'set-policy-enabled': setPolicyEnabledAction,
    'disable-policy': disablePolicyAction,
    'enable-policy': enablePolicyAction,
    'delete-policy': deleteTrackedPolicyAction,
    'discover-policy-organizations': discoverPolicyOrganizationsAction,
    'discover-policy-endpoint-groups': discoverPolicyEndpointGroupsAction,
    'reconcile-policies': reconcilePoliciesAction
  }
};
