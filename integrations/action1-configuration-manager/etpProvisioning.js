// Adapter for the staged ETP lifecycle. Never call this inside the existing
// per-family write loop: gather the complete plan first, then prepare once.
function policySchedulePlan(policy, definitions, idempotencyKey) {
  if (!policy?.policyId || !policy.organizationId || !Array.isArray(definitions) || !definitions.length) throw new Error('A persisted policy and complete automation definitions are required.');
  return {
    idempotencyKey,
    schedules: definitions.map((definition, index) => ({
      id: `family-${index}`, organizationId: policy.organizationId,
      payload: definition.payload
    }))
  };
}
async function preparePolicySigning(context, policy, definitions, idempotencyKey) {
  if (!context.action1?.provisioner?.prepareSchedules) throw new Error('This Marketplace does not provide the ETP bulk signing framework.');
  return context.action1.provisioner.prepareSchedules(policySchedulePlan(policy, definitions, idempotencyKey));
}
module.exports = { policySchedulePlan, preparePolicySigning };
