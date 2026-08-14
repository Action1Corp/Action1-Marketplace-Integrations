const { AUTOMATION_CORRELATIONS_TABLE } = require('./policyTables');

const MAX_ERROR_LENGTH = 1000;

function required(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeCorrelation(input = {}) {
  const lastError = input.lastError == null ? null : String(input.lastError).trim();
  if (lastError && lastError.length > MAX_ERROR_LENGTH) throw new Error('Correlation error metadata must be bounded.');
  return {
    policyId: required(input.policyId, 'Policy id'),
    automationGroupId: required(input.automationGroupId, 'Automation group id'),
    automationGroupVersion: required(input.automationGroupVersion, 'Automation group version'),
    controlFamilyNameSnapshot: required(input.controlFamilyNameSnapshot, 'Control family name'),
    action1OrganizationId: required(input.action1OrganizationId, 'Action1 organization id'),
    action1AutomationId: required(input.action1AutomationId, 'Action1 automation id'),
    action1AutomationName: required(input.action1AutomationName, 'Action1 automation name'),
    action1AutomationSelf: required(input.action1AutomationSelf, 'Action1 automation self URL'),
    desiredDefinitionFingerprint: required(input.desiredDefinitionFingerprint, 'Definition fingerprint'),
    lastAppliedAt: required(input.lastAppliedAt || new Date().toISOString(), 'Last applied timestamp'),
    lastError
  };
}

function hydrate(row) {
  return {
    policyId: String(row.policy_id), automationGroupId: String(row.automation_group_id),
    automationGroupVersion: String(row.automation_group_version),
    controlFamilyNameSnapshot: String(row.control_family_name_snapshot),
    action1OrganizationId: String(row.action1_organization_id),
    action1AutomationId: String(row.action1_automation_id),
    action1AutomationName: String(row.action1_automation_name),
    action1AutomationSelf: String(row.action1_automation_self),
    desiredDefinitionFingerprint: String(row.desired_definition_fingerprint),
    active: row.active === undefined ? true : Number(row.active) === 1,
    lastAppliedAt: row.last_applied_at || null, lastError: row.last_error || null,
    createdAt: row.created_at || null, updatedAt: row.updated_at || null
  };
}

function createAutomationCorrelationStore(context) {
  return {
    async insertCorrelation(input) {
      const correlation = normalizeCorrelation(input);
      await context.db.run(
        `INSERT INTO ${AUTOMATION_CORRELATIONS_TABLE} (
          policy_id, automation_group_id, automation_group_version,
          control_family_name_snapshot, action1_organization_id,
          action1_automation_id, action1_automation_name, action1_automation_self,
          desired_definition_fingerprint, active, last_applied_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [correlation.policyId, correlation.automationGroupId, correlation.automationGroupVersion,
          correlation.controlFamilyNameSnapshot, correlation.action1OrganizationId,
          correlation.action1AutomationId, correlation.action1AutomationName,
          correlation.action1AutomationSelf, correlation.desiredDefinitionFingerprint,
          correlation.lastAppliedAt, correlation.lastError]
      );
      return correlation;
    },
    async listCorrelations(policyId, options = {}) {
      const normalizedPolicyId = required(policyId, 'Policy id');
      const rows = await context.db.all(
        `SELECT policy_id, automation_group_id, automation_group_version,
                control_family_name_snapshot, action1_organization_id,
                action1_automation_id, action1_automation_name, action1_automation_self,
                desired_definition_fingerprint, active, last_applied_at, last_error,
                created_at, updated_at
           FROM ${AUTOMATION_CORRELATIONS_TABLE}
          WHERE policy_id = ?${options.includeInactive ? '' : ' AND active = 1'}
          ORDER BY automation_group_id ASC`, [normalizedPolicyId]
      );
      return (Array.isArray(rows) ? rows : []).map(hydrate);
    },
    async updateCorrelation(policyId, automationGroupId, input = {}) {
      await context.db.run(
        `UPDATE ${AUTOMATION_CORRELATIONS_TABLE}
            SET automation_group_version = ?, control_family_name_snapshot = ?,
                action1_automation_name = ?, action1_automation_self = COALESCE(?, action1_automation_self),
                desired_definition_fingerprint = ?, active = 1, last_applied_at = ?, last_error = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE policy_id = ? AND automation_group_id = ?`,
        [input.automationGroupVersion, input.controlFamilyNameSnapshot, input.action1AutomationName,
          input.action1AutomationSelf || null, input.desiredDefinitionFingerprint, input.lastAppliedAt || new Date().toISOString(),
          input.lastError || null, required(policyId, 'Policy id'), required(automationGroupId, 'Automation group id')]
      );
    },
    async activateCorrelation(input) {
      const correlation = normalizeCorrelation(input);
      const result = await context.db.run(
        `UPDATE ${AUTOMATION_CORRELATIONS_TABLE}
            SET automation_group_version = ?, control_family_name_snapshot = ?,
                action1_organization_id = ?, action1_automation_id = ?, action1_automation_name = ?,
                action1_automation_self = ?, desired_definition_fingerprint = ?, active = 1,
                last_applied_at = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE policy_id = ? AND automation_group_id = ?`,
        [correlation.automationGroupVersion, correlation.controlFamilyNameSnapshot,
          correlation.action1OrganizationId, correlation.action1AutomationId, correlation.action1AutomationName,
          correlation.action1AutomationSelf, correlation.desiredDefinitionFingerprint, correlation.lastAppliedAt,
          correlation.policyId, correlation.automationGroupId]
      );
      if (!result?.changes) return this.insertCorrelation(input);
      return correlation;
    },
    async markInactive(policyId, automationGroupId, message = null) {
      await context.db.run(
        `UPDATE ${AUTOMATION_CORRELATIONS_TABLE}
            SET active = 0, last_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE policy_id = ? AND automation_group_id = ?`,
        [message ? String(message).slice(0, MAX_ERROR_LENGTH) : null, required(policyId, 'Policy id'), required(automationGroupId, 'Automation group id')]
      );
    },
    async removePolicyCorrelations(policyId) {
      await context.db.run(`DELETE FROM ${AUTOMATION_CORRELATIONS_TABLE} WHERE policy_id = ?`, [required(policyId, 'Policy id')]);
    },
    async recordFailure(policyId, automationGroupId, message) {
      const normalizedPolicyId = required(policyId, 'Policy id');
      const normalizedGroupId = required(automationGroupId, 'Automation group id');
      const normalizedMessage = String(message || '').trim();
      if (normalizedMessage.length > MAX_ERROR_LENGTH) throw new Error('Correlation error metadata must be bounded.');
      await context.db.run(
        `UPDATE ${AUTOMATION_CORRELATIONS_TABLE}
            SET last_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE policy_id = ? AND automation_group_id = ?`,
        [normalizedMessage || null, normalizedPolicyId, normalizedGroupId]
      );
      return { policyId: normalizedPolicyId, automationGroupId: normalizedGroupId, lastError: normalizedMessage || null };
    }
  };
}

module.exports = { MAX_ERROR_LENGTH, createAutomationCorrelationStore, normalizeCorrelation };
