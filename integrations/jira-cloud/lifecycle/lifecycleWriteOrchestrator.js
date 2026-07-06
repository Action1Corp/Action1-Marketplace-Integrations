const { decideLifecycleAction, LINKED_ISSUE_STATES, LIFECYCLE_ACTIONS } = require('./decisionModel');
const { buildJiraIssuePayload, hashPayload, stableStringify } = require('../issuePayloadBuilder');
const COMPLETED_STATUS_CATEGORY_KEYS = new Set(['completed', 'done']);

function createLifecycleWriteOrchestrator(deps) {
  assertMethod('jiraApi', deps?.jiraApi, 'createIssue');
  assertMethod('jiraApi', deps?.jiraApi, 'updateIssue');
  assertMethod('jiraApi', deps?.jiraApi, 'getIssue');
  assertMethod('correlationStore', deps?.correlationStore, 'getCorrelation');
  assertMethod('correlationStore', deps?.correlationStore, 'upsertCorrelation');
  assertMethod('correlationStore', deps?.correlationStore, 'getGroupedCorrelation');
  assertMethod('correlationStore', deps?.correlationStore, 'upsertGroupedCorrelation');
  const nowFn = typeof deps.now === 'function' ? deps.now : Date.now;

  return { processCandidate };

  async function processCandidate(input) {
    const candidate = input?.candidate && typeof input.candidate === 'object' ? input.candidate : {};
    const identity = candidate.identity && typeof candidate.identity === 'object' ? candidate.identity : {};
    const ticketModel = normalizeTicketModel(candidate?.ticketModel);
    const orgLinkId = asTrimmedString(identity.orgLinkId);
    const signalType = asTrimmedString(identity.signalType || candidate?.signal?.type);
    const endpointId = asTrimmedString(identity.endpointId);
    const issueKey = asTrimmedString(candidate?.issueKey || candidate?.grouped?.issueKey);
    const identityKey = resolveIdentityKey(candidate, ticketModel, orgLinkId, endpointId, signalType, issueKey);
    if (!orgLinkId || !signalType || !identityKey || (ticketModel === 'endpoint' && !endpointId)) throw new Error('lifecycle_orchestrator_invalid_candidate_identity');

    const correlation = await getCorrelationByMode({
      correlationStore: deps.correlationStore,
      ticketModel,
      orgLinkId,
      endpointId,
      signalType,
      issueKey
    });
    const linkedIssueRead = await resolveLinkedIssue({
      jiraApi: deps.jiraApi,
      correlation
    });
    const linkedIssue = linkedIssueRead.issue;
    const linkedIssueCompleted = isLinkedIssueCompleted(linkedIssue);
    const linkedIssueState = linkedIssue
      ? linkedIssueCompleted ? LINKED_ISSUE_STATES.COMPLETED : LINKED_ISSUE_STATES.OPEN
      : correlation ? LINKED_ISSUE_STATES.MISSING : LINKED_ISSUE_STATES.NONE;
    if (!correlation && Boolean(input?.signalQualifies) && input?.createGuard?.canCreate && !input.createGuard.canCreate(orgLinkId)) {
      return skipResult(identityKey, signalType, ticketModel, issueKey, linkedIssueState, input, 'ORG_OPEN_TICKET_LIMIT_REACHED');
    }
    const builtPayload = buildJiraIssuePayload({
      candidate,
      action1BaseUrl: input?.action1BaseUrl,
      maxImpactedEndpointsInGroupedTicket: input?.maxImpactedEndpointsInGroupedTicket
    });
    const payloadHash = asTrimmedString(builtPayload.payloadHash) || hashPayload(builtPayload.payload);
    const decision = decideLifecycleAction({
      signalQualifies: Boolean(input?.signalQualifies),
      linkedIssueState,
      existingOpenIssueBehavior: input?.lifecycle?.existingOpenIssueBehavior || input?.lifecycle?.existingOpenTicketBehavior,
      payloadChanged: correlation ? String(correlation.payloadHash || '') !== payloadHash : true,
      createNewWhenLinkedClosed: input?.lifecycle?.createNewWhenLinkedClosed
    });
    const linkedIssueId = extractCorrelationIssueId(correlation);
    const linkedIssueKey = extractCorrelationIssueKey(correlation);

    const result = {
      action: decision.action,
      reason: decision.reason,
      wroteIssue: false,
      wroteCorrelation: false,
      clearedCorrelation: false,
      correlationKey: identityKey,
      issueId: linkedIssueId || null,
      issueKey: linkedIssueKey || null,
      issueUrl: correlation?.jiraIssueUrl || correlation?.linkedIssueUrl || null,
      payloadHash,
      decisionContext: {
        identityKey,
        signalType,
        ticketModel,
        issueKey: ticketModel === 'grouped' ? issueKey : '',
        correlationFound: Boolean(correlation),
        linkedIssueId: linkedIssueId || '',
        linkedIssueKey: linkedIssueKey || '',
        linkedIssueRead: linkedIssueRead.state,
        linkedIssueState,
        linkedIssueStatusName: linkedIssue?.statusName || correlation?.linkedIssueStatus || '',
        linkedIssueStatusCategoryKey: linkedIssue?.statusCategoryKey || '',
        linkedIssueCompleted,
        payloadHashChanged: correlation ? String(correlation.payloadHash || '') !== payloadHash : true,
        existingOpenBehavior: String(input?.lifecycle?.existingOpenIssueBehavior || input?.lifecycle?.existingOpenTicketBehavior || ''),
        createNewWhenLinkedClosed: input?.lifecycle?.createNewWhenLinkedClosed === undefined ? true : Boolean(input?.lifecycle?.createNewWhenLinkedClosed),
        decision: decision.action,
        reason: decision.reason,
        payloadMeta: {
          summaryLength: String(builtPayload.summary || '').length,
          labels: Array.isArray(builtPayload.labels) ? builtPayload.labels.length : 0
        }
      }
    };

    if (decision.action === LIFECYCLE_ACTIONS.SKIP) {
      return result;
    }

    if (decision.action === LIFECYCLE_ACTIONS.CREATE) {
      if (input?.createGuard?.canCreate && !input.createGuard.canCreate(orgLinkId)) {
        return skipResult(identityKey, signalType, ticketModel, issueKey, linkedIssueState, input, 'ORG_OPEN_TICKET_LIMIT_REACHED');
      }
      const created = await deps.jiraApi.createIssue(builtPayload.payload);
      await upsertCorrelationByMode({
        correlationStore: deps.correlationStore,
        candidate,
        ticketModel,
        issueKey,
        issueId: created.id,
        issueKeyValue: created.key,
        issueUrl: created.browseUrl || created.self || null,
        payloadHash,
        statusName: created.statusName || linkedIssue?.statusName || null,
        nowIso: new Date(nowFn()).toISOString(),
        prior: correlation
      });
      result.wroteIssue = true;
      result.wroteCorrelation = true;
      result.issueId = String(created.id || '');
      result.issueKey = String(created.key || '');
      result.issueUrl = created.browseUrl || created.self || null;
      input?.createGuard?.onCreate?.(orgLinkId, result.issueId || result.issueKey);
      return result;
    }

    if (decision.action === LIFECYCLE_ACTIONS.UPDATE) {
      const issueIdOrKey = linkedIssueId || linkedIssueKey;
      await deps.jiraApi.updateIssue(issueIdOrKey, builtPayload.payload);
      await upsertCorrelationByMode({
        correlationStore: deps.correlationStore,
        candidate,
        ticketModel,
        issueKey,
        issueId: linkedIssueId || linkedIssue?.id || '',
        issueKeyValue: linkedIssueKey || linkedIssue?.key || '',
        issueUrl: linkedIssue?.browseUrl || correlation?.jiraIssueUrl || correlation?.linkedIssueUrl || null,
        payloadHash,
        statusName: linkedIssue?.statusName || correlation?.linkedIssueStatus || null,
        nowIso: new Date(nowFn()).toISOString(),
        prior: correlation
      });
      result.wroteIssue = true;
      result.wroteCorrelation = true;
      return result;
    }

    return result;
  }
}

function skipResult(identityKey, signalType, ticketModel, issueKey, linkedIssueState, input, reason) {
  return {
    action: LIFECYCLE_ACTIONS.SKIP,
    reason,
    wroteIssue: false,
    wroteCorrelation: false,
    clearedCorrelation: false,
    correlationKey: identityKey,
    issueId: null,
    issueKey: null,
    issueUrl: null,
    payloadHash: '',
    decisionContext: {
      identityKey,
      signalType,
      ticketModel,
      issueKey: ticketModel === 'grouped' ? issueKey : '',
      correlationFound: false,
      linkedIssueId: '',
      linkedIssueKey: '',
      linkedIssueRead: 'not_attempted',
      linkedIssueState,
      linkedIssueStatusName: '',
      linkedIssueStatusCategoryKey: '',
      linkedIssueCompleted: false,
      payloadHashChanged: true,
      existingOpenBehavior: String(input?.lifecycle?.existingOpenIssueBehavior || input?.lifecycle?.existingOpenTicketBehavior || ''),
      createNewWhenLinkedClosed: input?.lifecycle?.createNewWhenLinkedClosed === undefined ? true : Boolean(input?.lifecycle?.createNewWhenLinkedClosed),
      decision: LIFECYCLE_ACTIONS.SKIP,
      reason,
      payloadMeta: {
        summaryLength: 0,
        labels: 0
      }
    }
  };
}

async function resolveLinkedIssue(input) {
  const issueIdOrKey = extractCorrelationIssueId(input?.correlation) || extractCorrelationIssueKey(input?.correlation);
  if (!issueIdOrKey) {
    return { state: 'not_attempted', issue: null };
  }

  try {
    const issue = await input.jiraApi.getIssue(issueIdOrKey);
    if (!issue) {
      return { state: 'not_found', issue: null };
    }
    return { state: 'ok', issue };
  } catch (error) {
    error.safeDecisionContext = {
      linkedIssueRead: 'failed',
      linkedIssueId: extractCorrelationIssueId(input?.correlation),
      linkedIssueKey: extractCorrelationIssueKey(input?.correlation)
    };
    throw error;
  }
}

async function upsertCorrelationByMode(input) {
  const candidate = input.candidate || {};
  const identity = candidate.identity || {};
  const baseRecord = {
    action1OrgId: asTrimmedString(candidate?.routing?.action1OrgId),
    payloadHash: asTrimmedString(input.payloadHash),
    jiraIssueId: asTrimmedString(input.issueId),
    jiraIssueKey: asTrimmedString(input.issueKeyValue),
    jiraIssueUrl: asTrimmedString(input.issueUrl),
    linkedIssueStatus: input.statusName ? asTrimmedString(input.statusName) : null,
    createdAt: input.prior?.createdAt || input.nowIso,
    updatedAt: input.nowIso
  };

  if (input.ticketModel === 'grouped') {
    await input.correlationStore.upsertGroupedCorrelation({
      ...baseRecord,
      mode: 'grouped',
      identityKey: asTrimmedString(identity.identityKey) || asTrimmedString(identity.key) || `${asTrimmedString(identity.orgLinkId)}|${asTrimmedString(identity.signalType)}|${asTrimmedString(input.issueKey)}`,
      orgLinkId: asTrimmedString(identity.orgLinkId),
      signalType: asTrimmedString(identity.signalType),
      issueKey: asTrimmedString(input.issueKey)
    });
    return;
  }

  await input.correlationStore.upsertCorrelation({
    ...baseRecord,
    orgLinkId: asTrimmedString(identity.orgLinkId),
    endpointId: asTrimmedString(identity.endpointId),
    signalType: asTrimmedString(identity.signalType)
  });
}

async function getCorrelationByMode(input) {
  return input.ticketModel === 'grouped'
    ? input.correlationStore.getGroupedCorrelation(input.orgLinkId, input.signalType, input.issueKey)
    : input.correlationStore.getCorrelation(input.orgLinkId, input.endpointId, input.signalType);
}

function normalizeTicketModel(value) {
  return String(value || '').trim().toLowerCase() === 'grouped' ? 'grouped' : 'endpoint';
}

function resolveIdentityKey(candidate, ticketModel, orgLinkId, endpointId, signalType, issueKey) {
  const explicitKey = asTrimmedString(candidate?.identity?.key);
  if (explicitKey) return explicitKey;
  const explicitGroupedKey = asTrimmedString(candidate?.identity?.identityKey);
  if (explicitGroupedKey) return explicitGroupedKey;
  if (ticketModel === 'grouped') return orgLinkId && signalType && issueKey ? `${orgLinkId}|${signalType}|${issueKey}` : '';
  return orgLinkId && endpointId && signalType ? `${orgLinkId}|${endpointId}|${signalType}` : '';
}

function extractCorrelationIssueId(correlation) {
  return asTrimmedString(correlation?.jiraIssueId || correlation?.linkedIssueId);
}

function extractCorrelationIssueKey(correlation) {
  return asTrimmedString(correlation?.jiraIssueKey || correlation?.linkedIssueKey);
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

function isLinkedIssueCompleted(issue) {
  if (!issue || typeof issue !== 'object') {
    return false;
  }
  if (issue.completed === true) {
    return true;
  }
  return COMPLETED_STATUS_CATEGORY_KEYS.has(asTrimmedString(issue.statusCategoryKey).toLowerCase());
}

function assertMethod(name, value, method) {
  if (!value || typeof value !== 'object' || typeof value[method] !== 'function') {
    throw new Error(`lifecycle_orchestrator_missing_${name}_${method}`);
  }
}

module.exports = {
  createLifecycleWriteOrchestrator,
  hashPayload,
  stableStringify
};
