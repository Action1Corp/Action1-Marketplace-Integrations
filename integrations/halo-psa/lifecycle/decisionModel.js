const LINKED_TICKET_STATES = Object.freeze({
  NONE: 'none',
  OPEN: 'open',
  CLOSED: 'closed',
  MISSING: 'missing'
});

const EXISTING_OPEN_TICKET_BEHAVIOR = Object.freeze({
  UPDATE_EXISTING_OPEN: 'update_existing_open',
  SKIP_EXISTING_OPEN: 'skip_existing_open'
});

const LIFECYCLE_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  CLOSE: 'CLOSE',
  SKIP: 'SKIP'
});

const LIFECYCLE_REASONS = Object.freeze({
  NO_LINKED_TICKET: 'NO_LINKED_TICKET',
  LINKED_TICKET_MISSING: 'LINKED_TICKET_MISSING',
  LINKED_TICKET_CLOSED_CREATE_NEW: 'LINKED_TICKET_CLOSED_CREATE_NEW',
  OPEN_TICKET_PAYLOAD_CHANGED: 'OPEN_TICKET_PAYLOAD_CHANGED',
  OPEN_TICKET_UNCHANGED: 'OPEN_TICKET_UNCHANGED',
  OPEN_TICKET_UPDATE_DISABLED: 'OPEN_TICKET_UPDATE_DISABLED',
  SIGNAL_CLEARED_CLOSE_LINKED_OPEN: 'SIGNAL_CLEARED_CLOSE_LINKED_OPEN',
  SIGNAL_CLEARED_NO_ACTION: 'SIGNAL_CLEARED_NO_ACTION'
});

function decideLifecycleAction(input) {
  const normalized = normalizeDecisionInput(input);
  if (normalized.signalQualifies) {
    if (normalized.linkedTicketState === LINKED_TICKET_STATES.NONE) return decision(LIFECYCLE_ACTIONS.CREATE, LIFECYCLE_REASONS.NO_LINKED_TICKET, true, false);
    if (normalized.linkedTicketState === LINKED_TICKET_STATES.MISSING) return decision(LIFECYCLE_ACTIONS.CREATE, LIFECYCLE_REASONS.LINKED_TICKET_MISSING, true, false);
    if (normalized.linkedTicketState === LINKED_TICKET_STATES.CLOSED) return decision(LIFECYCLE_ACTIONS.CREATE, LIFECYCLE_REASONS.LINKED_TICKET_CLOSED_CREATE_NEW, true, false);
    if (normalized.existingOpenTicketBehavior === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN) return decision(LIFECYCLE_ACTIONS.SKIP, LIFECYCLE_REASONS.OPEN_TICKET_UPDATE_DISABLED, false, false);
    if (!normalized.payloadChanged) return decision(LIFECYCLE_ACTIONS.SKIP, LIFECYCLE_REASONS.OPEN_TICKET_UNCHANGED, false, false);
    return decision(LIFECYCLE_ACTIONS.UPDATE, LIFECYCLE_REASONS.OPEN_TICKET_PAYLOAD_CHANGED, true, false);
  }
  if (normalized.linkedTicketState === LINKED_TICKET_STATES.OPEN && normalized.closeWhenSignalClears) {
    return decision(LIFECYCLE_ACTIONS.CLOSE, LIFECYCLE_REASONS.SIGNAL_CLEARED_CLOSE_LINKED_OPEN, false, true);
  }
  return decision(LIFECYCLE_ACTIONS.SKIP, LIFECYCLE_REASONS.SIGNAL_CLEARED_NO_ACTION, false, false);
}

function decision(action, reason, shouldWriteCorrelation, shouldClearCorrelation) {
  return { action, reason, shouldWriteCorrelation, shouldClearCorrelation };
}

function normalizeDecisionInput(input) {
  const linkedTicketState = String(input?.linkedTicketState || LINKED_TICKET_STATES.NONE).toLowerCase();
  const behavior = String(input?.existingOpenTicketBehavior || EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN).toLowerCase();
  return {
    signalQualifies: Boolean(input?.signalQualifies),
    linkedTicketState: Object.values(LINKED_TICKET_STATES).includes(linkedTicketState) ? linkedTicketState : LINKED_TICKET_STATES.NONE,
    existingOpenTicketBehavior: behavior === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN ? EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN : EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
    payloadChanged: input?.payloadChanged === undefined ? true : Boolean(input?.payloadChanged),
    closeWhenSignalClears: input?.closeWhenSignalClears === undefined ? true : Boolean(input?.closeWhenSignalClears)
  };
}

module.exports = {
  EXISTING_OPEN_TICKET_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  LINKED_TICKET_STATES,
  decideLifecycleAction
};
