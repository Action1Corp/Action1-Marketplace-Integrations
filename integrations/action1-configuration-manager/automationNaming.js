function buildAutomationDisplayName({ policyId, policyName, controlFamilyName }) {
  return ['A1CM', policyId, policyName, controlFamilyName]
    .map((value) => String(value || '').trim())
    .join(' — ');
}

module.exports = { buildAutomationDisplayName };
