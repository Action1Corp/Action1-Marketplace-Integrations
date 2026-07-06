const { createLifecycleWriteOrchestrator } = require('./lifecycle');
const { emitLog, LOG_EVENT_TYPES, LOG_LEVELS } = require('./runtimeLogging');

const DEFAULT_MAX_OPEN_ISSUES_PER_ORG = 30;

function createLifecycleRunService(deps = {}) {
  const orchestrator = deps.lifecycleWriteOrchestrator || createLifecycleWriteOrchestrator({ jiraApi: deps.jiraApi, correlationStore: deps.correlationStore, now: deps.now });

  return { runOnce };

  async function runOnce(input = {}) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const runLogger = input?.runLogger || deps.runLogger || null;
    const lifecycle = normalizeLifecyclePolicy(input);
    const safeguards = normalizeOperationalSafeguards(input);
    const normalized = candidates.map((row, index) => normalizeWorkItem(row, index)).sort(compareWorkItemsForLifecycleProcessing);
    const seen = new Set();
    const createGuard = await buildCreateGuard({
      deps,
      candidates: normalized,
      maxOpenIssuesPerOrganization: safeguards.maxOpenTicketsPerOrganization
    });
    const results = [];
    const summary = { candidatesSeen: candidates.length, created: 0, updated: 0, skipped: 0, failed: 0, bySignalType: {}, skippedByReason: {}, failuresByReason: {}, failureExamplesByReason: {} };

    for (const item of normalized) {
      const signalType = item.signalType || 'UNKNOWN';
      summary.bySignalType[signalType] = Number(summary.bySignalType[signalType] || 0) + 1;
      if (!item.identityKey) {
        summary.failed += 1;
        summary.failuresByReason.invalid_candidate_identity = Number(summary.failuresByReason.invalid_candidate_identity || 0) + 1;
        results.push({ identityKey: '', signalType, action: 'ERROR', status: 'failed', reason: 'invalid_candidate_identity', error: 'invalid_candidate_identity' });
        continue;
      }
      if (seen.has(item.identityKey)) {
        summary.skipped += 1;
        summary.skippedByReason.duplicate_candidate = Number(summary.skippedByReason.duplicate_candidate || 0) + 1;
        results.push({ identityKey: item.identityKey, signalType, action: 'SKIP', status: 'skipped', reason: 'duplicate_candidate' });
        continue;
      }
      seen.add(item.identityKey);

      try {
        const outcome = await orchestrator.processCandidate({
          candidate: item.candidate,
          signalQualifies: item.signalQualifies,
          lifecycle,
          createGuard,
          action1BaseUrl: asTrimmedString(input?.config?.connections?.action1?.baseUrl),
          maxImpactedEndpointsInGroupedTicket: input?.config?.maxImpactedEndpointsInGroupedTicket
        });
        const action = String(outcome?.action || 'SKIP').toUpperCase();
        const reason = asTrimmedString(outcome?.reason) || undefined;
        const issueId = asTrimmedString(outcome?.issueId) || undefined;
        const issueKey = asTrimmedString(outcome?.issueKey) || undefined;
        const status = action === 'SKIP' ? 'skipped' : 'success';
        if (action === 'CREATE') summary.created += 1;
        else if (action === 'UPDATE') summary.updated += 1;
        else summary.skipped += 1;
        if (action === 'SKIP' && reason) summary.skippedByReason[reason] = Number(summary.skippedByReason[reason] || 0) + 1;
        incrementSignalReason(summary.bySignalAndReason || (summary.bySignalAndReason = {}), signalType, reason || 'UNKNOWN');
        await emitLifecycleDecisionLog(runLogger, {
          signalType,
          identityKey: item.identityKey,
          action,
          reason,
          outcome
        });
        results.push({ identityKey: item.identityKey, signalType, action, status, issueId, issueKey, reason });
      } catch (error) {
        const sanitized = sanitizeError(error);
        summary.failed += 1;
        summary.failuresByReason[sanitized.code] = Number(summary.failuresByReason[sanitized.code] || 0) + 1;
        if (sanitized.detail && !summary.failureExamplesByReason[sanitized.code]) summary.failureExamplesByReason[sanitized.code] = sanitized.detail;
        incrementSignalReason(summary.bySignalAndReason || (summary.bySignalAndReason = {}), signalType, sanitized.code);
        await emitLifecycleDecisionLog(runLogger, {
          signalType,
          identityKey: item.identityKey,
          action: 'ERROR',
          reason: sanitized.code,
          item,
          error
        });
        results.push({ identityKey: item.identityKey, signalType, action: 'ERROR', status: 'failed', reason: sanitized.code, error: sanitized.message, ...(sanitized.detail ? { detail: sanitized.detail } : {}) });
      }
    }

    await emitLifecycleReasonSummary(runLogger, summary);
    return { ok: summary.failed === 0, summary, results };
  }
}

function normalizeWorkItem(row, index) {
  const useEnvelope = row && typeof row === 'object' && row.candidate && typeof row.candidate === 'object';
  const candidate = useEnvelope ? row.candidate : row;
  const signalQualifies = useEnvelope && typeof row.signalQualifies === 'boolean' ? row.signalQualifies : typeof row?.signalQualifies === 'boolean' ? row.signalQualifies : true;
  return { inputIndex: index, candidate, signalQualifies, identityKey: extractIdentityKey(candidate), signalType: extractSignalType(candidate) };
}

function extractIdentityKey(candidate) {
  const key = asTrimmedString(candidate?.identity?.key);
  if (key) return key;
  const groupedIdentityKey = asTrimmedString(candidate?.identity?.identityKey);
  if (groupedIdentityKey) return groupedIdentityKey;
  const orgLinkId = asTrimmedString(candidate?.identity?.orgLinkId);
  const endpointId = asTrimmedString(candidate?.identity?.endpointId);
  const signalType = asTrimmedString(candidate?.identity?.signalType);
  if (!orgLinkId || !signalType) return '';
  if (String(candidate?.ticketModel || '').trim().toLowerCase() === 'grouped') {
    const issueKey = asTrimmedString(candidate?.issueKey || candidate?.grouped?.issueKey);
    return issueKey ? `${orgLinkId}|${signalType}|${issueKey}` : '';
  }
  return endpointId ? `${orgLinkId}|${endpointId}|${signalType}` : '';
}

function extractSignalType(candidate) {
  return asTrimmedString(candidate?.identity?.signalType) || asTrimmedString(candidate?.signal?.type) || 'UNKNOWN';
}

function normalizeLifecyclePolicy(input) {
  const lifecycle = input?.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const cfg = input?.config && typeof input.config === 'object' ? input.config : {};
  const cfgLifecycle = cfg.lifecycle && typeof cfg.lifecycle === 'object' ? cfg.lifecycle : {};
  return {
    existingOpenIssueBehavior: asTrimmedString(lifecycle.existingOpenIssueBehavior) || asTrimmedString(lifecycle.existingOpenTicketBehavior) || asTrimmedString(cfgLifecycle.existingOpenIssueBehavior) || 'update_existing_open',
    closeWhenSignalClears: lifecycle.closeWhenSignalClears !== undefined ? Boolean(lifecycle.closeWhenSignalClears) : cfgLifecycle.closeWhenSignalClears !== undefined ? Boolean(cfgLifecycle.closeWhenSignalClears) : false,
    createNewWhenLinkedClosed: lifecycle.createNewWhenLinkedClosed !== undefined ? Boolean(lifecycle.createNewWhenLinkedClosed) : cfgLifecycle.createNewWhenLinkedClosed !== undefined ? Boolean(cfgLifecycle.createNewWhenLinkedClosed) : true,
    reopenClosedTickets: false
  };
}

function normalizeOperationalSafeguards(input) {
  const cfg = input?.config && typeof input.config === 'object' ? input.config : {};
  const operational = cfg.operationalSafeguards && typeof cfg.operationalSafeguards === 'object' ? cfg.operationalSafeguards : {};
  const maxOpen = Number(operational.maxOpenTicketsPerOrganization);
  return {
    enableDebugLogging: Boolean(operational.enableDebugLogging),
    maxOpenTicketsPerOrganization: Number.isInteger(maxOpen) && maxOpen > 0 ? maxOpen : DEFAULT_MAX_OPEN_ISSUES_PER_ORG
  };
}

function compareWorkItemsForLifecycleProcessing(a, b) {
  const orgA = asTrimmedString(a?.candidate?.identity?.orgLinkId);
  const orgB = asTrimmedString(b?.candidate?.identity?.orgLinkId);
  if (orgA < orgB) return -1;
  if (orgA > orgB) return 1;
  const keyA = String(a?.identityKey || `~invalid~${a?.inputIndex || 0}`);
  const keyB = String(b?.identityKey || `~invalid~${b?.inputIndex || 0}`);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return Number(a?.inputIndex || 0) - Number(b?.inputIndex || 0);
}

async function emitLifecycleDecisionLog(runLogger, input) {
  const ctx = input?.outcome?.decisionContext && typeof input.outcome.decisionContext === 'object'
    ? input.outcome.decisionContext
    : {};
  const fallbackItem = input?.item?.candidate || {};
  await emitLog({
    runLogger,
    runId: 'jira-sync',
    level: input?.action === 'ERROR' ? LOG_LEVELS.WARN : LOG_LEVELS.INFO,
    eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
    message: 'Jira lifecycle decision.',
    context: {
      identityKey: String(ctx.identityKey || input?.identityKey || ''),
      ticketModel: String(ctx.ticketModel || fallbackItem?.ticketModel || 'endpoint'),
      signalType: String(ctx.signalType || input?.signalType || ''),
      correlationFound: Boolean(ctx.correlationFound),
      linkedIssueId: String(ctx.linkedIssueId || input?.error?.safeDecisionContext?.linkedIssueId || ''),
      linkedIssueKey: String(ctx.linkedIssueKey || input?.error?.safeDecisionContext?.linkedIssueKey || ''),
      linkedIssueRead: String(ctx.linkedIssueRead || input?.error?.safeDecisionContext?.linkedIssueRead || (ctx.correlationFound ? 'failed' : 'not_attempted')),
      linkedIssueStatusName: String(ctx.linkedIssueStatusName || ''),
      linkedIssueStatusCategoryKey: String(ctx.linkedIssueStatusCategoryKey || ''),
      linkedIssueCompleted: Boolean(ctx.linkedIssueCompleted),
      payloadHashChanged: ctx.payloadHashChanged === undefined ? true : Boolean(ctx.payloadHashChanged),
      decision: String(input?.action || ctx.decision || 'SKIP'),
      reason: String(input?.reason || ctx.reason || '')
    }
  });
}

async function emitLifecycleReasonSummary(runLogger, summary) {
  await emitLog({
    runLogger,
    runId: 'jira-sync',
    level: LOG_LEVELS.INFO,
    eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
    message: 'Jira lifecycle reason summary.',
    context: {
      created: Number(summary?.created || 0),
      updated: Number(summary?.updated || 0),
      skipped: Number(summary?.skipped || 0),
      failed: Number(summary?.failed || 0),
      skippedByReason: summary?.skippedByReason || {},
      bySignalAndReason: summary?.bySignalAndReason || {}
    }
  });
}

function incrementSignalReason(target, signalType, reason) {
  const signalKey = asTrimmedString(signalType) || 'UNKNOWN';
  const reasonKey = asTrimmedString(reason) || 'UNKNOWN';
  if (!target[signalKey]) {
    target[signalKey] = {};
  }
  target[signalKey][reasonKey] = Number(target[signalKey][reasonKey] || 0) + 1;
}

function sanitizeError(error) {
  const explicitCode = asTrimmedString(error?.code);
  const safeDetail = sanitizeSafeDetail(error?.safeDetail);
  const rawMessage = asTrimmedString(error?.message) || 'candidate processing failed';
  const lower = rawMessage.toLowerCase();
  if (lower.includes('secret') || lower.includes('token') || lower.includes('authorization') || lower.includes('bearer') || lower.includes('password')) {
    return { code: explicitCode || 'candidate_processing_failed', message: 'candidate processing failed' };
  }
  const code = explicitCode || (/^[a-z0-9_]+$/i.test(rawMessage) ? rawMessage.toLowerCase() : 'candidate_processing_failed');
  return { code, message: rawMessage.slice(0, 240), ...(safeDetail ? { detail: safeDetail } : {}) };
}

function sanitizeSafeDetail(value) {
  const text = asTrimmedString(value);
  if (!text) return '';
  if (/(secret|token|authorization|bearer|password)/i.test(text)) return '';
  return text.slice(0, 160);
}

async function buildCreateGuard(input) {
  const maxOpen = Number(input?.maxOpenIssuesPerOrganization || 0);
  const correlationStore = input?.deps?.correlationStore;
  const jiraApi = input?.deps?.jiraApi;
  if (!Number.isInteger(maxOpen) || maxOpen <= 0 || !correlationStore?.listCorrelationsByOrgLink || !jiraApi?.getIssue) return null;

  const orgLinkIds = Array.from(new Set(
    (Array.isArray(input?.candidates) ? input.candidates : [])
      .map((item) => asTrimmedString(item?.candidate?.identity?.orgLinkId))
      .filter(Boolean)
  ));
  const stateByOrg = new Map();

  for (const orgLinkId of orgLinkIds) {
    const rows = await correlationStore.listCorrelationsByOrgLink(orgLinkId, { includeGrouped: true });
    const issueIdsOrKeys = Array.from(new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => asTrimmedString(row?.jiraIssueId || row?.jiraIssueKey || row?.linkedIssueId || row?.linkedIssueKey))
        .filter(Boolean)
    ));
    const openIssueIds = new Set();

    for (const issueIdOrKey of issueIdsOrKeys) {
      try {
        const issue = await jiraApi.getIssue(issueIdOrKey);
        if (!issue || issue.completed) continue;
        openIssueIds.add(issueIdOrKey);
      } catch {}
    }

    stateByOrg.set(orgLinkId, {
      openCount: openIssueIds.size,
      openBefore: openIssueIds.size,
      openIssueIds
    });
  }

  return {
    canCreate(orgLinkId) {
      const key = asTrimmedString(orgLinkId);
      const existing = stateByOrg.get(key) || { openCount: 0, openBefore: 0, openIssueIds: new Set() };
      if (!stateByOrg.has(key)) stateByOrg.set(key, existing);
      return existing.openCount < maxOpen;
    },
    onCreate(orgLinkId, issueIdOrKey) {
      const key = asTrimmedString(orgLinkId);
      const entry = stateByOrg.get(key) || { openCount: 0, openBefore: 0, openIssueIds: new Set() };
      if (!stateByOrg.has(key)) stateByOrg.set(key, entry);
      const normalizedIssueIdOrKey = asTrimmedString(issueIdOrKey);
      if (normalizedIssueIdOrKey && entry.openIssueIds.has(normalizedIssueIdOrKey)) return;
      if (normalizedIssueIdOrKey) entry.openIssueIds.add(normalizedIssueIdOrKey);
      entry.openCount += 1;
    }
  };
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

module.exports = {
  createLifecycleRunService,
  extractIdentityKey,
  normalizeOperationalSafeguards,
  normalizeWorkItem,
  sanitizeError
};
