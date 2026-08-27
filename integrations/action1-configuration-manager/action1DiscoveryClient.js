const DEFAULT_ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_RETRIES = 3;
const REFRESH_SAFETY_MARGIN_MS = 60000;
const DEFAULT_TOKEN_TTL_MS = 3600000;
const { getDefaultAction1RuntimeLogger } = require('./runtimeLogging');

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  const trimmed = trimString(value || DEFAULT_ACTION1_BASE_URL);
  if (!trimmed) {
    throw new Error('Action1 base URL is required.');
  }

  let normalized;
  try {
    normalized = new URL(trimmed).toString();
  } catch (error) {
    throw new Error('Action1 base URL is invalid.');
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function sanitizeMessage(message) {
  return String(message || '')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/access_token["'\s:=]+[^\s",'&]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["'\s:=]+[^\s",'&]+/gi, 'refresh_token=[redacted]')
    .replace(/id_token["'\s:=]+[^\s",'&]+/gi, 'id_token=[redacted]')
    .replace(/authorization["'\s:=]+[^\r\n]+/gi, 'authorization=[redacted]')
    .replace(/client_secret["'\s:=]+[^\s",'&]+/gi, 'client_secret=[redacted]')
    .replace(/apiSecret["'\s:=]+[^\s",'&]+/gi, 'apiSecret=[redacted]')
    .replace(/password["'\s:=]+[^\s",'&]+/gi, 'password=[redacted]')
    .replace(/cookie["'\s:=]+[^\r\n]+/gi, 'cookie=[redacted]')
    .replace(/secret=([^\s&]+)/gi, 'secret=[redacted]');
}

function toSafeExcerpt(value) {
  const normalized = sanitizeMessage(String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim());
  return normalized.length <= 1000 ? normalized : normalized.slice(0, 1000);
}

function extractSafeSummary(payload) {
  const objectPayload = payload && typeof payload === 'object' ? payload : {};
  const errorCodeKeys = ['error_code', 'errorCode', 'code', 'error'];
  const errorMessageKeys = ['error_description', 'errorDescription', 'message', 'error_message', 'developer_message'];

  function firstNonEmpty(keys) {
    for (const key of keys) {
      const value = trimString(objectPayload[key]);
      if (value) {
        return sanitizeMessage(value);
      }
    }
    return '';
  }

  return {
    errorCode: firstNonEmpty(errorCodeKeys),
    errorMessage: firstNonEmpty(errorMessageKeys)
  };
}

function isSuccessStatus(statusCode) {
  return Number.isFinite(Number(statusCode)) && Number(statusCode) >= 200 && Number(statusCode) < 300;
}

function clampMaxRetries(value) {
  if (!Number.isFinite(Number(value))) {
    return DEFAULT_MAX_RETRIES;
  }
  return Math.max(0, Math.floor(Number(value)));
}

function joinUrl(baseUrl, nextPath) {
  const relativePath = String(nextPath || '').replace(/^\/+/, '');
  return new URL(relativePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function safeBaseDetails(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return { baseHost: parsed.host, basePath: parsed.pathname };
  } catch (error) {
    return { baseHost: '', basePath: '' };
  }
}

function safeRequestPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return '';
  }
}

function logDiscovery(context, level, event, fields = {}) {
  const logger = context?.logger;
  const entry = { event, ...fields };
  if (typeof logger?.[level] === 'function') {
    logger[level](entry);
  }
  const runtimeLogger = context?.action1ConfigurationManagerRuntimeLogger || getDefaultAction1RuntimeLogger();
  const message = formatRuntimeMessage(event, fields);
  const runtimeLevel = getRuntimeLogLevel(event, level);
  if (message && typeof runtimeLogger?.[runtimeLevel] === 'function') {
    Promise.resolve(runtimeLogger[runtimeLevel](message)).catch(() => {});
  }
}

function getRuntimeLogLevel(event, fallbackLevel) {
  if (/token|page|request|response|credential|connection/.test(String(event))) return 'debug';
  if (/rate-limit/.test(String(event))) return 'warn';
  if (/failure|rejected/.test(String(event))) return 'error';
  return fallbackLevel;
}

function formatRuntimeMessage(event, fields) {
  switch (event) {
    case 'action1-discovery-start':
      return `Discovery started: ${fields.action || 'Action1 discovery'}`;
    case 'action1-discovery-complete':
      return fields.organizationsDiscovered !== undefined
        ? `Loaded ${fields.organizationsDiscovered} Action1 organizations`
        : `Loaded ${fields.endpointGroupsDiscovered || 0} endpoint groups for organization ${fields.organizationId || '<unknown>'}`;
    case 'action1-discovery-token-cache-reused':
      return `Reused Action1 access token; ${Math.floor(Number(fields.ttlMs || 0) / 1000)}s remaining`;
    case 'action1-discovery-token-refresh-required':
      return `Action1 access token refresh required (${fields.cacheState || 'unknown'})`;
    case 'action1-discovery-token-request-started':
      return 'Acquiring Action1 access token';
    case 'action1-discovery-token-response-accepted':
      return `Action1 access token accepted; ${Math.floor(Number(fields.ttlMs || 0) / 1000)}s lifetime`;
    case 'action1-discovery-credentials-resolved':
      return `Action1 credentials resolved; apiKeyPresent=${fields.hasApiKey} apiSecretPresent=${fields.hasApiSecret} baseUrlPresent=${fields.hasBaseUrl}`;
    case 'action1-discovery-page-complete':
      return `Loaded Action1 page ${fields.page || 0}; ${fields.itemCount || 0} items`;
    case 'action1-discovery-rate-limit-detected':
      return `Action1 rate limit received; retrying if budget remains (attempt ${Number(fields.retryAttempt || 0) + 1}/${fields.retryBudget})`;
    case 'action1-rate-limit':
      return `Action1 rate limit received; retrying in ${Math.ceil(Number(fields.delayMs || 0) / 1000)}s (attempt ${fields.retryAttempt}/${fields.retryBudget || '?'})`;
    case 'action1-discovery-failure':
    case 'action1-policy-discovery-failure':
      return `Action1 discovery failed: ${fields.errorMessage || fields.message || fields.category || 'unknown error'}`;
    default:
      return '';
  }
}

async function executeTransportRequest(context, requestOptions) {
  const transportOptions = { ...requestOptions };
  if (Object.prototype.hasOwnProperty.call(transportOptions, 'body') && !Object.prototype.hasOwnProperty.call(transportOptions, 'data')) {
    transportOptions.data = transportOptions.body;
    delete transportOptions.body;
  }
  if (typeof context?.http === 'function') {
    return context.http(transportOptions);
  }
  if (typeof context?.http?.request === 'function') {
    return context.http.request(transportOptions);
  }
  throw new Error('Marketplace HTTP transport is unavailable.');
}

function normalizeTransportResponse(response) {
  const normalized = response && typeof response === 'object' ? response : {};
  const payload =
    normalized.payload !== undefined
      ? normalized.payload
      : normalized.data !== undefined
        ? normalized.data
        : normalized.body !== undefined
          ? normalized.body
          : normalized.json !== undefined
            ? normalized.json
            : {};

  return {
    statusCode: Number(normalized.statusCode !== undefined ? normalized.statusCode : normalized.status),
    headers: normalized.headers || normalized.responseHeaders || {},
    payload
  };
}

class DiscoveryRequestError extends Error {
  constructor(message, diagnostics = {}) {
    super(message);
    this.name = 'DiscoveryRequestError';
    this.diagnostics = diagnostics;
    if (diagnostics.statusCode !== undefined) {
      this.statusCode = diagnostics.statusCode;
    }
    if (diagnostics.responseHeaders) {
      this.responseHeaders = diagnostics.responseHeaders;
    }
    if (diagnostics.errorCode) {
      this.code = diagnostics.errorCode;
    }
  }
}

async function resolveCanonicalConnection(context, explicitConnection) {
  const rawConnection = explicitConnection || {};
  let credentials;
  try {
    credentials = explicitConnection
      ? rawConnection
      : await context.action1.getCredentials();
  } catch (error) {
    logDiscovery(context, 'warn', 'action1-discovery-credential-resolution-failed', {
      stage: 'credential-resolution',
      category: 'credential-resolution',
      message: sanitizeMessage(error?.message || 'Marketplace Action1 credentials could not be resolved.')
    });
    throw new DiscoveryRequestError('Marketplace Action1 credentials could not be resolved.', {
      phase: 'credential-resolution'
    });
  }

  const hasApiKey = !!trimString(credentials?.clientId || credentials?.apiKey);
  const hasApiSecret = !!trimString(credentials?.clientSecret || credentials?.apiSecret);
  // Marketplace's canonical credential contract supplies API credentials; the
  // base URL is optional connection metadata and must not gate API access.
  const baseUrl = credentials?.baseUrl || DEFAULT_ACTION1_BASE_URL;
  logDiscovery(context, 'info', 'action1-discovery-credentials-resolved', {
    stage: 'credential-resolution',
    credentialsResolved: !!credentials && typeof credentials === 'object',
    hasApiKey,
    hasApiSecret,
    hasOrganizationId: !!trimString(credentials?.organizationId),
    hasBaseUrl: !!trimString(credentials?.baseUrl),
    ...safeBaseDetails(baseUrl)
  });

  if (!credentials || typeof credentials !== 'object') {
    throw new DiscoveryRequestError('Marketplace Action1 credentials are incomplete.', {
      phase: 'credential-resolution'
    });
  }

  const clientId = trimString(credentials.clientId || credentials.apiKey);
  const clientSecret = trimString(credentials.clientSecret || credentials.apiSecret);
  if (!clientId || !clientSecret) {
    throw new DiscoveryRequestError('Marketplace Action1 credentials are incomplete.', {
      phase: 'credential-resolution'
    });
  }

  let normalizedBaseUrl;
  try {
    normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  } catch (error) {
    logDiscovery(context, 'warn', 'action1-discovery-connection-validation-failed', {
      stage: 'connection-validation',
      category: 'invalid-base-url',
      message: sanitizeMessage(error?.message || 'Action1 base URL is invalid.')
    });
    throw new DiscoveryRequestError('Action1 connection validation failed.', {
      phase: 'connection-validation'
    });
  }

  return {
    baseUrl: normalizedBaseUrl,
    clientId,
    clientSecret
  };
}

function getTokenCacheKey(connection) {
  return `${connection.baseUrl}|${connection.clientId}|${connection.clientSecret}`;
}

async function resolveAction1ConsoleOrigin(context) {
  let credentials;
  try {
    credentials = await context.action1.getCredentials();
  } catch (error) {
    return null;
  }
  const suppliedBaseUrl = trimString(credentials?.baseUrl);
  if (!suppliedBaseUrl) {
    return null;
  }
  const parsed = new URL(normalizeBaseUrl(suppliedBaseUrl));
  return `${parsed.protocol}//${parsed.host}`;
}

function resolveTokenLifetimeMs(expiresIn) {
  const numeric = Number(expiresIn);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric * 1000);
  }
  return DEFAULT_TOKEN_TTL_MS;
}

function buildFailureDiagnostics(operation, request, response) {
  const safeSummary = extractSafeSummary(response?.payload);
  return {
    operation,
    requestMethod: trimString(request?.method),
    requestPath: trimString(request?.path),
    statusCode: response?.statusCode,
    responseContentType: trimString(response?.headers?.['content-type'] || response?.headers?.['Content-Type']),
    responseExcerpt: toSafeExcerpt(JSON.stringify(response?.payload || {})),
    errorCode: safeSummary.errorCode,
    errorMessage: safeSummary.errorMessage
  };
}

function extractOrganizationRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.organizations)) {
    return payload.organizations;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.value)) {
    return payload.value;
  }
  return [];
}

function normalizeOrganizationRow(row) {
  const organizationId = trimString(row?.id || row?.org_id || row?.organizationId || row?.organization_id);
  const organizationName = trimString(row?.name || row?.org_name || row?.organizationName || row?.organization_name);
  if (!organizationId || !organizationName) {
    return null;
  }
  return {
    organizationId,
    organizationName
  };
}

function normalizeEndpointGroupRow(row, organizationId) {
  const endpointGroupId = trimString(row?.id || row?.group_id || row?.endpointGroupId || row?.endpoint_group_id);
  const endpointGroupName = trimString(row?.name || row?.display_name || row?.endpointGroupName || row?.endpoint_group_name);
  if (!endpointGroupId || !endpointGroupName) {
    return null;
  }

  const endpointCount = Number(row?.endpoint_count ?? row?.count ?? row?.endpointCount ?? 0);
  return {
    organizationId,
    endpointGroupId,
    endpointGroupName,
    endpointCount: Number.isFinite(endpointCount) ? endpointCount : 0
  };
}

function resolveContinuation(payload, currentUrl) {
  const candidates = [
    payload?.next_page,
    payload?.nextPage,
    payload?.next,
    payload?.nextLink
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  const totalItems = Number(payload?.total_items);
  const currentFrom = Number(payload?.from);
  const pageItemCount = Array.isArray(payload?.items) ? payload.items.length : 0;
  if (!Number.isFinite(totalItems) || !Number.isFinite(currentFrom) || !Number.isFinite(pageItemCount) || pageItemCount <= 0) {
    return '';
  }

  const nextFrom = currentFrom + pageItemCount;
  if (nextFrom >= totalItems || nextFrom <= currentFrom) {
    return '';
  }

  const nextUrl = new URL(currentUrl);
  const limit = Number(nextUrl.searchParams.get('limit'));
  nextUrl.searchParams.set('from', String(nextFrom));
  if (Number.isFinite(limit) && limit > 0) {
    nextUrl.searchParams.set('limit', String(limit));
  }
  return nextUrl.toString();
}

function parseRetryAfterMs(value, now) {
  const trimmed = trimString(value);
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric * 1000);
  }
  const parsedDateMs = Date.parse(trimmed);
  if (Number.isFinite(parsedDateMs)) {
    return Math.max(0, parsedDateMs - now());
  }
  return null;
}

function resolveRetryAfterMs(error, now) {
  if (Number.isFinite(Number(error?.retryAfterMs)) && Number(error.retryAfterMs) >= 0) {
    return Math.floor(Number(error.retryAfterMs));
  }
  return parseRetryAfterMs(error?.responseHeaders?.['retry-after'], now);
}

function computeAction1RateLimitDelayMs(retryAfterMs, consecutive429Count) {
  const normalizedCount = Number.isFinite(Number(consecutive429Count))
    ? Math.max(1, Math.floor(Number(consecutive429Count)))
    : 1;
  const calculatedBackoffMs = Math.min(60000, 2000 * (2 ** (normalizedCount - 1)));
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(Math.floor(calculatedBackoffMs), Math.floor(retryAfterMs));
  }
  return Math.floor(calculatedBackoffMs);
}

function isRateLimitedError(error) {
  return Number(error?.statusCode) === 429 || trimString(error?.code).toUpperCase() === 'RATE_LIMITED';
}

function logRetryDiagnostic(context, input) {
  logDiscovery(context, 'warn', 'action1-rate-limit', {
    stage: 'authenticated-get',
    organizationId: trimString(input.organizationId),
    retryAttempt: input.retryAttempt,
    consecutive429Count: input.consecutive429Count,
    delayMs: input.delayMs,
    retryAfterMs: input.retryAfterMs,
    retryBudget: input.retryBudget
  });
}

function logDiscoveryFailure(context, diagnostics) {
  context.logger?.warn?.({
    event: 'action1-discovery-failure',
    ...diagnostics,
    responseExcerpt: sanitizeMessage(diagnostics.responseExcerpt || ''),
    errorCode: sanitizeMessage(diagnostics.errorCode || ''),
    errorMessage: sanitizeMessage(diagnostics.errorMessage || '')
  });
}

function createAction1DiscoveryClient(context, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const sleep = typeof options.sleep === 'function' ? options.sleep : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const maxRetries = clampMaxRetries(options.maxRetries);
  const pageLimit = Number.isFinite(Number(options.pageLimit)) ? Math.max(1, Math.floor(Number(options.pageLimit))) : DEFAULT_PAGE_LIMIT;
  const tokenCache = options.tokenCache || new Map();

  async function resolveConnection() {
    return resolveCanonicalConnection(context, options.connection);
  }

  async function requestJson(requestOptions) {
    const operation = requestOptions.operation || 'action1-discovery';
    const requestAttempt = Number(requestOptions.requestAttempt || 1);
    const transportOptions = { ...requestOptions };
    delete transportOptions.operation;
    delete transportOptions.requestAttempt;
    logDiscovery(context, 'info', 'action1-discovery-request-start', {
      stage: 'action1-request',
      operation,
      method: transportOptions.method,
      requestPath: safeRequestPath(transportOptions.url),
      requestAttempt
    });

    let response;
    try {
      response = normalizeTransportResponse(await executeTransportRequest(context, transportOptions));
    } catch (error) {
      if (error instanceof DiscoveryRequestError) throw error;
      const errorResponse = error?.response
        ? normalizeTransportResponse(error.response)
        : { statusCode: Number(error?.statusCode), headers: error?.responseHeaders || {}, payload: error?.payload || {} };
      const diagnostics = buildFailureDiagnostics(operation, transportOptions, errorResponse);
      logDiscovery(context, 'warn', 'action1-discovery-response-rejected', {
        stage: operation,
        ...diagnostics,
        expectedShape: operation === 'token-acquisition' ? 'object.access_token' : 'successful Action1 response',
        actualShape: typeof errorResponse.payload
      });
      const wrappedError = new DiscoveryRequestError(
        sanitizeMessage(error?.message || 'Action1 discovery request failed.'),
        diagnostics
      );
      wrappedError.responseHeaders = errorResponse.headers || {};
      wrappedError.code = error?.code || (errorResponse.statusCode === 429 ? 'RATE_LIMITED' : wrappedError.code);
      throw wrappedError;
    }

    const responseContentType = trimString(response.headers?.['content-type'] || response.headers?.['Content-Type']);
    logDiscovery(context, 'info', 'action1-discovery-response', {
      stage: 'action1-response',
      operation,
      status: response.statusCode,
      contentType: responseContentType,
      payloadShape: Array.isArray(response.payload) ? 'array' : typeof response.payload,
      itemCount: Array.isArray(response.payload?.items) ? response.payload.items.length : null
    });
    if (!isSuccessStatus(response.statusCode)) {
      const diagnostics = buildFailureDiagnostics(operation, transportOptions, response);
      logDiscovery(context, 'warn', 'action1-discovery-response-rejected', {
        stage: operation,
        ...diagnostics,
        expectedShape: 'successful Action1 response',
        actualShape: typeof response.payload
      });
      throw new DiscoveryRequestError('Action1 discovery request failed.', diagnostics);
    }
    return response;
  }

  async function resolveAccessToken() {
    const connection = await resolveConnection();
    const cacheKey = getTokenCacheKey(connection);
    const currentTime = now();
    const cachedToken = tokenCache.get(cacheKey);
    if (cachedToken?.accessToken && currentTime < cachedToken.expiresAtMs - REFRESH_SAFETY_MARGIN_MS) {
      logDiscovery(context, 'info', 'action1-discovery-token-cache-reused', {
        stage: 'token-lifecycle',
        cacheState: 'reused',
        ttlMs: Math.max(0, cachedToken.expiresAtMs - currentTime)
      });
      return cachedToken.accessToken;
    }

    logDiscovery(context, 'info', 'action1-discovery-token-refresh-required', {
      stage: 'token-lifecycle',
      cacheState: cachedToken?.accessToken ? 'expired-or-near-expiry' : 'empty',
      ttlMs: cachedToken?.accessToken ? Math.max(0, cachedToken.expiresAtMs - currentTime) : null
    });
    logDiscovery(context, 'info', 'action1-discovery-token-request-started', {
      stage: 'token-lifecycle',
      operation: 'token-acquisition'
    });

    const response = await requestJson({
      operation: 'token-acquisition',
      method: 'POST',
      url: joinUrl(connection.baseUrl, '/oauth2/token'),
      path: '/oauth2/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: connection.clientId,
        client_secret: connection.clientSecret
      })
    });

    const accessToken = trimString(response.payload?.access_token);
    if (!accessToken) {
      const diagnostics = buildFailureDiagnostics('action1-token', { method: 'POST', path: '/oauth2/token' }, response);
      logDiscovery(context, 'warn', 'action1-discovery-token-response-rejected', {
        stage: 'token-response-validation',
        ...diagnostics,
        expectedShape: 'object.access_token',
        actualShape: typeof response.payload
      });
      logDiscoveryFailure(context, diagnostics);
      throw new DiscoveryRequestError('Action1 token acquisition failed because the access token was missing.', diagnostics);
    }

    const ttlMs = resolveTokenLifetimeMs(response.payload?.expires_in);
    tokenCache.set(cacheKey, { accessToken, expiresAtMs: currentTime + ttlMs });
    logDiscovery(context, 'info', 'action1-discovery-token-response-accepted', {
      stage: 'token-response-validation',
      tokenAccepted: true,
      ttlMs
    });
    return accessToken;
  }

  async function requestAction1GetWithRateLimitRetry(input) {
    let retryAttempt = 0;
    let consecutive429 = 0;

    for (;;) {
      const accessToken = await resolveAccessToken();
      try {
        const response = await requestJson({
          operation: input.operation,
          method: 'GET',
          url: input.url,
          path: input.path,
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          maxAttempts: 1,
          abortSignal: input.abortSignal,
          requestAttempt: retryAttempt + 1
        });
        consecutive429 = 0;
        return response;
      } catch (error) {
        if (!isRateLimitedError(error)) {
          throw error;
        }
        logDiscovery(context, 'warn', 'action1-discovery-rate-limit-detected', {
          stage: 'rate-limit',
          operation: input.operation,
          status: error.statusCode || error.response?.status || null,
          retryAttempt,
          retryBudget: maxRetries
        });
        if (retryAttempt >= maxRetries) {
          logDiscovery(context, 'warn', 'action1-discovery-rate-limit-exhausted', {
            stage: 'rate-limit',
            operation: input.operation,
            retryAttempt,
            retryBudget: maxRetries
          });
          throw error;
        }

        retryAttempt += 1;
        consecutive429 += 1;
        const retryAfterMs = resolveRetryAfterMs(error, now);
        const delayMs = (options.computeAction1RateLimitDelayMs || computeAction1RateLimitDelayMs)(retryAfterMs, consecutive429);
        logRetryDiagnostic(context, {
          organizationId: input.organizationId,
          retryAttempt,
          consecutive429Count: consecutive429,
          delayMs,
          retryAfterMs,
          retryBudget: maxRetries
        });
        await sleep(delayMs);
      }
    }
  }

  async function collectPagedRows(input) {
    const rows = [];
    const seen = new Set();
    let nextUrl = input.firstUrl;
    let page = 0;

    while (nextUrl) {
      page += 1;
      if (page > input.pageLimit) {
        throw new DiscoveryRequestError(`${input.resourceName} paging exceeded limit ${input.pageLimit}.`);
      }

      const absoluteUrl = joinUrl(input.baseUrl, nextUrl);
      if (seen.has(absoluteUrl)) {
        throw new DiscoveryRequestError(`${input.resourceName} paging loop detected.`);
      }
      seen.add(absoluteUrl);

      if (input.meta) {
        input.meta.pagesFetched += 1;
      }

      const response = await requestAction1GetWithRateLimitRetry({
        url: absoluteUrl,
        path: input.path || '',
        organizationId: input.organizationId,
        abortSignal: input.abortSignal
      });

      if (typeof input.onPage === 'function') {
        await input.onPage({
          page,
          requestStartedAt: input.requestStartedAt,
          responseReceivedAt: Date.now(),
          statusCode: response.statusCode,
          rowCount: Array.isArray(response.payload?.items) ? response.payload.items.length : 0,
          totalItems: response.payload?.total_items ?? response.payload?.totalItems ?? null,
          totalLiveResponses: response.payload?.total_live_responses ?? response.payload?.totalLiveResponses ?? null,
          totalSentRequests: response.payload?.total_sent_requests ?? response.payload?.totalSentRequests ?? null,
          lastRequery: response.payload?.last_requery ?? response.payload?.lastRequery ?? null
        });
      }

      const pageRows = Array.isArray(response.payload?.items) ? response.payload.items : [];
      if (input.meta) {
        input.meta.rawRowsFetched += pageRows.length;
      }

      const extractedRows = typeof input.extractRows === 'function' ? input.extractRows(response.payload) : pageRows;
      for (const item of Array.isArray(extractedRows) ? extractedRows : []) {
        const normalized = input.normalizeItem(item);
        if (normalized) {
          rows.push(normalized);
        }
      }

      nextUrl = resolveContinuation(response.payload || {}, absoluteUrl);
      logDiscovery(context, 'info', 'action1-discovery-page-complete', {
        stage: 'paged-response',
        operation: input.operation,
        page,
        itemCount: pageRows.length,
        continuationDetected: !!nextUrl,
        nextPage: nextUrl ? page + 1 : null,
        nextOffset: nextUrl ? new URL(nextUrl, absoluteUrl).searchParams.get('from') : null
      });
    }

    return rows;
  }

  async function listOrganizations() {
    logDiscovery(context, 'info', 'action1-discovery-start', {
      stage: 'discovery-start',
      action: 'discover-policy-organizations',
      organizationId: ''
    });
    const connection = await resolveConnection();
    const meta = { pagesFetched: 0, rawRowsFetched: 0 };
    const rows = await collectPagedRows({
      operation: 'organizations',
      firstUrl: 'organizations',
      pageLimit,
      resourceName: 'Action1 organizations',
      baseUrl: connection.baseUrl,
      meta,
      extractRows: extractOrganizationRows,
      normalizeItem: normalizeOrganizationRow
    });

    const deduped = [];
    const seen = new Set();
    for (const row of rows) {
      const compositeKey = `${row.organizationId}|${row.organizationName}`;
      if (!seen.has(compositeKey)) {
        seen.add(compositeKey);
        deduped.push(row);
      }
    }
    logDiscovery(context, 'info', 'action1-discovery-complete', {
      stage: 'discovery-complete',
      action: 'discover-policy-organizations',
      organizationsDiscovered: deduped.length,
      pagesFetched: meta.pagesFetched,
      rawRowsFetched: meta.rawRowsFetched
    });
    return deduped;
  }

  async function listEndpointGroups(organizationId) {
    const normalizedOrganizationId = trimString(organizationId);
    if (!normalizedOrganizationId) {
      throw new Error('Organization id is required.');
    }

    logDiscovery(context, 'info', 'action1-discovery-start', {
      stage: 'discovery-start',
      action: 'discover-policy-endpoint-groups',
      organizationId: normalizedOrganizationId
    });
    const connection = await resolveConnection();
    const meta = { pagesFetched: 0, rawRowsFetched: 0 };
    const rows = await collectPagedRows({
      operation: 'endpoint-groups',
      firstUrl: `endpoints/groups/${encodeURIComponent(normalizedOrganizationId)}?limit=500&from=0`,
      pageLimit,
      resourceName: 'Action1 endpoint groups',
      baseUrl: connection.baseUrl,
      organizationId: normalizedOrganizationId,
      meta,
      normalizeItem: (row) => normalizeEndpointGroupRow(row, normalizedOrganizationId)
    });
    logDiscovery(context, 'info', 'action1-discovery-complete', {
      stage: 'discovery-complete',
      action: 'discover-policy-endpoint-groups',
      organizationId: normalizedOrganizationId,
      endpointGroupsDiscovered: rows.length
    });
    return rows;
  }

  async function listManagedEndpoints(organizationId) {
    const normalizedOrganizationId = trimString(organizationId);
    if (!normalizedOrganizationId) throw new Error('Organization id is required.');
    const connection = await resolveConnection();
    return collectPagedRows({
      operation: 'managed-endpoints',
      firstUrl: `endpoints/managed/${encodeURIComponent(normalizedOrganizationId)}?limit=500&from=0`,
      pageLimit,
      resourceName: 'Action1 managed endpoints',
      baseUrl: connection.baseUrl,
      organizationId: normalizedOrganizationId,
      normalizeItem: (row) => row && typeof row === 'object' ? row : null
    });
  }

  async function listEndpointGroupContents(organizationId, endpointGroupId) {
    const normalizedOrganizationId = trimString(organizationId);
    const normalizedEndpointGroupId = trimString(endpointGroupId);
    if (!normalizedOrganizationId) throw new Error('Organization id is required.');
    if (!normalizedEndpointGroupId) throw new Error('Endpoint group id is required.');
    const connection = await resolveConnection();
    return collectPagedRows({
      operation: 'endpoint-group-contents',
      firstUrl: `endpoints/groups/${encodeURIComponent(normalizedOrganizationId)}/${encodeURIComponent(normalizedEndpointGroupId)}/contents?limit=500&from=0`,
      pageLimit,
      resourceName: 'Action1 endpoint group contents',
      baseUrl: connection.baseUrl,
      organizationId: normalizedOrganizationId,
      normalizeItem: (row) => row && typeof row === 'object' ? row : null
    });
  }

  async function listReportData(organizationId, reportId, options = {}) {
    const normalizedOrganizationId = trimString(organizationId);
    const normalizedReportId = trimString(reportId);
    if (!normalizedOrganizationId) throw new Error('Organization id is required.');
    if (!normalizedReportId) throw new Error('Report id is required.');
    const connection = await resolveConnection();
    const query = options.query || '?limit=200&from=0&live_only=no&details=no';
    return collectPagedRows({
      operation: 'report-data',
      firstUrl: `reportdata/${encodeURIComponent(normalizedOrganizationId)}/${encodeURIComponent(normalizedReportId)}/data${query}`,
      pageLimit,
      resourceName: 'Action1 report data',
      baseUrl: connection.baseUrl,
      organizationId: normalizedOrganizationId,
      requestStartedAt: options.requestStartedAt,
      onPage: options.onPage,
      normalizeItem: (row) => row && typeof row === 'object' ? row : null
    });
  }

  async function requestAction1Mutation(input = {}) {
    const connection = await resolveConnection();
    let retryAttempt = 0;
    let consecutive429 = 0;
    for (;;) {
      const accessToken = await resolveAccessToken();
      try {
        const response = await requestJson({
          operation: input.operation || 'action1-automation-mutation',
          method: input.method,
          url: joinUrl(connection.baseUrl, input.path),
          path: input.path,
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: input.body,
          maxAttempts: 1,
          requestAttempt: retryAttempt + 1
        });
        consecutive429 = 0;
        return response.payload;
      } catch (error) {
        if (!isRateLimitedError(error)) throw error;
        if (retryAttempt >= maxRetries) throw error;
        retryAttempt += 1;
        consecutive429 += 1;
        const retryAfterMs = resolveRetryAfterMs(error, now);
        const delayMs = (options.computeAction1RateLimitDelayMs || computeAction1RateLimitDelayMs)(retryAfterMs, consecutive429);
        logRetryDiagnostic(context, { organizationId: input.organizationId, retryAttempt, consecutive429Count: consecutive429, delayMs, retryAfterMs, retryBudget: maxRetries });
        await sleep(delayMs);
      }
    }
  }

  return {
    listOrganizations,
    listEndpointGroups,
    listManagedEndpoints,
    listEndpointGroupContents,
    listReportData,
    requestAction1Mutation,
    resolveAction1ConsoleOrigin: () => resolveAction1ConsoleOrigin(context)
  };
}

module.exports = {
  DiscoveryRequestError,
  computeAction1RateLimitDelayMs,
  createAction1DiscoveryClient,
  resolveAction1ConsoleOrigin,
  resolveRetryAfterMs,
  sanitizeMessage
};
