const REQUIRED_SETTINGS = [
  'HaloPsaResourceServer',
  'HaloPsaAuthorisationServer',
  'HaloPsaClientId',
  'HaloPsaClientSecret'
];

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

async function requestToken(settings) {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', settings.HaloPsaClientId);
  params.append('client_secret', settings.HaloPsaClientSecret);
  params.append('scope', 'all');

  const response = await fetch(`${settings.HaloPsaAuthorisationServer}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  const { data, contentType, bodyExcerpt } = await readResponseSafe(response);

  if (!response.ok) {
    throw new DiscoveryRequestError('HaloPSA client discovery failed. Check HaloPSA client-read access and retry.', {
      operation: 'discover-halo-clients',
      resolvedResourceServer: resolveResourceServer(settings),
      request: {
        method: 'POST',
        path: '/token',
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
    throw new DiscoveryRequestError('HaloPSA client discovery failed. Check HaloPSA client-read access and retry.', {
      operation: 'discover-halo-clients',
      resolvedResourceServer: resolveResourceServer(settings),
      request: {
        method: 'POST',
        path: '/token',
        query: ''
      },
      response: {
        status: response.status || 200,
        contentType,
        bodyExcerpt,
        errorCode: 'missing_access_token',
        errorMessage: 'HaloPSA token response did not include an access token.'
      }
    });
  }

  return {
    accessToken: data.access_token,
    tokenType: trimValue(data.token_type) || 'Bearer'
  };
}

async function requestReadOnlyJson(settings, accessToken, path) {
  const tokenValue = typeof accessToken === 'string' ? accessToken : accessToken?.accessToken;
  const tokenType = typeof accessToken === 'string' ? 'Bearer' : trimValue(accessToken?.tokenType) || 'Bearer';
  const response = await fetch(`${settings.HaloPsaResourceServer}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `${tokenType} ${tokenValue}`,
      Accept: 'application/json'
    }
  });

  const { data, contentType, bodyExcerpt } = await readResponseSafe(response);
  if (!response.ok) {
    const requestDetails = splitPathAndQuery(path);
    const safeResponse = {
      status: response.status,
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

    throw new DiscoveryRequestError(`HaloPSA read-only API request failed (HTTP ${response.status}).`, {
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

module.exports = {
  REQUIRED_SETTINGS,
  DiscoveryRequestError,
  discoverHaloClients,
  discoverSettingsOptions,
  loadSettings,
  missingRequiredSettings,
  requestReadOnlyJson,
  requestReadOnlyCheck,
  requestToken,
  sanitizeMessage,
  truncateExcerpt,
  trimValue
};
