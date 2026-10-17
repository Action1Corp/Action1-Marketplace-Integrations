function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Action1 baseUrl must be a valid absolute HTTP(S) URL.');
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error('invalid URL');
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('Action1 baseUrl must be a valid absolute HTTP(S) URL.');
  }
}

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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
    .replace(/apiSecret["'\s:=]+[^\s,;]+/gi, 'apiSecret=[redacted]')
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

function firstString(input, keys) {
  for (const key of keys) {
    const value = input?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return sanitizeMessage(String(value));
    }
  }

  return '';
}

function buildSafeResponseSummary(payload) {
  return {
    errorCode: firstString(payload, ['error_code', 'errorCode', 'code', 'error']),
    errorMessage: firstString(payload, ['error_description', 'errorDescription', 'message', 'error_message'])
  };
}

async function requestAction1Token(credentials) {
  const baseUrl = normalizeBaseUrl(credentials?.baseUrl);
  const params = new URLSearchParams();
  params.append('client_id', credentials.apiKey);
  params.append('client_secret', credentials.apiSecret);
  params.append('grant_type', 'client_credentials');

  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  const { data, contentType, bodyExcerpt } = await readResponseSafe(response);

  if (!response.ok) {
    throw new DiscoveryRequestError('Action1 organization discovery failed.', {
      operation: 'discover-action1-organizations',
      request: {
        method: 'POST',
        path: '/oauth2/token',
        query: ''
      },
      response: {
        status: response.status,
        contentType,
        bodyExcerpt,
        ...buildSafeResponseSummary(data)
      }
    });
  }

  if (!trimValue(data.access_token)) {
    throw new DiscoveryRequestError('Action1 organization discovery failed.', {
      operation: 'discover-action1-organizations',
      request: {
        method: 'POST',
        path: '/oauth2/token',
        query: ''
      },
      response: {
        status: response.status || 200,
        contentType,
        bodyExcerpt,
        errorCode: 'missing_access_token',
        errorMessage: 'Action1 token response did not include an access token.'
      }
    });
  }

  return data.access_token;
}

function extractAction1Rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.organizations)) return payload.organizations;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.value)) return payload.value;
  return [];
}

function normalizeAction1Organization(row) {
  const id = trimValue(String(row?.id || row?.org_id || row?.organization_id || ''));
  const name = trimValue(String(row?.name || row?.org_name || row?.organization_name || ''));
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

async function discoverAction1Organizations(accessToken, baseUrl) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/organizations`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const { data, contentType, bodyExcerpt } = await readResponseSafe(response);
  if (!response.ok) {
    throw new DiscoveryRequestError('Action1 organization discovery failed.', {
      operation: 'discover-action1-organizations',
      request: {
        method: 'GET',
        path: '/organizations',
        query: ''
      },
      response: {
        status: response.status,
        contentType,
        bodyExcerpt,
        ...buildSafeResponseSummary(data)
      }
    });
  }

  return dedupeRows(extractAction1Rows(data).map(normalizeAction1Organization).filter(Boolean));
}

async function loadAction1Credentials(context) {
  const credentials = await context?.action1?.getCredentials?.();
  const apiKey = trimValue(credentials?.apiKey);
  const apiSecret = trimValue(credentials?.apiSecret);
  let baseUrl = '';
  try {
    baseUrl = normalizeBaseUrl(credentials?.baseUrl);
  } catch {
    baseUrl = '';
  }

  if (!apiKey || !apiSecret || !baseUrl) {
    throw new DiscoveryRequestError('Action1 organization discovery failed.', {
      operation: 'discover-action1-organizations',
      request: {
        method: 'POST',
        path: '/oauth2/token',
        query: ''
      },
      response: {
        status: null,
        errorCode: !apiKey || !apiSecret ? 'missing_action1_credentials' : 'invalid_action1_base_url',
        errorMessage: !apiKey || !apiSecret
          ? 'Marketplace Action1 credentials are incomplete.'
          : 'Marketplace Action1 baseUrl is invalid.'
      }
    });
  }

  return { apiKey, apiSecret, baseUrl };
}

module.exports = {
  DiscoveryRequestError,
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage,
  trimValue
};
