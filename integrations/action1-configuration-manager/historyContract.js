const HISTORY_PREFIX = 'A1CM_HISTORY_V1';
const HISTORY_SCHEMA_VERSION = 1;
const MAX_DETAILS_LENGTH = 12000;
const MAX_TEXT_LENGTH = 240;

const OPERATION_LABELS = {
  POLICY_CREATED: 'Policy created',
  POLICY_UPDATED: 'Policy updated',
  POLICY_ENABLED: 'Policy enabled',
  POLICY_DISABLED: 'Policy disabled',
  POLICY_DELETED: 'Policy deleted',
  SCHEDULED_RECONCILIATION: 'Scheduled reconciliation',
  REPORTING_SETUP: 'Reporting setup'
};

function boundedText(value, fallback = '') {
  const text = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_TEXT_LENGTH);
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safeCounts(counts = {}) {
  return Object.fromEntries(Object.entries(counts)
    .map(([key, value]) => [key, safeCount(value)])
    .filter(([, value]) => value !== undefined));
}

function safeFamilyOutcomes(outcomes = []) {
  return (Array.isArray(outcomes) ? outcomes : []).slice(0, 100).map((outcome) => ({
    familyName: boundedText(outcome?.familyName, 'Control Family'),
    outcome: boundedText(outcome?.outcome, 'Unresolved'),
    ...(outcome?.message ? { message: 'Outcome requires attention.' } : {})
  }));
}

function safePolicyReconciliations(policies = []) {
  return (Array.isArray(policies) ? policies : []).slice(0, 100).map((policy) => ({
    policyNameSnapshot: boundedText(policy?.policyNameSnapshot, 'Policy'),
    organizationNameSnapshot: boundedText(policy?.organizationNameSnapshot, 'Organization'),
    familyChanges: safeFamilyOutcomes(policy?.familyChanges)
  }));
}

function safeErrorCategory(error) {
  const text = String(error || '').toLowerCase();
  if (text.includes('validation')) return 'Policy validation failed';
  if (text.includes('create')) return 'Action1 automation create failed';
  if (text.includes('update') || text.includes('patch')) return 'Action1 automation update failed';
  if (text.includes('cleanup') || text.includes('delete')) return 'Action1 automation cleanup incomplete';
  if (text.includes('control pack')) return 'Control Pack reference unavailable';
  if (text.includes('persist') || text.includes('database')) return 'Policy persistence failed';
  return 'Policy operation failed';
}

function safeErrors(errors = []) {
  return (Array.isArray(errors) ? errors : []).slice(0, 20).map(safeErrorCategory);
}

function createHistoryEnvelope(input = {}) {
  const { operation, policy, summary, counts, familyOutcomes, policies, errors } = input;
  if (!OPERATION_LABELS[operation]) throw new Error('Unsupported Configuration Manager History operation.');
  const envelope = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    operation,
    operationLabel: OPERATION_LABELS[operation],
    policyNameSnapshot: boundedText(policy?.displayName || input.policyNameSnapshot || '') || undefined,
    organizationNameSnapshot: boundedText(policy?.organizationNameSnapshot || input.organizationNameSnapshot || '') || undefined,
    summary: boundedText(summary, OPERATION_LABELS[operation]),
    counts: safeCounts(counts),
    familyOutcomes: safeFamilyOutcomes(familyOutcomes),
    policies: safePolicyReconciliations(policies),
    errors: safeErrors(errors)
  };
  return Object.fromEntries(Object.entries(envelope).filter(([, value]) => value !== undefined));
}

function serializeHistoryDetails(envelope) {
  const serialized = `${HISTORY_PREFIX} ${JSON.stringify(envelope)}`;
  if (serialized.length <= MAX_DETAILS_LENGTH) return serialized;
  return `${HISTORY_PREFIX} ${JSON.stringify({
    ...envelope,
    familyOutcomes: [],
    policies: [],
    errors: (envelope.errors || []).slice(0, 3),
    summary: boundedText(envelope.summary)
  })}`;
}

function extractHistoryEnvelope(details) {
  const text = String(details || '');
  const marker = text.lastIndexOf(HISTORY_PREFIX);
  if (marker < 0) return null;
  const jsonStart = text.indexOf('{', marker + HISTORY_PREFIX.length);
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(jsonStart).trim());
    if (parsed?.schemaVersion !== HISTORY_SCHEMA_VERSION || !OPERATION_LABELS[parsed.operation]) return null;
    return createHistoryEnvelope(parsed);
  } catch {
    return null;
  }
}

function resultDetails(envelope) {
  return serializeHistoryDetails(envelope);
}

module.exports = {
  HISTORY_PREFIX,
  HISTORY_SCHEMA_VERSION,
  OPERATION_LABELS,
  boundedText,
  createHistoryEnvelope,
  extractHistoryEnvelope,
  resultDetails,
  safePolicyReconciliations,
  safeCounts
};
