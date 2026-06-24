const {
  LINKED_TICKET_STATES,
  EXISTING_OPEN_TICKET_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  decideLifecycleAction
} = require('./decisionModel');
const { buildHaloCreateTicketPayload, resolveCategory1String } = require('./ticketPayloadBuilder');
const { createLifecycleWriteOrchestrator, hashPayload } = require('./lifecycleWriteOrchestrator');
const { buildTicketContentFromCandidate, buildAction1EndpointUrl } = require('./ticketContentBuilder');
const { buildGroupedTicketContentFromCandidate, buildGroupedPayloadHashInput, buildGroupedProblemUrl } = require('./groupedTicketContentBuilder');

module.exports = {
  LINKED_TICKET_STATES,
  EXISTING_OPEN_TICKET_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  decideLifecycleAction,
  buildHaloCreateTicketPayload,
  resolveCategory1String,
  buildTicketContentFromCandidate,
  buildAction1EndpointUrl,
  buildGroupedTicketContentFromCandidate,
  buildGroupedPayloadHashInput,
  buildGroupedProblemUrl,
  createLifecycleWriteOrchestrator,
  hashPayload
};
