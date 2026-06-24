const { createLifecycleWriteOrchestrator } = require('./lifecycle');
const { emitLog, LOG_EVENT_TYPES, LOG_LEVELS } = require('./runtimeLogging');

const DEFAULT_MAX_OPEN_TICKETS_PER_ORG = 30;

function createLifecycleRunService(deps = {}) {
  const orchestrator = deps.lifecycleWriteOrchestrator || createLifecycleWriteOrchestrator({ haloTicketsClient: deps.haloTicketsClient, correlationStore: deps.correlationStore, now: deps.now });

  return { runOnce };

  async function runOnce(input = {}) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const runLogger = input?.runLogger || deps.runLogger || null;
    const categories = Array.isArray(input.categories) ? input.categories : [];
    const lifecycle = normalizeLifecyclePolicy(input);
    const safeguards = normalizeOperationalSafeguards(input);
    const normalized = candidates.map((row, index) => normalizeWorkItem(row, index)).sort(compareWorkItemsForLifecycleProcessing);
    const seen = new Set();
    const createGuard = await buildCreateGuard({ deps, candidates: normalized, closedStatusIds: lifecycle.closedStatusIds, maxOpenTicketsPerOrganization: safeguards.maxOpenTicketsPerOrganization });
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
          summary: item.summary,
          details: item.details,
          categories,
          lifecycle,
          createGuard,
          action1BaseUrl: asTrimmedString(input?.config?.connections?.action1?.baseUrl),
          maxImpactedEndpointsInGroupedTicket: input?.config?.maxImpactedEndpointsInGroupedTicket
        });
        const action = String(outcome?.action || 'SKIP').toUpperCase();
        const reason = asTrimmedString(outcome?.reason) || undefined;
        const ticketId = asTrimmedString(outcome?.ticketId) || undefined;
        const status = action === 'SKIP' ? 'skipped' : 'success';
        await emitRecoverableMissingLinkedTicketLog(runLogger, outcome, action);
        if (action === 'CREATE') summary.created += 1;
        else if (action === 'UPDATE') summary.updated += 1;
        else summary.skipped += 1;
        if (action === 'SKIP' && reason) summary.skippedByReason[reason] = Number(summary.skippedByReason[reason] || 0) + 1;
        results.push({ identityKey: item.identityKey, signalType, action, status, ticketId, reason });
      } catch (error) {
        const sanitized = sanitizeError(error);
        summary.failed += 1;
        summary.failuresByReason[sanitized.code] = Number(summary.failuresByReason[sanitized.code] || 0) + 1;
        if (sanitized.detail && !summary.failureExamplesByReason[sanitized.code]) summary.failureExamplesByReason[sanitized.code] = sanitized.detail;
        results.push({ identityKey: item.identityKey, signalType, action: 'ERROR', status: 'failed', reason: sanitized.code, error: sanitized.message, ...(sanitized.detail ? { detail: sanitized.detail } : {}) });
      }
    }

    return { ok: summary.failed === 0, summary, results };
  }
}

async function emitRecoverableMissingLinkedTicketLog(runLogger, outcome, action) {
  const ctx = outcome?.decisionContext && typeof outcome.decisionContext === 'object' ? outcome.decisionContext : null;
  if (!runLogger || !ctx || !ctx.correlationFound || String(ctx.linkedTicketState || '').toLowerCase() !== 'missing') {
    return;
  }

  const recoveryAction = action === 'CREATE'
    ? 'recreate'
    : outcome?.clearedCorrelation
    ? 'clear'
    : 'skip';

  await emitLog({
    runLogger,
    runId: 'halo-sync',
    level: LOG_LEVELS.INFO,
    eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
    message: 'Linked Halo ticket is missing; treating the stored correlation as stale.',
    context: {
      identityKey: String(ctx.identityKey || ''),
      signalType: String(ctx.signalType || ''),
      linkedTicketId: String(ctx.linkedTicketId || ''),
      ticketModel: String(ctx.ticketModel || ''),
      issueKey: String(ctx.issueKey || ''),
      recoveryAction
    }
  });
}

function normalizeWorkItem(row, index) {
  const useEnvelope = row && typeof row === 'object' && row.candidate && typeof row.candidate === 'object';
  const candidate = useEnvelope ? row.candidate : row;
  const signalQualifies = useEnvelope && typeof row.signalQualifies === 'boolean' ? row.signalQualifies : typeof row?.signalQualifies === 'boolean' ? row.signalQualifies : true;
  const summary = useEnvelope ? row.summary : undefined;
  const details = useEnvelope ? row.details : undefined;
  return { inputIndex: index, candidate, signalQualifies, summary, details, identityKey: extractIdentityKey(candidate), signalType: extractSignalType(candidate) };
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
  const ticketDestination = cfg.ticketDestination && typeof cfg.ticketDestination === 'object' ? cfg.ticketDestination : {};
  const closedStatusIds = Array.isArray(lifecycle.closedStatusIds) ? lifecycle.closedStatusIds : Array.isArray(ticketDestination.closedStatusIds) ? ticketDestination.closedStatusIds : [];
  return {
    existingOpenTicketBehavior: asTrimmedString(lifecycle.existingOpenTicketBehavior) || asTrimmedString(cfgLifecycle.existingOpenTicketBehavior) || 'update_existing_open',
    closeWhenSignalClears: lifecycle.closeWhenSignalClears !== undefined ? Boolean(lifecycle.closeWhenSignalClears) : cfgLifecycle.closeWhenSignalClears !== undefined ? Boolean(cfgLifecycle.closeWhenSignalClears) : true,
    closedStatusIds: closedStatusIds.map((row) => asTrimmedString(row)).filter(Boolean)
  };
}

function normalizeOperationalSafeguards(input) {
  const cfg = input?.config && typeof input.config === 'object' ? input.config : {};
  const operational = cfg.operationalSafeguards && typeof cfg.operationalSafeguards === 'object' ? cfg.operationalSafeguards : {};
  const maxOpen = Number(operational.maxOpenTicketsPerOrganization);
  return { enableDebugLogging: Boolean(operational.enableDebugLogging), maxOpenTicketsPerOrganization: Number.isInteger(maxOpen) && maxOpen > 0 ? maxOpen : DEFAULT_MAX_OPEN_TICKETS_PER_ORG };
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

async function buildCreateGuard(input) {
  const maxOpen = Number(input?.maxOpenTicketsPerOrganization || 0);
  const correlationStore = input?.deps?.correlationStore;
  const haloTicketsClient = input?.deps?.haloTicketsClient;
  if (!Number.isInteger(maxOpen) || maxOpen <= 0 || !correlationStore?.listCorrelationsByOrgLink || !haloTicketsClient?.getTicket) return null;
  const orgLinkIds = Array.from(new Set((Array.isArray(input?.candidates) ? input.candidates : []).map((item) => asTrimmedString(item?.candidate?.identity?.orgLinkId)).filter(Boolean)));
  const closedSet = new Set((Array.isArray(input?.closedStatusIds) ? input.closedStatusIds : []).map((x) => asTrimmedString(x)));
  const stateByOrg = new Map();
  for (const orgLinkId of orgLinkIds) {
    const rows = await correlationStore.listCorrelationsByOrgLink(orgLinkId, { includeGrouped: true });
    const ticketIds = Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => asTrimmedString(row?.haloTicketId || row?.linkedTicketId)).filter(Boolean)));
    const openTicketIds = new Set();
    for (const ticketId of ticketIds) {
      try {
        const ticket = await haloTicketsClient.getTicket(ticketId);
        if (!ticket) continue;
        const statusId = asTrimmedString(ticket?.statusId);
        if (Boolean(ticket?.isClosed) || (statusId && closedSet.has(statusId))) continue;
        openTicketIds.add(ticketId);
      } catch {}
    }
    stateByOrg.set(orgLinkId, { openCount: openTicketIds.size, openBefore: openTicketIds.size, openTicketIds });
  }
  return {
    canCreate(orgLinkId) {
      const key = asTrimmedString(orgLinkId);
      const existing = stateByOrg.get(key) || { openCount: 0, openBefore: 0, openTicketIds: new Set() };
      if (!stateByOrg.has(key)) stateByOrg.set(key, existing);
      return existing.openCount < maxOpen;
    },
    onCreate(orgLinkId, ticketId) {
      const key = asTrimmedString(orgLinkId);
      const entry = stateByOrg.get(key) || { openCount: 0, openBefore: 0, openTicketIds: new Set() };
      if (!stateByOrg.has(key)) stateByOrg.set(key, entry);
      const normalizedTicketId = asTrimmedString(ticketId);
      if (normalizedTicketId && entry.openTicketIds.has(normalizedTicketId)) return;
      if (normalizedTicketId) entry.openTicketIds.add(normalizedTicketId);
      entry.openCount += 1;
    },
    onClose(orgLinkId, ticketId) {
      const key = asTrimmedString(orgLinkId);
      const entry = stateByOrg.get(key);
      if (!entry) return;
      const normalizedTicketId = asTrimmedString(ticketId);
      if (normalizedTicketId && entry.openTicketIds.has(normalizedTicketId)) entry.openTicketIds.delete(normalizedTicketId);
      entry.openCount = Math.max(0, entry.openCount - 1);
    }
  };
}

function sanitizeError(error) {
  const explicitCode = asTrimmedString(error?.code);
  const safeDetail = sanitizeSafeDetail(error?.safeDetail);
  if (explicitCode === 'halo_create_rejected') {
    return {
      code: explicitCode,
      message: asTrimmedString(error?.message) || 'Halo rejected ticket creation. Check Ticket Type / Status / Team / Category compatibility.',
      ...(safeDetail ? { detail: safeDetail } : {})
    };
  }
  const rawMessage = asTrimmedString(error?.message) || 'candidate processing failed';
  const lower = rawMessage.toLowerCase();
  if (lower.includes('secret') || lower.includes('token') || lower.includes('authorization') || lower.includes('bearer') || lower.includes('password') || lower.includes('x-tenant')) {
    return { code: 'candidate_processing_failed', message: 'candidate processing failed' };
  }
  const code = /^[a-z0-9_]+$/i.test(rawMessage) ? rawMessage.toLowerCase() : 'candidate_processing_failed';
  return { code, message: rawMessage.slice(0, 240) };
}

function sanitizeSafeDetail(value) {
  const text = asTrimmedString(value);
  if (!text) return '';
  const lower = text.toLowerCase();
  if (lower.includes('secret') || lower.includes('token') || lower.includes('authorization') || lower.includes('bearer') || lower.includes('password') || lower.includes('x-tenant')) return '';
  return text.slice(0, 160);
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
