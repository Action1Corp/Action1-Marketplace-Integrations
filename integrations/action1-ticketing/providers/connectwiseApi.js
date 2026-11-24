'use strict';

const API_PATH = '/v4_6_release/apis/3.0';
const REGIONS = Object.freeze({
  NA: 'https://api-na.myconnectwise.net',
  EU: 'https://api-eu.myconnectwise.net',
  AU: 'https://api-au.myconnectwise.net'
});
const API_VERSION = '2026.11';

function read(connection, field) {
  return connection?.[`TicketingProvider_connectwise_psa_${field}`] ?? connection?.[field] ?? '';
}

function resolveConnectWiseBaseUrl(connection = {}) {
  const region = String(read(connection, 'ApiRegion')).trim().toUpperCase();
  let origin = REGIONS[region];
  if (region === 'CUSTOM') {
    const raw = String(read(connection, 'CustomServer')).trim();
    let url;
    try { url = new URL(raw); } catch { throw new Error('Custom server URL is invalid.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/') || !url.hostname || isLocalHost(url.hostname)) {
      throw new Error('Custom server must be a secure HTTPS server URL without credentials, path, query, or fragment.');
    }
    origin = url.origin;
  }
  if (!origin) throw new Error('Select a supported ConnectWise API region.');
  return `${origin}${API_PATH}`;
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

function validateConnectWiseConnection(connection = {}) {
  const errors = [];
  for (const [field, label] of [['ApiRegion', 'API Region / Server'], ['CompanyId', 'PSA Company ID'], ['PublicApiKey', 'Public API Key'], ['PrivateApiKey', 'Private API Key']]) {
    if (!String(read(connection, field)).trim()) errors.push({ field, message: `${label} is required.` });
  }
  try { resolveConnectWiseBaseUrl(connection); } catch (error) { errors.push({ field: 'CustomServer', message: error.message }); }
  return { ok: errors.length === 0, errors };
}

function createConnectWiseApi({ clientId }) {
  return Object.freeze({
    async request({ transport, connection, method = 'GET', path, query, body, signal } = {}) {
      if (!transport || (typeof transport !== 'function' && typeof transport.request !== 'function')) throw safeError('CONNECTWISE_TRANSPORT_UNAVAILABLE', 'The ConnectWise service could not be reached.');
      const baseUrl = resolveConnectWiseBaseUrl(connection);
      const companyId = String(read(connection, 'CompanyId')).trim();
      const publicKey = String(read(connection, 'PublicApiKey')).trim();
      const privateKey = String(read(connection, 'PrivateApiKey'));
      const url = new URL(`${baseUrl}${normalizePath(path)}`);
      for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      const options = {
        method: String(method).toUpperCase(), url: url.toString(),
        headers: {
          Authorization: `Basic ${Buffer.from(`${companyId}+${publicKey}:${privateKey}`, 'utf8').toString('base64')}`,
          clientId: String(clientId || ''),
          Accept: `application/vnd.connectwise.com+json; version=${API_VERSION}`
        },
        timeoutMs: 15000,
        maxAttempts: String(method).toUpperCase() === 'GET' ? 3 : 1,
        ...(signal ? { signal } : {}),
        ...(body !== undefined ? { data: body } : {})
      };
      try {
        const raw = typeof transport === 'function'
          ? await transport(options)
          : await transport.request(options);
        return normalizeResponse(raw, options.method);
      } catch (error) {
        if (String(error?.code || '').startsWith('CONNECTWISE_')) throw error;
        throw classifyError(normalizeError(error));
      }
    }
  });
}

function normalizePath(path) {
  const value = String(path || '');
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('..')) throw safeError('CONNECTWISE_REQUEST_INVALID', 'The ConnectWise request could not be prepared.');
  return value;
}

function parsePayload(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeResponse(response, method) {
  const raw = response || {};
  const statusCode = Number(raw.statusCode ?? raw.status ?? 200);
  const headers = raw.headers ?? raw.responseHeaders ?? {};
  const data = parsePayload(raw.data ?? raw.payload ?? raw.body ?? raw.json);
  if (statusCode < 200 || statusCode >= 300) throw classifyError({ statusCode, data });
  return { statusCode, headers: headers && typeof headers === 'object' ? headers : {}, data, ...(method === 'HEAD' ? {} : {}) };
}

function normalizeError(error) {
  const response = error?.response || error || {};
  return {
    statusCode: Number(response.statusCode ?? response.status ?? 0),
    headers: response.headers ?? response.responseHeaders ?? {},
    data: parsePayload(response.data ?? response.payload ?? response.body ?? response.json),
    code: String(error?.code || response.code || '')
  };
}

function classifyError(error = {}) {
  const statusCode = Number(error.statusCode || 0);
  const bodyText = typeof error.data === 'string' ? error.data : JSON.stringify(error.data || {});
  if (statusCode === 400 && /invalid\s*token|not.?authenticated|authentication failed|invalid credentials/i.test(bodyText)) {
    return safeError('CONNECTWISE_AUTHENTICATION_FAILED', 'ConnectWise rejected the credentials. Check the PSA Company ID and API keys.', statusCode);
  }
  if (statusCode === 401 || statusCode === 403 || (statusCode === 400 && /unauthorized|not authorized|permission|security/i.test(bodyText))) {
    return safeError('CONNECTWISE_PERMISSION_DENIED', 'ConnectWise denied access. Check the API Member permissions and company eligibility.', statusCode);
  }
  if (statusCode === 404) return safeError('CONNECTWISE_HTTP_ERROR', 'ConnectWise could not find the requested resource.', statusCode);
  if (statusCode === 429) return safeError('CONNECTWISE_RATE_LIMITED', 'ConnectWise is temporarily limiting requests. Try again later.', statusCode);
  if (statusCode >= 500) return safeError('CONNECTWISE_SERVICE_ERROR', 'ConnectWise is temporarily unavailable.', statusCode);
  if (statusCode) return safeError('CONNECTWISE_HTTP_ERROR', 'The ConnectWise request failed.', statusCode);
  return safeError('CONNECTWISE_NETWORK_ERROR', 'The ConnectWise service could not be reached. Check the server address and network connection.');
}

function safeError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, ...(statusCode ? { statusCode } : {}) });
}

module.exports = { API_PATH, API_VERSION, REGIONS, createConnectWiseApi, resolveConnectWiseBaseUrl, validateConnectWiseConnection };
