const { decideLifecycleAction, LINKED_TICKET_STATES, LIFECYCLE_ACTIONS } = require('./decisionModel');
const { buildTicketContentFromCandidate } = require('./ticketContentBuilder');
const { buildGroupedTicketContentFromCandidate, buildGroupedPayloadHashInput } = require('./groupedTicketContentBuilder');

function createLifecycleWriteOrchestrator(deps = {}) {
  if (!deps.providerDispatcher || typeof deps.providerDispatcher.invoke !== 'function') {
    throw new Error('lifecycle_orchestrator_missing_provider_dispatcher');
  }
  const providerId = String(deps.providerId || '').trim();
  if (!providerId) throw new Error('lifecycle_orchestrator_missing_provider_id');
  assertStore(deps.correlationStore);
  if (deps.correlationStore.providerId !== providerId) {
    throw new Error('lifecycle_orchestrator_provider_store_mismatch');
  }
  const nowFn = typeof deps.now === 'function' ? deps.now : Date.now;

  return { processCandidate };

  async function processCandidate(input = {}) {
    const candidate = input.candidate && typeof input.candidate === 'object' ? input.candidate : {};
    const identity = candidate.identity && typeof candidate.identity === 'object' ? candidate.identity : {};
    const ticketModel = normalizeTicketModel(candidate.ticketModel);
    const orgLinkId = asTrimmedString(identity.orgLinkId);
    const signalType = asTrimmedString(identity.signalType || candidate.signal?.type);
    const endpointId = asTrimmedString(identity.endpointId);
    const issueKey = asTrimmedString(candidate.issueKey || candidate.grouped?.issueKey);
    const identityKey = resolveIdentityKey(candidate, ticketModel, orgLinkId, endpointId, signalType, issueKey);
    if (!orgLinkId || !signalType || !identityKey || (ticketModel === 'endpoint' && !endpointId)) {
      throw new Error('lifecycle_orchestrator_invalid_candidate_identity');
    }

    // Candidate construction is qualification-gated. This defensive check ensures
    // direct internal callers cannot turn a cleared signal into lifecycle work.
    if (input.signalQualifies === false) return null;

    const correlation = await getCorrelationByMode({ correlationStore: deps.correlationStore, ticketModel, orgLinkId, endpointId, signalType, issueKey });
    const externalTicketRef = correlation?.externalTicketRef || (correlation?.linkedTicketId || correlation?.haloTicketId ? { id: String(correlation.linkedTicketId || correlation.haloTicketId) } : null);
    if (correlation && !externalTicketRef) {
      throw Object.assign(new Error('The stored ticket reference is invalid.'), { code: 'invalid_external_ticket_reference' });
    }
    const linkedTicket = await resolveLinkedTicket({
      providerDispatcher: deps.providerDispatcher,
      providerId,
      externalTicketRef,
      expectedRoute: candidate.routing || {},
      connection: deps.connection,
      transport: deps.transport,
      logger: deps.logger,
      readStats: input.readStats
    });

    if (!correlation && input.createGuard?.canCreate && !input.createGuard.canCreate(orgLinkId)) {
      return skipResult(identityKey, signalType, ticketModel, issueKey, LINKED_TICKET_STATES.NONE, input, 'ORG_OPEN_TICKET_LIMIT_REACHED');
    }

    const content = ticketModel === 'grouped'
      ? buildGroupedTicketContentFromCandidate({ candidate, action1BaseUrl: input.action1BaseUrl, maxImpactedEndpointsInGroupedTicket: input.maxImpactedEndpointsInGroupedTicket })
      : buildTicketContentFromCandidate({ candidate, action1BaseUrl: input.action1BaseUrl });
    const comparisonInput = ticketModel === 'grouped'
      ? buildGroupedPayloadHashInput({ candidate, action1BaseUrl: input.action1BaseUrl, maxImpactedEndpointsInGroupedTicket: input.maxImpactedEndpointsInGroupedTicket })
      : buildEndpointComparisonInput(candidate, content);
    const preparedCreate = await invoke(deps, 'prepareTicket', {
      candidate,
      content,
      effectiveRoute: candidate.routing || {},
      requestedOperation: 'CREATE',
      comparisonInput
    });
    const comparison = {
      value: preparedCreate.comparisonValue,
      version: preparedCreate.comparisonVersion
    };
    const payloadChanged = !correlation || String(correlation.comparisonVersion || '') !== comparison.version || String(correlation.comparisonValue ?? correlation.payloadHash ?? '') !== comparison.value;
    const linkedTicketState = linkedTicket.state;
    const decision = decideLifecycleAction({
      signalQualifies: true,
      linkedTicketState,
      existingOpenTicketBehavior: input.lifecycle?.existingOpenTicketBehavior,
      payloadChanged,
      closeWhenSignalClears: false
    });

    const result = {
      action: decision.action,
      reason: decision.reason,
      wroteTicket: false,
      wroteCorrelation: false,
      clearedCorrelation: false,
      correlationKey: identityKey,
      ticketId: externalTicketRef?.id || null,
      externalTicketRef: externalTicketRef || null,
      comparisonValue: comparison.value,
      comparisonVersion: comparison.version,
      decisionContext: {
        identityKey,
        signalType,
        ticketModel,
        issueKey: ticketModel === 'grouped' ? issueKey : '',
        correlationFound: Boolean(correlation),
        linkedTicketId: externalTicketRef?.id || '',
        linkedTicketState,
        payloadHashChanged: payloadChanged,
        existingOpenBehavior: String(input.lifecycle?.existingOpenTicketBehavior || ''),
        decision: decision.action,
        reason: decision.reason,
        payloadMeta: { summaryLength: String(content.summary || '').length, detailsLength: String(content.details || '').length, topItems: Number(content.topItems || content.visibleImpactedEndpoints?.length || 0) }
      }
    };

    if (decision.action === LIFECYCLE_ACTIONS.SKIP) return result;

    if (decision.action === LIFECYCLE_ACTIONS.CREATE) {
      if (input.createGuard?.canCreate && !input.createGuard.canCreate(orgLinkId)) {
        return skipResult(identityKey, signalType, ticketModel, issueKey, linkedTicketState, input, 'ORG_OPEN_TICKET_LIMIT_REACHED');
      }
      const created = await invoke(deps, 'createTicket', {
        preparedTicket: preparedCreate.payload,
        comparisonValue: comparison.value,
        comparisonVersion: comparison.version
      });
      await upsertCorrelationByMode({
        correlationStore: deps.correlationStore,
        candidate,
        ticketModel,
        issueKey,
        externalTicketRef: created.externalTicketRef,
        comparison,
        observedStatusId: created.observedStatusId,
        observedStatusName: created.observedStatusName,
        nowIso: new Date(nowFn()).toISOString(),
        prior: correlation
      });
      result.wroteTicket = true;
      result.wroteCorrelation = true;
      result.ticketId = created.externalTicketRef.id;
      result.externalTicketRef = created.externalTicketRef;
      input.createGuard?.onCreate?.(orgLinkId, result.ticketId);
      return result;
    }

    if (decision.action === LIFECYCLE_ACTIONS.UPDATE) {
      const preparedUpdate = await invoke(deps, 'prepareTicket', {
        candidate,
        content,
        effectiveRoute: candidate.routing || {},
        requestedOperation: 'UPDATE',
        comparisonInput
      });
      if (preparedUpdate.comparisonValue !== comparison.value || preparedUpdate.comparisonVersion !== comparison.version) {
        throw Object.assign(new Error('The ticketing system returned inconsistent managed-content comparison data.'), { code: 'provider_comparison_mismatch' });
      }
      const updated = await invoke(deps, 'updateTicket', {
        externalTicketRef: linkedTicket.externalTicketRef,
        expectedRoute: candidate.routing || {},
        preparedTicket: preparedUpdate.payload
      });
      const updatedReference = updated.externalTicketRef || linkedTicket.externalTicketRef;
      await upsertCorrelationByMode({
        correlationStore: deps.correlationStore,
        candidate,
        ticketModel,
        issueKey,
        externalTicketRef: updatedReference,
        comparison,
        observedStatusId: updated.observedStatusId || linkedTicket.observedStatusId,
        observedStatusName: updated.observedStatusName || linkedTicket.observedStatusName,
        nowIso: new Date(nowFn()).toISOString(),
        prior: correlation
      });
      result.wroteTicket = true;
      result.wroteCorrelation = true;
      result.ticketId = updatedReference.id;
      result.externalTicketRef = updatedReference;
      return result;
    }

    // CLOSE remains a legacy decision-model characterization only. No active
    // provider operation or correlation deletion is exposed for it here.
    return result;
  }
}

async function resolveLinkedTicket(input) {
  if (!input.externalTicketRef) return { state: LINKED_TICKET_STATES.NONE, externalTicketRef: null };
  if (typeof input.externalTicketRef.id !== 'string' || !input.externalTicketRef.id.trim()) {
    throw Object.assign(new Error('The stored ticket reference is invalid.'), { code: 'invalid_external_ticket_reference' });
  }
  input.readStats?.recordLinkedStateRead?.(input.externalTicketRef.id);
  const ticket = await input.providerDispatcher.invoke({
    providerId: input.providerId,
    operation: 'getTicket',
    input: { externalTicketRef: input.externalTicketRef, expectedRoute: input.expectedRoute },
    ...(input.connection === undefined ? {} : { connection: input.connection }),
    ...(input.transport === undefined ? {} : { transport: input.transport }),
    ...(input.logger === undefined ? {} : { logger: input.logger })
  });
  if (ticket.state === 'missing' && ticket.confirmed === true) return { state: LINKED_TICKET_STATES.MISSING, externalTicketRef: input.externalTicketRef };
  if (ticket.state === 'found' && ['open', 'closed'].includes(ticket.openState)) {
    return {
      state: ticket.openState === 'closed' ? LINKED_TICKET_STATES.CLOSED : LINKED_TICKET_STATES.OPEN,
      externalTicketRef: ticket.externalTicketRef,
      observedStatusId: ticket.observedStatusId || null,
      observedStatusName: ticket.observedStatusName || null
    };
  }
  throw Object.assign(new Error('The ticketing system returned an unknown ticket state.'), { code: 'unknown_ticket_state' });
}

async function invoke(deps, operation, input) {
  return deps.providerDispatcher.invoke({
    providerId: deps.providerId,
    operation,
    input,
    ...(deps.connection === undefined ? {} : { connection: deps.connection }),
    ...(deps.transport === undefined ? {} : { transport: deps.transport }),
    ...(deps.logger === undefined ? {} : { logger: deps.logger })
  });
}

async function upsertCorrelationByMode(input) {
  const candidate = input.candidate || {};
  const identity = candidate.identity || {};
  const shared = {
    orgLinkId: asTrimmedString(identity.orgLinkId),
    action1OrgId: asTrimmedString(candidate.routing?.action1OrgId),
    externalTicketRef: input.externalTicketRef,
    comparisonValue: input.comparison.value,
    comparisonVersion: input.comparison.version,
    observedStatusId: input.observedStatusId || null,
    observedStatusName: input.observedStatusName || null,
    createdAt: input.prior?.createdAt || input.nowIso,
    updatedAt: input.nowIso
  };
  if (input.ticketModel === 'grouped') {
    await input.correlationStore.upsertGroupedCorrelation({
      ...shared,
      mode: 'grouped',
      identityKey: asTrimmedString(identity.identityKey) || `${asTrimmedString(identity.orgLinkId)}|${asTrimmedString(identity.signalType)}|${asTrimmedString(input.issueKey)}`,
      signalType: asTrimmedString(identity.signalType),
      issueKey: asTrimmedString(input.issueKey),
      linkedTicketId: input.externalTicketRef.id,
      payloadHash: input.comparison.value
    });
    return;
  }
  await input.correlationStore.upsertEndpointCorrelation({
    ...shared,
    endpointId: asTrimmedString(identity.endpointId),
    signalType: asTrimmedString(identity.signalType),
    linkedTicketId: input.externalTicketRef.id,
    haloTicketId: input.externalTicketRef.id,
    payloadHash: input.comparison.value
  });
}

async function getCorrelationByMode(input) {
  return input.ticketModel === 'grouped'
    ? input.correlationStore.getGroupedCorrelation(input.orgLinkId, input.signalType, input.issueKey)
    : input.correlationStore.getEndpointCorrelation(input.orgLinkId, input.endpointId, input.signalType);
}

function buildEndpointComparisonInput(candidate, content) {
  const routing = candidate.routing && typeof candidate.routing === 'object' ? candidate.routing : {};
  return {
    mode: 'endpoint',
    summary: content.summary,
    details: content.details,
    detailsHtml: content.detailsHtml || '',
    route: {
      destinationId: routing.destinationId || routing.haloClientId || '',
      ticketTypeId: routing.ticketTypeId || '',
      statusId: routing.newStatusId || '',
      teamId: routing.teamId || '',
      categoryId: routing.category1Id || ''
    }
  };
}

function skipResult(identityKey, signalType, ticketModel, issueKey, linkedTicketState, input, reason) {
  return {
    action: LIFECYCLE_ACTIONS.SKIP,
    reason,
    wroteTicket: false,
    wroteCorrelation: false,
    clearedCorrelation: false,
    correlationKey: identityKey,
    ticketId: null,
    payloadHash: '',
    decisionContext: {
      identityKey,
      signalType,
      ticketModel,
      issueKey: ticketModel === 'grouped' ? issueKey : '',
      correlationFound: false,
      linkedTicketId: '',
      linkedTicketState,
      payloadHashChanged: true,
      existingOpenBehavior: String(input.lifecycle?.existingOpenTicketBehavior || ''),
      decision: LIFECYCLE_ACTIONS.SKIP,
      reason,
      payloadMeta: { summaryLength: 0, detailsLength: 0, topItems: 0 }
    }
  };
}

function normalizeTicketModel(value) {
  return String(value || '').trim().toLowerCase() === 'grouped' ? 'grouped' : 'endpoint';
}

function resolveIdentityKey(candidate, ticketModel, orgLinkId, endpointId, signalType, issueKey) {
  const explicitKey = asTrimmedString(candidate.identity?.key);
  if (explicitKey) return explicitKey;
  const explicitGroupedKey = asTrimmedString(candidate.identity?.identityKey);
  if (explicitGroupedKey) return explicitGroupedKey;
  if (ticketModel === 'grouped') return orgLinkId && signalType && issueKey ? `${orgLinkId}|${signalType}|${issueKey}` : '';
  return orgLinkId && endpointId && signalType ? `${orgLinkId}|${endpointId}|${signalType}` : '';
}

function assertStore(store) {
  const required = ['getEndpointCorrelation', 'upsertEndpointCorrelation', 'getGroupedCorrelation', 'upsertGroupedCorrelation', 'listCorrelationsByOrgLink'];
  for (const method of required) if (typeof store?.[method] !== 'function') throw new Error(`lifecycle_orchestrator_missing_correlationStore_${method}`);
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashPayload(payload) {
  return stableStringify(payload);
}

module.exports = { createLifecycleWriteOrchestrator, hashPayload };
