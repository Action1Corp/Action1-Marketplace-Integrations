export function mergePoliciesIntoDashboard(statusData, policies) {
  const currentPolicies = Array.isArray(policies) ? policies : [];
  const snapshotPolicyId = String(statusData?.selectedPolicyId || '');
  const currentIds = new Set(currentPolicies.map(policy => policy.policyId));
  const selectedPolicy = currentPolicies.find(policy => policy.policyId === snapshotPolicyId)
    || currentPolicies.find(policy => policy.enabled !== false)
    || currentPolicies[0];
  const policyResults = Object.fromEntries(
    Object.entries(statusData?.policyResults || {}).filter(([policyId]) => currentIds.has(policyId))
  );

  return {
    ...statusData,
    policies: currentPolicies,
    policyResults,
    snapshotPolicyId,
    selectedPolicyId: selectedPolicy?.policyId || ''
  };
}
