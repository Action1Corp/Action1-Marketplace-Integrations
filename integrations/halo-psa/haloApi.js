const REQUIRED_SETTINGS = [
  'HaloPsaResourceServer',
  'HaloPsaAuthorisationServer',
  'HaloPsaClientId',
  'HaloPsaClientSecret'
];
const { LOG_EVENT_TYPES, emitLog } = require('./runtimeLogging');
const { createSafeHttpClient } = require('./safeHttpClient');
const { ensureUrl, joinUrl } = require('./urlUtils');

const HALO_TOKEN_REUSE_SAFETY_MARGIN_MS = 60 * 1000;
const HALO_FALLBACK_TOKEN_LIFETIME_SECONDS = 3600;
const sharedHaloTokenCache = new Map();

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function getStoredSetting(context, key) {
  if (!context?.settings || typeof context.settings.get !== 'function') {
    return '';
  }

  return trimValue(await context.settings.get(key));
}

async function resolveSetting(context, requestSettings, key) {
  const secretMode = requestSettings?._secretModes?.[key];

  if (secretMode === 'stored') {
    return getStoredSetting(context, key);
  }

  const requestValue = trimValue(requestSettings?.[key]);
  if (requestValue) {
    return requestValue;
  }

  return getStoredSetting(context, key);
}

function normalizeResourceServer(value) {
  const trimmed = trimValue(value).replace(/\/+$/, '');
  return trimmed.toLowerCase().endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function normalizeAuthorisationServer(value) {
  return trimValue(value).replace(/\/+$/, '');
}

function sanitizeMessage(message) {
  const text = trimValue(message);
  if (!text) {
    return '';
  }

  return text
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/access_token["'\s:=]+[a-z0-9\-._~+/]+=*/gi, 'access_token=[redacted]')
    .replace(/refresh_token["'\s:=]+[a-z0-9\-._~+/]+=*/gi, 'refresh_token=[redacted]')
    .replace(/id_token["'\s:=]+[a-z0-9\-._~+/]+=*/gi, 'id_token=[redacted]')
    .replace(/authorization["'\s:=]+[^\r\n]+/gi, 'authorization=[redacted]')
    .replace(/client_secret["'\s:=]+[^\s,;]+/gi, 'client_secret=[redacted]')
    .replace(/cookie["'\s:=]+[^\r\n]+/gi, 'cookie=[redacted]')
    .replace(/password["'\s:=]+[^\s,;]+/gi, 'password=[redacted]')
    .replace(/secret["'\s:=]+[^\s,;]+/gi, 'secret=[redacted]');
}

class DiscoveryRequestError extends Error {
  constructor(message, diagnostic = {}) {
    super(message);
    this.name = 'DiscoveryRequestError';
    this.diagnostic = diagnostic;
  }
}

function truncateExcerpt(value, maxLength = 1000) {
  const sanitized = sanitizeMessage(String(value || '').replace(/\s+/g, ' ').trim());
  if (!sanitized) {
    return '';
  }

  return sanitized.length <= maxLength ? sanitized : `${sanitized.slice(0, maxLength - 3)}...`;
}

function resolveResponseContentType(response) {
  if (!response?.headers || typeof response.headers.get !== 'function') {
    return '';
  }

  return trimValue(response.headers.get('content-type'));
}

async function readResponseSafe(response) {
  const contentType = resolveResponseContentType(response);

  if (!response) {
    return { data: {}, contentType, bodyExcerpt: '' };
  }

  if (typeof response.text === 'function') {
    try {
      const rawText = await response.text();
      const bodyExcerpt = truncateExcerpt(rawText);
      let data = {};

      if (rawText && contentType.toLowerCase().includes('json')) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = {};
        }
      }

      return { data, contentType, bodyExcerpt };
    } catch {
      return { data: {}, contentType, bodyExcerpt: '' };
    }
  }

  if (typeof response.json === 'function') {
    try {
      const data = await response.json();
      return {
        data,
        contentType,
        bodyExcerpt: truncateExcerpt(JSON.stringify(data))
      };
    } catch {
      return { data: {}, contentType, bodyExcerpt: '' };
    }
  }

  return { data: {}, contentType, bodyExcerpt: '' };
}

function firstSanitizedString(input, keys) {
  for (const key of keys) {
    const value = input?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return sanitizeMessage(String(value));
    }
  }

  return '';
}

function splitPathAndQuery(path) {
  const [requestPath, query = ''] = String(path || '').split('?');
  return {
    path: requestPath || '',
    query
  };
}

function buildSafeResponseSummary(payload) {
  return {
    errorCode: firstSanitizedString(payload, ['error_code', 'errorCode', 'code', 'error']),
    errorMessage: firstSanitizedString(payload, ['error_description', 'errorDescription', 'message', 'error_message'])
  };
}

function resolveResourceServer(settings) {
  const normalized = trimValue(settings?.HaloPsaResourceServer);
  if (!normalized) {
    return '';
  }

  try {
    const url = new URL(normalized);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalized;
  }
}

function normalizeTokenExpirySeconds(rawValue) {
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return HALO_FALLBACK_TOKEN_LIFETIME_SECONDS;
}

function createHaloTokenCacheKey(connection = {}) {
  return JSON.stringify({
    authorisationServer: trimValue(connection.authorisationServer || connection.HaloPsaAuthorisationServer).toLowerCase(),
    clientId: trimValue(connection.clientId || connection.HaloPsaClientId),
    clientSecret: trimValue(connection.clientSecret || connection.HaloPsaClientSecret)
  });
}

function readCachedHaloToken(connection, now) {
  const cacheKey = createHaloTokenCacheKey(connection);
  const cached = sharedHaloTokenCache.get(cacheKey);
  const current = now();
  if (!cached) {
    return null;
  }

  if (current >= cached.expiresAtMs - HALO_TOKEN_REUSE_SAFETY_MARGIN_MS) {
    sharedHaloTokenCache.delete(cacheKey);
    return null;
  }

  return {
    accessToken: cached.accessToken,
    tokenType: cached.tokenType || 'Bearer',
    expiresInSeconds: Math.max(1, Math.floor((cached.expiresAtMs - current) / 1000))
  };
}

function cacheHaloToken(connection, payload, now) {
  const accessToken = trimValue(payload?.access_token);
  if (!accessToken) {
    throw new Error('HaloPSA token response did not include an access token.');
  }

  const expiresInSeconds = normalizeTokenExpirySeconds(payload?.expires_in);
  const token = {
    accessToken,
    tokenType: trimValue(payload?.token_type) || 'Bearer',
    expiresInSeconds
  };

  sharedHaloTokenCache.set(createHaloTokenCacheKey(connection), {
    accessToken: token.accessToken,
    tokenType: token.tokenType,
    expiresAtMs: now() + expiresInSeconds * 1000
  });

  return token;
}

async function getHaloAccessToken(connection, opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const cached = readCachedHaloToken(connection, now);
  if (cached) {
    return cached;
  }

  const httpClient = opts.httpClient || createSafeHttpClient({ name: 'halo', runLogger: opts.runLogger || null });
  const response = await httpClient.requestJson({
    method: 'POST',
    url: joinUrl(connection.authorisationServer || connection.HaloPsaAuthorisationServer, '/token'),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: connection.clientId || connection.HaloPsaClientId,
      client_secret: connection.clientSecret || connection.HaloPsaClientSecret,
      scope: 'all'
    }).toString(),
    runId: String(opts.runId || 'halo-auth'),
    timeoutMs: opts.timeoutMs,
    maxAttempts: opts.maxAttempts,
    abortSignal: opts.abortSignal || null
  });
  const payload = response.data && typeof response.data === 'object' ? response.data : {};
  return cacheHaloToken(connection, payload, now);
}

function resetHaloTokenCache() {
  sharedHaloTokenCache.clear();
}

async function requestToken(settings, opts = {}) {
  try {
    return await getHaloAccessToken(settings, {
      httpClient: opts.httpClient || createSafeHttpClient({ name: 'halo-discovery', runLogger: opts.runLogger || null }),
      runLogger: opts.runLogger || null,
      runId: String(opts.runId || 'halo-discovery-token'),
      timeoutMs: opts.timeoutMs,
      maxAttempts: opts.maxAttempts,
      now: opts.now
    });
  } catch (error) {
    throw new DiscoveryRequestError('HaloPSA client discovery failed. Check HaloPSA client-read access and retry.', {
      operation: 'discover-halo-clients',
      resolvedResourceServer: resolveResourceServer(settings),
      request: {
        method: 'POST',
        path: '/token',
        query: ''
      },
      response: {
        status: Number(error?.statusCode || 0) || null,
        contentType: String(error?.responseHeaders?.['content-type'] || ''),
        bodyExcerpt: truncateExcerpt(JSON.stringify(error?.responsePayload || {})),
        ...buildSafeResponseSummary(error?.responsePayload || {})
      }
    });
  }
}

async function requestReadOnlyJson(settings, accessToken, path, opts = {}) {
  const tokenValue = typeof accessToken === 'string' ? accessToken : accessToken?.accessToken;
  const tokenType = typeof accessToken === 'string' ? 'Bearer' : trimValue(accessToken?.tokenType) || 'Bearer';
  const httpClient = opts.httpClient || createSafeHttpClient({ name: 'halo-discovery', runLogger: opts.runLogger || null });
  let response;
  try {
    response = await httpClient.requestJson({
      method: 'GET',
      url: `${settings.HaloPsaResourceServer}${path}`,
      headers: {
        Authorization: `${tokenType} ${tokenValue}`,
        Accept: 'application/json'
      },
      runId: String(opts.runId || 'halo-discovery-read-only'),
      timeoutMs: opts.timeoutMs,
      maxAttempts: opts.maxAttempts
    });
  } catch (error) {
    const requestDetails = splitPathAndQuery(path);
    const safeResponse = {
      status: Number(error?.statusCode || 0) || null,
      contentType: String(error?.responseHeaders?.['content-type'] || ''),
      ...buildSafeResponseSummary(error?.responsePayload || {})
    };
    const bodyExcerpt = truncateExcerpt(JSON.stringify(error?.responsePayload || {}));
    if (bodyExcerpt) {
      safeResponse.bodyExcerpt = bodyExcerpt;
    }

    if (path === '/Client') {
      throw new DiscoveryRequestError('HaloPSA client discovery failed. Check HaloPSA client-read access and retry.', {
        operation: 'discover-halo-clients',
        resolvedResourceServer: resolveResourceServer(settings),
        request: {
          method: 'GET',
          path: requestDetails.path,
          query: requestDetails.query
        },
        response: safeResponse
      });
    }

    throw new DiscoveryRequestError(`HaloPSA read-only API request failed (HTTP ${safeResponse.status || 'unknown'}).`, {
      operation: 'discover-halo-read-only',
      resolvedResourceServer: resolveResourceServer(settings),
      request: {
        method: 'GET',
        path: requestDetails.path,
        query: requestDetails.query
      },
      response: safeResponse
    });
  }

  const data = response.data;
  const contentType = String(response.headers?.['content-type'] || '');
  const bodyExcerpt = truncateExcerpt(JSON.stringify(data));
  if (Number(response.statusCode || 200) >= 400) {
    const requestDetails = splitPathAndQuery(path);
    const safeResponse = {
      status: response.statusCode,
      contentType,
      ...buildSafeResponseSummary(data)
    };

    if (bodyExcerpt) {
      safeResponse.bodyExcerpt = bodyExcerpt;
    }

    if (path === '/Client') {
      throw new DiscoveryRequestError('HaloPSA client discovery failed. Check HaloPSA client-read access and retry.', {
        operation: 'discover-halo-clients',
        resolvedResourceServer: resolveResourceServer(settings),
        request: {
          method: 'GET',
          path: requestDetails.path,
          query: requestDetails.query
        },
        response: safeResponse
      });
    }

    throw new DiscoveryRequestError(`HaloPSA read-only API request failed (HTTP ${response.statusCode}).`, {
      operation: 'discover-halo-read-only',
      resolvedResourceServer: resolveResourceServer(settings),
      request: {
        method: 'GET',
        path: requestDetails.path,
        query: requestDetails.query
      },
      response: safeResponse
    });
  }

  return data;
}

async function requestReadOnlyCheck(settings, accessToken) {
  await requestReadOnlyJson(settings, accessToken, '/Team?$top=1');
}

async function loadSettings(context, request = {}) {
  const requestSettings = request.settings || {};
  const settings = {};

  for (const key of REQUIRED_SETTINGS) {
    settings[key] = await resolveSetting(context, requestSettings, key);
  }

  settings.HaloPsaResourceServer = normalizeResourceServer(settings.HaloPsaResourceServer);
  settings.HaloPsaAuthorisationServer = normalizeAuthorisationServer(settings.HaloPsaAuthorisationServer);
  return settings;
}

function missingRequiredSettings(settings) {
  return REQUIRED_SETTINGS.filter((key) => !trimValue(settings?.[key]));
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.clients)) return value.clients;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.value)) return value.value;
    if (Array.isArray(value.categories)) return value.categories;
    if (Array.isArray(value.statuses)) return value.statuses;
    if (Array.isArray(value.teams)) return value.teams;
    if (Array.isArray(value.tickettypes)) return value.tickettypes;
    if (Array.isArray(value.ticketTypes)) return value.ticketTypes;
  }
  return [];
}

function firstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return '';
}

function normalizeOption(row, keyCandidates, labelCandidates) {
  const id = firstString(row, keyCandidates);
  const name = firstString(row, labelCandidates);
  if (!id || !name) {
    return null;
  }
  return { id, name };
}

function normalizeStatus(row) {
  const normalized = normalizeOption(row, ['id', 'status_id'], ['name', 'status']);
  if (!normalized) {
    return null;
  }
  const isClosedRaw = row?.is_closed ?? row?.closed ?? row?.isclosed ?? row?.hasbeenclosed;
  return {
    ...normalized,
    isClosed: isClosedRaw === undefined ? undefined : Boolean(isClosedRaw)
  };
}

function normalizeCategory(row) {
  const id = firstString(row, ['id', 'category_id']);
  const name = firstString(row, ['value', 'category_name', 'name', 'label']);
  if (!id || !name) {
    return null;
  }
  return { id, name };
}

function normalizeClient(row) {
  const id = firstString(row, ['id', 'client_id']);
  const name = firstString(row, ['name', 'client_name']);
  if (!id || !name) {
    return null;
  }
  return { id, name };
}

function dedupeRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row?.id || !row?.name) continue;
    const key = `${row.id}|${row.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function extractAllowedStatuses(payload) {
  const raw = [
    ...toArray(payload?.allowed_status),
    ...toArray(payload?.allowed_statuses),
    ...toArray(payload?.allowedStatuses)
  ];
  return dedupeRows(raw.map(normalizeStatus).filter(Boolean));
}

function extractAllowedCategories(payload) {
  const raw = [
    ...toArray(payload?.allowed_category),
    ...toArray(payload?.allowed_categories),
    ...toArray(payload?.allowedCategories)
  ];
  return dedupeRows(raw.map((row) => normalizeOption(row, ['id', 'category_id', 'value'], ['name', 'category', 'label'])).filter(Boolean));
}

async function discoverSettingsOptions(settings, accessToken, selectedTicketTypeId) {
  const [teamsPayload, ticketTypesPayload, statusesPayload, categoriesPayload] = await Promise.all([
    requestReadOnlyJson(settings, accessToken, '/Team?$top=200'),
    requestReadOnlyJson(settings, accessToken, '/TicketType?$top=200'),
    requestReadOnlyJson(settings, accessToken, '/Status?$top=200'),
    requestReadOnlyJson(settings, accessToken, '/Category?$top=200')
  ]);

  const ticketTypeId = trimValue(selectedTicketTypeId);
  let ticketTypeDetail = null;
  if (ticketTypeId) {
    const detailPayload = await requestReadOnlyJson(
      settings,
      accessToken,
      `/TicketType/${encodeURIComponent(ticketTypeId)}`
    );
    const detail = Array.isArray(detailPayload) ? detailPayload[0] || {} : detailPayload;
    ticketTypeDetail = {
      id: firstString(detail, ['id', 'tickettype_id', 'ticket_type_id']) || ticketTypeId,
      name: firstString(detail, ['name', 'tickettype']),
      allowedStatuses: extractAllowedStatuses(detail),
      allowedCategories: extractAllowedCategories(detail)
    };
  }

  return {
    teams: dedupeRows(toArray(teamsPayload).map((row) => normalizeOption(row, ['id', 'team_id'], ['name', 'team_name'])).filter(Boolean)),
    ticketTypes: dedupeRows(toArray(ticketTypesPayload).map((row) => normalizeOption(row, ['id', 'tickettype_id', 'ticket_type_id'], ['name', 'tickettype'])).filter(Boolean)),
    statuses: dedupeRows(toArray(statusesPayload).map(normalizeStatus).filter(Boolean)),
    categories: dedupeRows(toArray(categoriesPayload).map(normalizeCategory).filter(Boolean)),
    ticketTypeDetail
  };
}

async function discoverHaloClients(settings, accessToken) {
  const payload = await requestReadOnlyJson(settings, accessToken, '/Client');
  return dedupeRows(toArray(payload).map(normalizeClient).filter(Boolean));
}

function createHaloAuthClient(opts = {}) {
  const runLogger = opts.runLogger || null;
  const httpClient = opts.httpClient || createSafeHttpClient({ name: 'halo', runLogger });
  const connectionProvider = opts.connectionProvider || null;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;

  return {
    requestResource
  };

  async function requestResource(req = {}) {
    const connection = await resolveConnection(connectionProvider);
    const token = await requestHaloToken(connection, httpClient, String(req.runId || 'halo-auth'), now);
    const path = String(req.path || '').trim();
    if (!path) throw new Error('Halo request path is required');
    const url = joinUrl(connection.resourceServer, path);
    return httpClient.requestJson({
      method: String(req.method || 'GET').toUpperCase(),
      url,
      headers: {
        Authorization: `${token.tokenType} ${token.accessToken}`,
        Accept: 'application/json'
      },
      body: req.body,
      runId: String(req.runId || 'halo-request'),
      maxAttempts: req.maxAttempts,
      timeoutMs: req.timeoutMs,
      abortSignal: req.abortSignal || null,
      expectedStatusCodes: req.expectedStatusCodes
    });
  }
}

function createHaloTicketsClient(opts = {}) {
  const runLogger = opts.runLogger || null;
  const authClient = opts.haloAuthClient || createHaloAuthClient({ runLogger, connectionProvider: opts.connectionProvider, httpClient: opts.httpClient });

  return {
    createTicket,
    getTicket,
    setTicketStatus,
    updateTicket
  };

  async function createTicket(payload) {
    const requestPayload = normalizeCreatePayload(payload);
    await emitLog({
      runLogger,
      runId: 'halo-ticket-create',
      eventType: LOG_EVENT_TYPES.LIFECYCLE_DECISION,
      message: 'Halo ticket create request started',
      context: {
        hasStatusId: Object.prototype.hasOwnProperty.call(requestPayload, 'status_id'),
        hasTeamId: Object.prototype.hasOwnProperty.call(requestPayload, 'team_id'),
        hasCategory1: Object.prototype.hasOwnProperty.call(requestPayload, 'category_1')
      }
    });

    let response;
    try {
      response = await authClient.requestResource({
        method: 'POST',
        path: '/Tickets',
        body: [requestPayload],
        runId: 'halo-ticket-create',
        maxAttempts: 1,
        timeoutMs: 60000
      });
    } catch (error) {
      const typedError = toHaloCreateRejectedError(error);
      if (typedError) throw typedError;
      throw error;
    }
    return normalizeCreatedTicket(response?.data);
  }

  async function updateTicket(ticketId, payload) {
    const id = trimValue(ticketId);
    if (!id) throw new Error('halo_update_ticket_missing_ticket_id');
    const response = await authClient.requestResource({
      method: 'POST',
      path: '/Tickets',
      body: [normalizeUpdatePayload(id, payload)],
      runId: 'halo-ticket-update'
    });
    return normalizeCreatedTicket(response?.data);
  }

  async function getTicket(ticketId) {
    const id = trimValue(ticketId);
    if (!id) throw new Error('halo_get_ticket_missing_ticket_id');
    try {
      const response = await authClient.requestResource({
        method: 'GET',
        path: `/Tickets/${encodeURIComponent(id)}`,
        runId: 'halo-ticket-get',
        expectedStatusCodes: [404]
      });
      return normalizeOptionalTicket(response?.data);
    } catch (error) {
      if (Number(error?.statusCode) === 404) return null;
      throw error;
    }
  }

  async function setTicketStatus(ticketId, statusId) {
    const id = trimValue(ticketId);
    const status = trimValue(statusId);
    if (!id) throw new Error('halo_set_status_missing_ticket_id');
    if (!status) throw new Error('halo_set_status_missing_status_id');
    const response = await authClient.requestResource({
      method: 'POST',
      path: '/Tickets',
      body: [{ id: toIdValue(id), status_id: toIdValue(status) }],
      runId: 'halo-ticket-status'
    });
    return normalizeCreatedTicket(response?.data);
  }
}

async function resolveConnection(connectionProvider) {
  const raw = typeof connectionProvider === 'function' ? await connectionProvider() : connectionProvider;
  if (!raw || typeof raw !== 'object') throw new Error('HaloPSA connection is not configured');
  const resourceServer = ensureUrl(raw.resourceServer, 'HaloPSA resourceServer');
  const authorisationServer = ensureUrl(raw.authorisationServer, 'HaloPSA authorisationServer');
  const clientId = trimValue(raw.clientId);
  const clientSecret = trimValue(raw.clientSecret);
  if (!clientId) throw new Error('HaloPSA clientId is required');
  if (!clientSecret) throw new Error('HaloPSA clientSecret is required');
  return { resourceServer, authorisationServer, clientId, clientSecret };
}

async function requestHaloToken(connection, httpClient, runId, now) {
  return getHaloAccessToken(connection, {
    httpClient,
    runId,
    now
  });
}

function normalizeCreatePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const summary = trimValue(source.summary);
  const details = normalizeMultilineDetails(source.details);
  const detailsHtml = normalizeHtmlDetails(source.details_html);
  const clientId = source.client_id;
  const ticketTypeId = source.tickettype_id;
  if (!summary) throw new Error('halo_create_payload_missing_summary');
  if (!details) throw new Error('halo_create_payload_missing_details');
  if (clientId === undefined || clientId === null || String(clientId).trim() === '') throw new Error('halo_create_payload_missing_client_id');
  if (ticketTypeId === undefined || ticketTypeId === null || String(ticketTypeId).trim() === '') throw new Error('halo_create_payload_missing_tickettype_id');
  const out = { summary, details, client_id: clientId, tickettype_id: ticketTypeId };
  if (detailsHtml) out.details_html = detailsHtml;
  if (source.status_id !== undefined && source.status_id !== null && String(source.status_id).trim() !== '') out.status_id = source.status_id;
  if (source.team_id !== undefined && source.team_id !== null && String(source.team_id).trim() !== '') out.team_id = source.team_id;
  if (source.category_1 !== undefined && source.category_1 !== null && String(source.category_1).trim() !== '') out.category_1 = String(source.category_1).trim();
  return out;
}

function normalizeUpdatePayload(ticketId, payload) {
  return { id: toIdValue(ticketId), ...normalizeCreatePayload(payload) };
}

function normalizeCreatedTicket(data) {
  const row = Array.isArray(data) ? data[0] || {} : data && typeof data === 'object' ? data : {};
  const id = firstString(row, ['id', 'ticket_id']);
  if (!id) throw new Error('halo_create_ticket_response_missing_id');
  const statusId = firstString(row, ['status_id', 'statusid']);
  const statusName = firstString(row, ['status', 'status_name']);
  const number = firstString(row, ['ticketnumber', 'number', 'ticket_number']);
  const isClosedRaw = row?.is_closed ?? row?.isClosed ?? row?.closed;
  return { id, number, statusId, statusName, isClosed: isClosedRaw === undefined ? false : Boolean(isClosedRaw) };
}

function normalizeOptionalTicket(data) {
  if (data === null || data === undefined) return null;
  const row = Array.isArray(data) ? data[0] || {} : data && typeof data === 'object' ? data : {};
  const id = firstString(row, ['id', 'ticket_id']);
  if (!id) return null;
  const statusId = firstString(row, ['status_id', 'statusid']);
  const statusName = firstString(row, ['status', 'status_name']);
  const number = firstString(row, ['ticketnumber', 'number', 'ticket_number']);
  const isClosedRaw = row?.is_closed ?? row?.isClosed ?? row?.closed;
  return { id, number, statusId, statusName, isClosed: isClosedRaw === undefined ? false : Boolean(isClosedRaw) };
}

function toIdValue(value) {
  return /^\d+$/.test(String(value || '')) ? Number(value) : value;
}

function normalizeMultilineDetails(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n') : '';
}

function normalizeHtmlDetails(value) {
  return String(value || '').trim() || '';
}

function toHaloCreateRejectedError(error) {
  const statusCode = Number(error?.statusCode || 0);
  if (!statusCode || statusCode < 400) return null;
  const requestUrl = String(error?.url || '');
  if (!/\/tickets(?:\?|$)/i.test(requestUrl)) return null;
  const typed = new Error('Halo rejected ticket creation. Check Ticket Type / Status / Team / Category compatibility.');
  typed.code = 'halo_create_rejected';
  typed.statusCode = statusCode;
  typed.safeDetail = extractSafeHaloCreateDetail(error?.responsePayload);
  typed.cause = error;
  return typed;
}

function extractSafeHaloCreateDetail(responsePayload) {
  const candidates = [];
  collectSafeDetailCandidates(responsePayload, candidates);
  for (const candidate of candidates) {
    const detail = sanitizeHaloCreateDetail(candidate);
    if (detail) return detail;
  }
  return '';
}

function collectSafeDetailCandidates(value, out) {
  if (!value) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const row of value) collectSafeDetailCandidates(row, out);
    return;
  }
  if (typeof value !== 'object') {
    out.push(String(value));
    return;
  }
  for (const key of ['message', 'error', '_warning', 'warning', 'details', '_raw']) {
    if (value[key] !== undefined && value[key] !== null) collectSafeDetailCandidates(value[key], out);
  }
}

function sanitizeHaloCreateDetail(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const segments = text
    .replace(/\r\n/g, '\n')
    .split(/[\n.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !containsSecretLikeText(segment))
    .map((segment) => segment.replace(/\s+/g, ' ').trim());
  const normalized = segments.join('. ').trim();
  if (!normalized) return '';
  return normalized.length > 160 ? `${normalized.slice(0, 157).trimEnd()}...` : normalized;
}

function containsSecretLikeText(rawMessage) {
  const lower = String(rawMessage || '').toLowerCase();
  return lower.includes('secret') || lower.includes('token') || lower.includes('authorization') || lower.includes('bearer') || lower.includes('password') || lower.includes('x-tenant');
}

module.exports = {
  __resetHaloTokenCache: resetHaloTokenCache,
  createHaloAuthClient,
  createHaloTicketsClient,
  REQUIRED_SETTINGS,
  DiscoveryRequestError,
  discoverHaloClients,
  discoverSettingsOptions,
  loadSettings,
  missingRequiredSettings,
  normalizeCreatePayload,
  normalizeCategory,
  normalizeCreatedTicket,
  normalizeOptionalTicket,
  normalizeUpdatePayload,
  requestReadOnlyJson,
  requestReadOnlyCheck,
  requestToken,
  sanitizeMessage,
  truncateExcerpt,
  trimValue
};
