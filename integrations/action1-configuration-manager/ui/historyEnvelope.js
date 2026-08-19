const PREFIX = 'A1CM_HISTORY_V1';
const OPERATIONS = new Set(['POLICY_CREATED', 'POLICY_UPDATED', 'POLICY_ENABLED', 'POLICY_DISABLED', 'POLICY_DELETED', 'SCHEDULED_RECONCILIATION', 'REPORTING_SETUP']);
const LABELS = {
  POLICY_CREATED: 'Policy created', POLICY_UPDATED: 'Policy updated', POLICY_ENABLED: 'Policy enabled',
  POLICY_DISABLED: 'Policy disabled', POLICY_DELETED: 'Policy deleted', SCHEDULED_RECONCILIATION: 'Scheduled reconciliation', REPORTING_SETUP: 'Reporting setup'
};

function bounded(value, fallback = '') {
  return String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function extractHistoryEnvelope(details) {
  const text = String(details || '');
  const marker = text.lastIndexOf(PREFIX);
  const jsonStart = marker < 0 ? -1 : text.indexOf('{', marker + PREFIX.length);
  if (jsonStart < 0) return null;
  try {
    const value = JSON.parse(text.slice(jsonStart).trim());
    if (value?.schemaVersion !== 1 || !OPERATIONS.has(value.operation)) return null;
    return {
      schemaVersion: 1,
      operation: value.operation,
      operationLabel: LABELS[value.operation],
      policyNameSnapshot: bounded(value.policyNameSnapshot),
      organizationNameSnapshot: bounded(value.organizationNameSnapshot),
      summary: bounded(value.summary, LABELS[value.operation]),
      counts: Object.fromEntries(Object.entries(value.counts || {}).filter(([, count]) => Number.isInteger(count) && count >= 0)),
      familyOutcomes: Array.isArray(value.familyOutcomes) ? value.familyOutcomes.slice(0, 100).map((outcome) => ({ familyName: bounded(outcome.familyName, 'Control Family'), outcome: bounded(outcome.outcome, 'Unresolved'), ...(outcome.message ? { message: 'Outcome requires attention.' } : {}) })) : [],
      policies: Array.isArray(value.policies) ? value.policies.slice(0, 100).map((policy) => ({
        policyNameSnapshot: bounded(policy.policyNameSnapshot, 'Policy'),
        organizationNameSnapshot: bounded(policy.organizationNameSnapshot, 'Organization'),
        familyChanges: Array.isArray(policy.familyChanges) ? policy.familyChanges.slice(0, 100).map((outcome) => ({ familyName: bounded(outcome.familyName, 'Control Family'), outcome: bounded(outcome.outcome, 'Unresolved'), ...(outcome.message ? { message: 'Outcome requires attention.' } : {}) })) : []
      })) : [],
      errors: Array.isArray(value.errors) ? value.errors.slice(0, 20).map(() => 'Policy operation failed') : []
    };
  } catch {
    return null;
  }
}
