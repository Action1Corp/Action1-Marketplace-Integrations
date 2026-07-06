const LINKED_ISSUE_STATES = Object.freeze({
  NONE: 'none',
  OPEN: 'open',
  COMPLETED: 'completed',
  MISSING: 'missing'
});

const EXISTING_OPEN_ISSUE_BEHAVIOR = Object.freeze({
  UPDATE_EXISTING_OPEN: 'update_existing_open',
  SKIP_EXISTING_OPEN: 'skip_existing_open'
});

const LIFECYCLE_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  SKIP: 'SKIP'
});

const LIFECYCLE_REASONS = Object.freeze({
  NO_LINKED_ISSUE: 'NO_LINKED_ISSUE',
  LINKED_ISSUE_MISSING: 'LINKED_ISSUE_MISSING',
  LINKED_ISSUE_COMPLETED_CREATE_NEW: 'LINKED_ISSUE_COMPLETED_CREATE_NEW',
  OPEN_ISSUE_PAYLOAD_CHANGED: 'OPEN_ISSUE_PAYLOAD_CHANGED',
  OPEN_ISSUE_UNCHANGED: 'OPEN_ISSUE_UNCHANGED',
  OPEN_ISSUE_UPDATE_DISABLED: 'OPEN_ISSUE_UPDATE_DISABLED',
  SIGNAL_CLEARED_NO_ACTION: 'SIGNAL_CLEARED_NO_ACTION'
});

function decideLifecycleAction(input) {
  const normalized = normalizeDecisionInput(input);
  if (normalized.signalQualifies) {
    if (normalized.linkedIssueState === LINKED_ISSUE_STATES.NONE) return decision(LIFECYCLE_ACTIONS.CREATE, LIFECYCLE_REASONS.NO_LINKED_ISSUE, true);
    if (normalized.linkedIssueState === LINKED_ISSUE_STATES.MISSING) return decision(LIFECYCLE_ACTIONS.CREATE, LIFECYCLE_REASONS.LINKED_ISSUE_MISSING, true);
    if (normalized.linkedIssueState === LINKED_ISSUE_STATES.COMPLETED) return decision(LIFECYCLE_ACTIONS.CREATE, LIFECYCLE_REASONS.LINKED_ISSUE_COMPLETED_CREATE_NEW, true);
    if (normalized.existingOpenIssueBehavior === EXISTING_OPEN_ISSUE_BEHAVIOR.SKIP_EXISTING_OPEN) return decision(LIFECYCLE_ACTIONS.SKIP, LIFECYCLE_REASONS.OPEN_ISSUE_UPDATE_DISABLED, false);
    if (!normalized.payloadChanged) return decision(LIFECYCLE_ACTIONS.SKIP, LIFECYCLE_REASONS.OPEN_ISSUE_UNCHANGED, false);
    return decision(LIFECYCLE_ACTIONS.UPDATE, LIFECYCLE_REASONS.OPEN_ISSUE_PAYLOAD_CHANGED, true);
  }

  return decision(LIFECYCLE_ACTIONS.SKIP, LIFECYCLE_REASONS.SIGNAL_CLEARED_NO_ACTION, false);
}

function decision(action, reason, shouldWriteCorrelation) {
  return { action, reason, shouldWriteCorrelation, shouldClearCorrelation: false };
}

function normalizeDecisionInput(input) {
  const linkedIssueState = String(input?.linkedIssueState || LINKED_ISSUE_STATES.NONE).toLowerCase();
  const behavior = String(
    input?.existingOpenIssueBehavior || input?.existingOpenTicketBehavior || EXISTING_OPEN_ISSUE_BEHAVIOR.UPDATE_EXISTING_OPEN
  ).toLowerCase();
  return {
    signalQualifies: Boolean(input?.signalQualifies),
    linkedIssueState: Object.values(LINKED_ISSUE_STATES).includes(linkedIssueState) ? linkedIssueState : LINKED_ISSUE_STATES.NONE,
    existingOpenIssueBehavior: behavior === EXISTING_OPEN_ISSUE_BEHAVIOR.SKIP_EXISTING_OPEN ? EXISTING_OPEN_ISSUE_BEHAVIOR.SKIP_EXISTING_OPEN : EXISTING_OPEN_ISSUE_BEHAVIOR.UPDATE_EXISTING_OPEN,
    payloadChanged: input?.payloadChanged === undefined ? true : Boolean(input?.payloadChanged)
  };
}

module.exports = {
  EXISTING_OPEN_ISSUE_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  LINKED_ISSUE_STATES,
  decideLifecycleAction
};
