const {
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage: sanitizeAction1Message
} = require('./action1Api');
const { createDbMappingStore } = require('./mappingStore');
const { INITIAL_PROVIDER_ID, createProviderDispatcher, PROVIDER_REGISTRY, resolveProvider } = require('./providerRegistry');
const {
  ACTIVE_PROVIDER_KEY,
  PROVIDER_UI_DEFINITIONS,
  buildProviderSettingKey,
  readSettings
} = require('./providerSettings');
const { createMarketplaceRunLogger } = require('./runtimeLogging');
const { normalizeDiscoveryQuery, validateMappingDiscoveryInput } = require('./providerAdapterContract');
const { classifyAutoMatches, normalizeMappingRow } = require('./mappingAutoMatch');

const MAPPING_DISCOVERY_TOKEN_PREFIX = 'md1.';
const MAPPING_DISCOVERY_TOKEN_MAX_LENGTH = 4096;
const AUTO_MATCH_LIMITS = Object.freeze({
  pageSize: 500,
  maxPages: 50,
  maxDestinations: 25000,
  maxOrganizations: 2000,
  maxElapsedMs: 120000,
  maxSelectedMatches: 2000
});
const MAX_MATCH_ID_LENGTH = 512;
const MAX_MATCH_NAME_LENGTH = 512;

function encodeMappingDiscoveryToken(providerId, query, cursor) {
  const encoded = Buffer.from(JSON.stringify({ v: 1, providerId, query, cursor }), 'utf8').toString('base64url');
  const token = `${MAPPING_DISCOVERY_TOKEN_PREFIX}${encoded}`;
  if (token.length > MAPPING_DISCOVERY_TOKEN_MAX_LENGTH) throw new Error('The provider returned a continuation token that is too large.');
  return token;
}

function decodeMappingDiscoveryToken(token, providerId, query) {
  if (token === null || token === undefined || token === '') return null;
  if (typeof token !== 'string' || token.length > MAPPING_DISCOVERY_TOKEN_MAX_LENGTH || !/^md1\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('The destination discovery continuation token is invalid.');
  }
  let value;
  try { value = JSON.parse(Buffer.from(token.slice(MAPPING_DISCOVERY_TOKEN_PREFIX.length), 'base64url').toString('utf8')); } catch {
    throw new Error('The destination discovery continuation token is invalid.');
  }
  if (!value || value.v !== 1 || value.providerId !== providerId || value.query !== query || typeof value.cursor !== 'string' || !value.cursor.trim()) {
    throw new Error('The destination discovery continuation token does not match the active provider or search.');
  }
  return value.cursor;
}

function validateAutoMatchDraftRows(value, maxRows = AUTO_MATCH_LIMITS.maxOrganizations) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxRows) throw new Error('The current mapping draft is invalid or too large.');
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('The current mapping draft is invalid.');
    const normalized = normalizeMappingRow(row);
    if ([normalized.action1OrgId, normalized.destinationId].some((field) => field.length > MAX_MATCH_ID_LENGTH) ||
        [normalized.action1OrgName, normalized.destinationName].some((field) => field.length > MAX_MATCH_NAME_LENGTH) ||
        (normalized.id !== null && !Number.isInteger(Number(normalized.id)))) {
      throw new Error('The current mapping draft contains an invalid identity.');
    }
    return { ...normalized, id: normalized.id === null ? null : Number(normalized.id) };
  });
}

function validateAutoMatchCandidates(value) {
  if (!Array.isArray(value) || value.length > AUTO_MATCH_LIMITS.maxSelectedMatches) throw new Error('The selected match list is invalid or too large.');
  const sourceIds = new Set();
  const destinationIds = new Set();
  return value.map((match) => {
    if (!match || typeof match !== 'object' || Array.isArray(match)) throw new Error('The selected match list is invalid.');
    const normalized = {
      action1OrgId: String(match.action1OrgId || '').trim(),
      action1OrgName: String(match.action1OrgName || '').trim(),
      destinationId: String(match.destinationId || '').trim(),
      destinationName: String(match.destinationName || '').trim(),
      draftSnapshot: match.draftSnapshot === undefined || match.draftSnapshot === null ? null : validateAutoMatchDraftRows([match.draftSnapshot], 1)[0]
    };
    if (!normalized.action1OrgId || !normalized.destinationId || !normalized.action1OrgName || !normalized.destinationName ||
        normalized.action1OrgId.length > MAX_MATCH_ID_LENGTH || normalized.destinationId.length > MAX_MATCH_ID_LENGTH ||
        normalized.action1OrgName.length > MAX_MATCH_NAME_LENGTH || normalized.destinationName.length > MAX_MATCH_NAME_LENGTH ||
        sourceIds.has(normalized.action1OrgId) || destinationIds.has(normalized.destinationId)) {
      throw new Error('The selected match list contains duplicate or invalid identities.');
    }
    sourceIds.add(normalized.action1OrgId);
    destinationIds.add(normalized.destinationId);
    return normalized;
  });
}

function sameDraftSnapshot(left, right) {
  if (!left || !right) return left === right;
  return ['id', 'action1OrgId', 'action1OrgName', 'destinationId', 'destinationName'].every((key) =>
    String(left[key] ?? '') === String(right[key] ?? ''));
}

function isMappingConflict(error) {
  return /already mapped|already assigned|unique|constraint|duplicate/i.test(String(error?.message || ''));
}

function safeProviderFailure(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const sanitized = sanitizeAction1Message(message);
  return sanitized && sanitized.length <= 240 ? sanitized : 'The requested ticketing system is not available in this version.';
}

async function resolveMappingProvider(context, request, registry, definitions, initialProviderId = INITIAL_PROVIDER_ID) {
  if (!context?.settings || typeof context.settings.get !== 'function') {
    return { ok: false, message: 'Unable to read the active ticketing system. Refresh Mapping and try again.' };
  }
  let providerId;
  try {
    providerId = String(await context.settings.get(ACTIVE_PROVIDER_KEY) || initialProviderId).trim();
  } catch {
    return { ok: false, message: 'Unable to read the active ticketing system. Refresh Mapping and try again.' };
  }
  const requestedProviderId = request?.providerId;
  if (requestedProviderId !== undefined && requestedProviderId !== null &&
      (typeof requestedProviderId !== 'string' || requestedProviderId.trim() !== providerId)) {
    return { ok: false, message: 'The active ticketing system changed. Refresh Mapping and try again.' };
  }
  const resolved = resolveProvider(providerId, registry);
  if (!resolved.ok) return { ok: false, message: resolved.error.message };
  const definition = definitions[providerId];
  if (!definition || definition.available !== true) {
    return { ok: false, message: `${definition?.label || resolved.descriptor.label} is not available in this version.` };
  }
  return { ok: true, providerId, definition };
}

async function loadProviderDiscoveryValues(context, providerId, definition) {
  const keys = definition.fields.map((field) => buildProviderSettingKey(providerId, field.key));
  const saved = await readSettings(context, keys);
  const connection = {};
  const settings = {};
  for (const field of definition.fields) {
    const key = buildProviderSettingKey(providerId, field.key);
    const value = saved[key] ?? '';
    if (field.type === 'secret') connection[field.key] = value;
    else settings[field.key] = value;
  }
  return { connection, settings };
}

function createMappingActionHandlers(dependencies = {}) {
  const registry = dependencies.registry || PROVIDER_REGISTRY;
  const definitions = dependencies.definitions || PROVIDER_UI_DEFINITIONS;
  const dispatcher = dependencies.dispatcher || createProviderDispatcher(registry);
  const matchLimits = { ...AUTO_MATCH_LIMITS, ...(dependencies.autoMatchLimits || {}) };
  const now = typeof dependencies.now === 'function' ? dependencies.now : Date.now;

  function withProvider(context, request) {
    return resolveMappingProvider(context, request, registry, definitions, dependencies.initialProviderId);
  }

  async function listMappings(context, request = {}) {
    const selected = await withProvider(context, request);
    if (!selected.ok) return { ok: false, message: selected.message, mappings: [] };
    try {
      return { ok: true, mappings: await createDbMappingStore(context, selected.providerId).list() };
    } catch {
      return { ok: false, message: 'Unable to load mappings for this ticketing system.', mappings: [] };
    }
  }

  async function saveMapping(context, request = {}) {
    const selected = await withProvider(context, request);
    if (!selected.ok) return { ok: false, message: selected.message };
    try {
      const store = createDbMappingStore(context, selected.providerId);
      const saved = await store.save(request.payload || {});
      return { ok: true, message: 'Mapping saved.', mapping: saved, mappings: await store.list() };
    } catch (error) {
      return { ok: false, message: `Failed: ${safeProviderFailure(error)}` };
    }
  }

  async function deleteMapping(context, request = {}) {
    const selected = await withProvider(context, request);
    if (!selected.ok) return { ok: false, message: selected.message, deleted: false };
    try {
      const store = createDbMappingStore(context, selected.providerId);
      const result = await store.delete(request.payload?.id);
      return {
        ok: true,
        message: result.deleted ? 'Mapping deleted.' : 'Mapping was already absent.',
        deleted: result.deleted,
        mapping: result.mapping,
        mappings: await store.list()
      };
    } catch (error) {
      return { ok: false, message: `Failed: ${safeProviderFailure(error)}`, deleted: false };
    }
  }

  async function discoverAction1MappingOptions(context) {
    let tokenAcquired = false;
    try {
      const credentials = await loadAction1Credentials(context);
      const accessToken = await requestAction1Token(credentials);
      tokenAcquired = true;
      const action1Organizations = await discoverAction1Organizations(accessToken, credentials.baseUrl);
      return { ok: true, message: 'Loaded Action1 organization options.', action1Organizations };
    } catch (error) {
      await logDiscoveryFailure(context, 'action1_org_discovery', error, tokenAcquired);
      return {
        ok: false,
        message: 'Failed: Action1 organization discovery failed.',
        diagnostics: buildFailureDiagnostics('action1_org_discovery', tokenAcquired, error),
        action1Organizations: []
      };
    }
  }

  async function discoverDestinationOptions(context, request = {}) {
    const selected = await withProvider(context, request);
    if (!selected.ok) return { ok: false, message: selected.message, destinationOptions: [], hasMore: false, nextPageToken: null, complete: false, searchSupported: false, paginationSupported: false };
    try {
      const query = normalizeDiscoveryQuery(request.query);
      const pageSize = request.pageSize === undefined ? 50 : request.pageSize;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('The destination discovery page size is invalid.');
      const continuationToken = decodeMappingDiscoveryToken(request.continuationToken, selected.providerId, query);
      const { connection, settings } = await loadProviderDiscoveryValues(context, selected.providerId, selected.definition);
      const input = validateMappingDiscoveryInput({ kind: 'mapping-destinations', settings, query, pageSize, continuationToken });
      const result = await dispatcher.invoke({
        providerId: selected.providerId,
        operation: 'discover',
        input,
        connection,
        transport: context?.http,
        logger: context?.logger
      });
      return {
        ok: true,
        message: result.searchSupported || !query ? 'Loaded destination options.' : 'This provider does not support searching its full customer directory.',
        destinationOptions: result.options.map((option) => ({ id: option.id, name: option.label })),
        hasMore: result.hasMore,
        nextPageToken: result.nextPageToken ? encodeMappingDiscoveryToken(selected.providerId, query, result.nextPageToken) : null,
        complete: result.complete,
        searchSupported: result.searchSupported,
        paginationSupported: result.paginationSupported
      };
    } catch (error) {
      return { ok: false, message: safeProviderFailure(error), destinationOptions: [], hasMore: false, nextPageToken: null, complete: false, searchSupported: false, paginationSupported: false };
    }
  }

  async function loadAutoMatchOrganizations(context) {
    if (typeof dependencies.loadAction1Organizations === 'function') {
      return dependencies.loadAction1Organizations(context);
    }
    const credentials = await loadAction1Credentials(context);
    const accessToken = await requestAction1Token(credentials);
    return discoverAction1Organizations(accessToken, credentials.baseUrl);
  }

  function validateAutoMatchOrganizationList(value) {
    if (!Array.isArray(value) || value.length > matchLimits.maxOrganizations) throw new Error('Action1 organization discovery exceeded the supported Auto Match bound.');
    const rows = [];
    for (const item of value) {
      const id = String(item?.id || '').trim();
      const name = String(item?.name || '').trim();
      if (!id || !name || id.length > MAX_MATCH_ID_LENGTH || name.length > MAX_MATCH_NAME_LENGTH) {
        throw new Error('Action1 organization discovery returned an invalid identity.');
      }
      rows.push({ id, name });
    }
    return rows;
  }

  async function discoverCompleteDestinationDirectory(context, providerId, definition) {
    const startedAt = now();
    const { connection, settings } = await loadProviderDiscoveryValues(context, providerId, definition);
    const destinationsById = new Map();
    const changedDestinationIds = new Set();
    const seenTokens = new Set();
    let continuationToken = null;
    let pages = 0;

    while (true) {
      if (pages >= matchLimits.maxPages) return { complete: false, reason: 'page_limit', pageCount: pages };
      if (now() - startedAt >= matchLimits.maxElapsedMs) return { complete: false, reason: 'time_limit', pageCount: pages };
      let page;
      try {
        page = await dispatcher.invoke({
          providerId,
          operation: 'discover',
          input: validateMappingDiscoveryInput({ kind: 'mapping-destinations', settings, query: '', pageSize: matchLimits.pageSize, continuationToken }),
          connection,
          transport: context?.http,
          logger: context?.logger
        });
      } catch {
        return { complete: false, reason: 'provider_discovery_failed', pageCount: pages };
      }
      pages += 1;
      if (now() - startedAt > matchLimits.maxElapsedMs) return { complete: false, reason: 'time_limit', pageCount: pages };

      for (const option of page.options) {
        const previous = destinationsById.get(option.id);
        if (previous && previous.name !== option.label) changedDestinationIds.add(option.id);
        destinationsById.set(option.id, { id: option.id, name: option.label });
      }
      if (destinationsById.size > matchLimits.maxDestinations) return { complete: false, reason: 'record_limit', pageCount: pages };
      if (page.complete === true && page.hasMore === false) {
        return { complete: true, destinations: [...destinationsById.values()], changedDestinationIds: [...changedDestinationIds], pageCount: pages };
      }
      if (page.hasMore !== true || !page.nextPageToken || seenTokens.has(page.nextPageToken)) {
        return { complete: false, reason: 'directory_not_complete', pageCount: pages };
      }
      seenTokens.add(page.nextPageToken);
      continuationToken = page.nextPageToken;
    }
  }

  function incompleteAutoMatch(message, reason, analyzedCount = 0) {
    return { ok: true, complete: false, message, reason, analyzedCount, exactMatches: [], unmatched: [], ambiguous: [], counts: { exact: 0, unmatched: 0, ambiguous: 0 } };
  }

  async function previewAutoMatch(context, request = {}) {
    const selected = await withProvider(context, request);
    if (!selected.ok) return { ok: false, complete: false, message: selected.message, analyzedCount: 0, exactMatches: [], unmatched: [], ambiguous: [], counts: { exact: 0, unmatched: 0, ambiguous: 0 } };
    let draftRows;
    try { draftRows = validateAutoMatchDraftRows(request.draftRows, matchLimits.maxOrganizations); } catch (error) {
      return { ok: false, complete: false, message: error.message, analyzedCount: 0, exactMatches: [], unmatched: [], ambiguous: [], counts: { exact: 0, unmatched: 0, ambiguous: 0 } };
    }

    let organizations;
    try { organizations = validateAutoMatchOrganizationList(await loadAutoMatchOrganizations(context)); } catch {
      return incompleteAutoMatch('Action1 organizations could not be loaded completely. Refresh Discovery and try again.', 'action1_discovery_incomplete');
    }
    let mappings;
    try { mappings = await createDbMappingStore(context, selected.providerId).list(); } catch {
      return { ok: false, complete: false, message: 'Current mappings could not be loaded for Auto Match.', analyzedCount: 0, exactMatches: [], unmatched: [], ambiguous: [], counts: { exact: 0, unmatched: 0, ambiguous: 0 } };
    }
    const directory = await discoverCompleteDestinationDirectory(context, selected.providerId, selected.definition);
    if (!directory.complete) {
      const excluded = new Set([
        ...mappings.filter((row) => row.action1OrgId && row.destinationId).map((row) => row.action1OrgId),
        ...draftRows.filter((row) => row.action1OrgId && row.destinationId).map((row) => row.action1OrgId)
      ]);
      return incompleteAutoMatch('Destination discovery is incomplete. Auto Match did not classify unmatched organizations and cannot be applied.', directory.reason, organizations.filter((row) => !excluded.has(row.id)).length);
    }
    const stillActive = await withProvider(context, { providerId: selected.providerId });
    if (!stillActive.ok) return incompleteAutoMatch(stillActive.message, 'provider_changed');
    const result = classifyAutoMatches(organizations, directory.destinations, mappings, draftRows, { changedDestinationIds: directory.changedDestinationIds });
    return {
      ok: true,
      complete: true,
      providerId: selected.providerId,
      message: 'Auto Match preview is ready for review.',
      analyzedCount: result.analyzedCount,
      exactMatches: result.exactMatches,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      counts: { exact: result.exactMatches.length, unmatched: result.unmatched.length, ambiguous: result.ambiguous.length }
    };
  }

  async function applyAutoMatch(context, request = {}) {
    const selected = await withProvider(context, request);
    const base = { applied: 0, skipped: 0, failed: 0, results: [], mappings: [] };
    if (!selected.ok) return { ok: false, complete: false, message: selected.message, ...base };
    let matches;
    let draftRows;
    try {
      matches = validateAutoMatchCandidates(request.matches);
      draftRows = validateAutoMatchDraftRows(request.draftRows, matchLimits.maxOrganizations);
    } catch (error) {
      return { ok: false, complete: false, message: error.message, ...base };
    }

    const store = createDbMappingStore(context, selected.providerId);
    let mappings;
    try { mappings = await store.list(); } catch {
      return { ok: false, complete: false, message: 'Current mappings could not be loaded for Apply Matches.', ...base };
    }
    if (!matches.length) return { ok: true, complete: true, message: 'No matches were selected.', mappings, ...base };

    let organizations;
    try { organizations = validateAutoMatchOrganizationList(await loadAutoMatchOrganizations(context)); } catch {
      return { ok: true, complete: false, message: 'Action1 organizations could not be revalidated. No matches were applied.', skipped: matches.length, results: matches.map((item) => ({ action1OrgId: item.action1OrgId, status: 'skipped', reason: 'action1_discovery_incomplete' })), mappings };
    }
    const directory = await discoverCompleteDestinationDirectory(context, selected.providerId, selected.definition);
    if (!directory.complete) {
      return { ok: true, complete: false, message: 'Destination discovery is incomplete. No matches were applied.', skipped: matches.length, results: matches.map((item) => ({ action1OrgId: item.action1OrgId, status: 'skipped', reason: directory.reason })), mappings };
    }

    const currentClassification = classifyAutoMatches(organizations, directory.destinations, mappings, draftRows, { changedDestinationIds: directory.changedDestinationIds });
    const exactBySource = new Map(currentClassification.exactMatches.map((item) => [item.action1OrgId, item]));
    const ambiguousSourceIds = new Set(currentClassification.ambiguous.map((item) => item.action1OrgId));
    const savedBySource = new Map(mappings.map((row) => [row.action1OrgId, row]));
    const appliedMappings = [];
    const results = [];
    let skipped = 0;
    let failed = 0;

    for (const candidate of matches) {
      const currentDrafts = draftRows.filter((row) => row.action1OrgId === candidate.action1OrgId);
      const completeDraft = currentDrafts.some((row) => row.action1OrgId && row.destinationId);
      if (savedBySource.has(candidate.action1OrgId)) {
        skipped += 1;
        results.push({ action1OrgId: candidate.action1OrgId, status: 'skipped', reason: 'already_mapped' });
        continue;
      }
      if (completeDraft) {
        skipped += 1;
        results.push({ action1OrgId: candidate.action1OrgId, status: 'skipped', reason: 'draft_mapping_exists' });
        continue;
      }
      const currentDraft = currentDrafts.length === 1 ? currentDrafts[0] : null;
      if (currentDrafts.length > 1 || !sameDraftSnapshot(candidate.draftSnapshot, currentDraft)) {
        skipped += 1;
        results.push({ action1OrgId: candidate.action1OrgId, status: 'skipped', reason: 'draft_changed' });
        continue;
      }

      const current = exactBySource.get(candidate.action1OrgId);
      if (!current) {
        skipped += 1;
        results.push({ action1OrgId: candidate.action1OrgId, status: 'skipped', reason: ambiguousSourceIds.has(candidate.action1OrgId) ? 'candidate_ambiguous' : 'candidate_no_longer_exact' });
        continue;
      }
      if (current.destinationId !== candidate.destinationId || current.action1OrgName !== candidate.action1OrgName || current.destinationName !== candidate.destinationName) {
        skipped += 1;
        results.push({ action1OrgId: candidate.action1OrgId, status: 'skipped', reason: 'identity_or_name_changed' });
        continue;
      }
      const stillActive = await withProvider(context, { providerId: selected.providerId });
      if (!stillActive.ok) {
        return { ok: false, complete: true, message: stillActive.message, applied: appliedMappings.length, skipped: skipped + matches.length - results.length, failed, results, mappings: await store.list(), appliedMappings };
      }
      try {
        const saved = await store.save({
          action1OrgId: current.action1OrgId,
          action1OrgName: current.action1OrgName,
          destinationId: current.destinationId,
          destinationName: current.destinationName,
          enabled: true
        });
        appliedMappings.push(saved);
        results.push({ action1OrgId: candidate.action1OrgId, status: 'applied', reason: 'applied' });
      } catch (error) {
        if (isMappingConflict(error)) {
          skipped += 1;
          results.push({ action1OrgId: candidate.action1OrgId, status: 'skipped', reason: 'mapping_conflict' });
        } else {
          failed += 1;
          results.push({ action1OrgId: candidate.action1OrgId, status: 'failed', reason: 'mapping_save_failed' });
        }
      }
    }

    try { mappings = await store.list(); } catch {
      return { ok: false, complete: true, message: 'Some Apply Matches results could not be reloaded. Refresh Mapping before continuing.', applied: appliedMappings.length, skipped, failed, results, mappings: [], appliedMappings };
    }
    return {
      ok: true,
      complete: true,
      message: `Applied ${appliedMappings.length} matches; skipped ${skipped}; failed ${failed}.`,
      applied: appliedMappings.length,
      skipped,
      failed,
      results,
      appliedMappings,
      mappings
    };
  }

  return Object.freeze({
    deleteHaloOrgClientMapping: deleteMapping,
    discoverAction1MappingOptions,
    discoverHaloMappingOptions: discoverDestinationOptions,
    previewAutoMatch,
    applyAutoMatch,
    listHaloOrgClientMappings: listMappings,
    saveHaloOrgClientMapping: saveMapping
  });
}

function buildFailureDiagnostics(operation, tokenAcquired, error) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object' ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object' ? diagnostic.request : {};
  const response = diagnostic.response && typeof diagnostic.response === 'object' ? diagnostic.response : {};
  return {
    actionId: 'discover-action1-mapping-options',
    operation,
    tokenAcquired: Boolean(tokenAcquired),
    request: { method: request.method || '', path: request.path || '', query: request.query || '' },
    response: {
      status: response.status ?? null,
      contentType: response.contentType || '',
      errorCode: response.errorCode || '',
      errorMessage: response.errorMessage || safeProviderFailure(error),
      bodyExcerpt: response.bodyExcerpt || ''
    },
    timestamp: new Date().toISOString()
  };
}

async function logDiscoveryFailure(context, operation, error, tokenAcquired = false) {
  const diagnostics = buildFailureDiagnostics(operation, tokenAcquired, error);
  const logger = createMarketplaceRunLogger({ integrationId: 'action1-ticketing', logDir: context?.env?.HALO_PSA_LOG_DIR, env: context?.env || process.env });
  await logger.warn(`Action1 Ticketing mapping discovery diagnostic ${JSON.stringify(diagnostics)}`);
}

const productionHandlers = createMappingActionHandlers();
module.exports = { ...productionHandlers, createMappingActionHandlers };
