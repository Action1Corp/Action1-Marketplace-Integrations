const { LOG_EVENT_TYPES, LOG_LEVELS } = require('./runtimeLogging');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 5000;

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'ABORT_ERR',
  'TIMEOUT'
]);

function createSafeHttpClient(opts = {}) {
  const name = String(opts.name || 'http');
  const fetchImpl = opts.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('SafeHttpClient requires fetch implementation');
  }
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : sleepMs;
  const runLogger = opts.runLogger || null;

  return {
    requestJson
  };

  async function requestJson(request) {
    const method = String(request?.method || 'GET').toUpperCase();
    const url = String(request?.url || '');
    if (!url) throw new Error('requestJson requires url');

    const timeoutMs = clampInt(request?.timeoutMs, DEFAULT_TIMEOUT_MS, 1000);
    const maxAttempts = clampInt(request?.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1);
    const retryBaseDelayMs = clampInt(request?.retryBaseDelayMs, DEFAULT_BASE_RETRY_DELAY_MS, 1);
    const retryMaxDelayMs = clampInt(request?.retryMaxDelayMs, DEFAULT_MAX_RETRY_DELAY_MS, retryBaseDelayMs);
    const headers = normalizeRequestHeaders(request?.headers);
    const runId = String(request?.runId || 'system');
    const abortSignal = request?.abortSignal || null;
    const expectedStatusCodes = new Set(
      (Array.isArray(request?.expectedStatusCodes) ? request.expectedStatusCodes : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    let bodyValue = request?.body;
    if (bodyValue !== undefined && bodyValue !== null && typeof bodyValue === 'object' && !(bodyValue instanceof ArrayBuffer)) {
      if (!headerExists(headers, 'content-type')) {
        headers['content-type'] = 'application/json';
      }
      if (String(headers['content-type']).toLowerCase().includes('application/json')) {
        bodyValue = JSON.stringify(bodyValue);
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(abortSignal);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let detachAbortRelay = null;

      if (controller && abortSignal && typeof abortSignal.addEventListener === 'function') {
        const relayAbort = () => controller.abort();
        if (abortSignal.aborted) {
          relayAbort();
        } else {
          abortSignal.addEventListener('abort', relayAbort, { once: true });
          detachAbortRelay = () => abortSignal.removeEventListener('abort', relayAbort);
        }
      }

      const timeoutHandle = setTimeout(() => {
        try {
          controller?.abort?.();
        } catch {}
      }, timeoutMs);

      try {
        await emitHttpTrace(runLogger, {
          runId,
          level: LOG_LEVELS.DEBUG,
          message: `${name} request started`,
          context: { method, url, attempt, maxAttempts, timeoutMs }
        });
        const startedAt = now();
        const response = await fetchImpl(url, {
          method,
          headers,
          body: bodyValue === undefined || bodyValue === null ? undefined : bodyValue,
          signal: controller?.signal
        });
        clearTimeout(timeoutHandle);

        const parsedHeaders = normalizeResponseHeaders(response?.headers);
        const payload = await parseResponsePayload(response);
        const statusCode = Number(response?.status || 0);

        if (!response?.ok) {
          const expectedStatus = expectedStatusCodes.has(statusCode);
          const error = createHttpError({
            name,
            method,
            url,
            statusCode,
            code: statusCode === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
            responsePayload: payload,
            responseHeaders: parsedHeaders,
            retryable: expectedStatus ? false : isTransientStatus(statusCode),
            expectedStatus
          });

          if (!error.retryable || attempt >= maxAttempts) {
            throw error;
          }

          const retryAfterMs = parseRetryAfterMs(parsedHeaders['retry-after'], now());
          const retryDelayMs = Math.min(
            retryAfterMs !== null ? retryAfterMs : computeBackoffDelayMs(attempt, retryBaseDelayMs),
            retryMaxDelayMs
          );
          await emitRetryLog({ runLogger, runId, clientName: name, method, url, attempt, maxAttempts, delayMs: retryDelayMs, statusCode });
          await sleep(retryDelayMs);
          continue;
        }

        await emitHttpTrace(runLogger, {
          runId,
          level: LOG_LEVELS.DEBUG,
          message: `${name} request completed`,
          context: { method, url, attempt, statusCode, durationMs: Math.max(0, now() - startedAt) }
        });
        return {
          statusCode,
          headers: parsedHeaders,
          data: payload
        };
      } catch (rawError) {
        clearTimeout(timeoutHandle);
        const error = normalizeThrownError({ rawError, name, method, url, timeoutMs });
        await emitHttpTrace(runLogger, {
          runId,
          level: error.expectedStatus ? LOG_LEVELS.INFO : error.retryable ? LOG_LEVELS.WARN : LOG_LEVELS.ERROR,
          message: error.expectedStatus ? `${name} request returned expected status` : `${name} request failed`,
          context: {
            method,
            url,
            attempt,
            code: error.code || '',
            statusCode: error.statusCode || null,
            retryable: Boolean(error.retryable),
            detail: error.message
          }
        });
        if (!error.retryable || attempt >= maxAttempts) {
          throw error;
        }

        const retryDelayMs = Math.min(computeBackoffDelayMs(attempt, retryBaseDelayMs), retryMaxDelayMs);
        await emitRetryLog({
          runLogger,
          runId,
          clientName: name,
          method,
          url,
          attempt,
          maxAttempts,
          delayMs: retryDelayMs,
          statusCode: error.statusCode || null,
          code: error.code || null
        });
        await sleep(retryDelayMs);
      } finally {
        if (typeof detachAbortRelay === 'function') detachAbortRelay();
      }
    }

    throw new Error('requestJson exhausted attempts');
  }
}

async function emitRetryLog(input) {
  if (!input.runLogger || typeof input.runLogger.emit !== 'function') return;
  await input.runLogger.emit({
    runId: input.runId,
    level: LOG_LEVELS.WARN,
    eventType: LOG_EVENT_TYPES.RETRY,
    message: `${input.clientName} retry attempt ${input.attempt}/${input.maxAttempts}`,
    context: {
      method: input.method,
      url: input.url,
      delayMs: input.delayMs,
      statusCode: input.statusCode ?? null,
      code: input.code ?? null
    }
  });
}

async function emitHttpTrace(runLogger, input) {
  if (!runLogger || typeof runLogger.emit !== 'function') return;
  await runLogger.emit({
    runId: input.runId,
    level: input.level,
    eventType: LOG_EVENT_TYPES.HTTP_REQUEST,
    message: input.message,
    context: input.context
  });
}

function clampInt(value, fallback, min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function normalizeRequestHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null) continue;
    out[String(key).toLowerCase()] = String(value);
  }
  if (!headerExists(out, 'accept')) {
    out.accept = 'application/json';
  }
  return out;
}

function headerExists(headers, key) {
  return Object.prototype.hasOwnProperty.call(headers || {}, String(key).toLowerCase());
}

function normalizeResponseHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value);
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    out[String(key).toLowerCase()] = String(value);
  }
  return out;
}

async function parseResponsePayload(response) {
  const text = typeof response?.text === 'function' ? await response.text() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function createHttpError({ name, method, url, statusCode, code, responsePayload, responseHeaders, retryable, expectedStatus }) {
  const error = new Error(`${name} HTTP ${statusCode} ${method} ${url}`);
  error.name = 'HttpRequestError';
  error.clientName = name;
  error.method = method;
  error.url = url;
  error.statusCode = statusCode;
  error.code = code;
  error.responsePayload = responsePayload;
  error.responseHeaders = responseHeaders && typeof responseHeaders === 'object' ? responseHeaders : null;
  error.retryable = Boolean(retryable);
  error.expectedStatus = Boolean(expectedStatus);
  return error;
}

function normalizeThrownError({ rawError, name, method, url, timeoutMs }) {
  if (rawError?.name === 'HttpRequestError') return rawError;
  const timeoutLike = isTimeoutLikeError(rawError);
  const networkLike = isNetworkLikeError(rawError);
  const code = timeoutLike ? 'TIMEOUT' : String(rawError?.code || 'REQUEST_FAILED');
  const retryable = timeoutLike || networkLike;
  const error = new Error(
    timeoutLike
      ? `${name} timeout ${method} ${url} after ${timeoutMs}ms`
      : `${name} request failed ${method} ${url}: ${rawError?.message || 'unknown error'}`
  );
  error.name = 'HttpRequestError';
  error.clientName = name;
  error.method = method;
  error.url = url;
  error.code = code;
  error.retryable = retryable;
  error.expectedStatus = false;
  error.cause = rawError;
  return error;
}

function isTransientStatus(statusCode) {
  return TRANSIENT_STATUS_CODES.has(Number(statusCode));
}

function isNetworkLikeError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (TRANSIENT_ERROR_CODES.has(code)) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('fetch failed') || message.includes('network') || message.includes('socket') || message.includes('timed out');
}

function isTimeoutLikeError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'ABORT_ERR' || code === 'TIMEOUT') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('aborted') || message.includes('timeout') || error?.name === 'AbortError';
}

function parseRetryAfterMs(value, nowMs) {
  if (value === undefined || value === null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  const nextTime = Date.parse(String(value));
  if (!Number.isFinite(nextTime)) return null;
  return Math.max(0, nextTime - nowMs);
}

function computeBackoffDelayMs(attempt, baseMs) {
  const cappedAttempt = Math.max(1, Number(attempt || 1));
  const exponential = baseMs * Math.pow(2, cappedAttempt - 1);
  const jitter = Math.floor(Math.random() * Math.max(20, baseMs / 2));
  return exponential + jitter;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(abortSignal) {
  if (!abortSignal || !abortSignal.aborted) return;
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  error.retryable = false;
  throw error;
}

module.exports = {
  DEFAULT_BASE_RETRY_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  createSafeHttpClient,
  parseRetryAfterMs,
  sleepMs
};
