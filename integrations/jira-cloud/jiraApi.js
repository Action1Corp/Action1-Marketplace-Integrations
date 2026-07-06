const REQUIRED_SETTINGS = [
  'JiraCloudSiteUrl',
  'JiraCloudUserEmail',
  'JiraCloudApiToken'
];
const COMPLETED_STATUS_CATEGORY_KEYS = new Set(['completed', 'done']);

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

function normalizeSiteUrl(value) {
  const trimmed = trimValue(value).replace(/\/+$/, '');
  return trimmed;
}

function sanitizeMessage(message) {
  const text = trimValue(message);
  if (!text) {
    return '';
  }

  return text
    .replace(/authorization["'\s:=]+[^\r\n]+/gi, 'authorization=[redacted]')
    .replace(/basic\s+[a-z0-9+/=]+/gi, 'basic [redacted]')
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/api[_\s-]?token["'\s:=]+[^\s,;]+/gi, 'api_token=[redacted]')
    .replace(/token["'\s:=]+[^\s,;]+/gi, 'token=[redacted]')
    .replace(/password["'\s:=]+[^\s,;]+/gi, 'password=[redacted]')
    .replace(/secret["'\s:=]+[^\s,;]+/gi, 'secret=[redacted]');
}

function sanitizeUrl(value) {
  const text = trimValue(value);
  if (!text) {
    return '';
  }

  try {
    const parsed = new URL(text);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return sanitizeMessage(text);
  }
}

async function readResponseSafe(response) {
  if (!response) {
    return { data: {}, text: '' };
  }

  if (typeof response.text === 'function') {
    try {
      const text = await response.text();
      if (!text) {
        return { data: {}, text: '' };
      }

      try {
        return { data: JSON.parse(text), text };
      } catch {
        return { data: {}, text };
      }
    } catch {
      return { data: {}, text: '' };
    }
  }

  if (typeof response.json === 'function') {
    try {
      const data = await response.json();
      return { data, text: JSON.stringify(data) };
    } catch {
      return { data: {}, text: '' };
    }
  }

  return { data: {}, text: '' };
}

class DiscoveryRequestError extends Error {
  constructor(message, diagnostic = {}) {
    super(message);
    this.name = 'DiscoveryRequestError';
    this.diagnostic = diagnostic;
  }
}

class JiraRequestError extends Error {
  constructor(message, diagnostic = {}) {
    super(message);
    this.name = 'JiraRequestError';
    this.diagnostic = diagnostic;
  }
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

function buildSafeFailureMessage(responsePayload, fallback) {
  return (
    firstSanitizedString(responsePayload, ['error_description', 'errorMessages', 'message', 'error']) ||
    firstSanitizedString(
      Array.isArray(responsePayload?.errorMessages) ? { joined: responsePayload.errorMessages.join('; ') } : {},
      ['joined']
    ) ||
    fallback
  );
}

function truncateExcerpt(value, maxLength = 1000) {
  const sanitized = sanitizeMessage(String(value || '').replace(/\s+/g, ' ').trim());
  if (!sanitized) {
    return '';
  }

  return sanitized.length <= maxLength ? sanitized : `${sanitized.slice(0, maxLength - 3)}...`;
}

function buildSafeResponseSummary(payload) {
  return {
    errorCode: firstSanitizedString(payload, ['error_code', 'errorCode', 'code', 'error']),
    errorMessage:
      firstSanitizedString(payload, ['error_description', 'errorDescription', 'message', 'error_message']) ||
      firstSanitizedString(
        Array.isArray(payload?.errorMessages) ? { joined: payload.errorMessages.join('; ') } : {},
        ['joined']
      )
  };
}

function createBasicAuthHeader(settings) {
  const email = trimValue(settings?.JiraCloudUserEmail);
  const apiToken = trimValue(settings?.JiraCloudApiToken);
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

async function requestReadOnlyJson(settings, path) {
  return requestJson(settings, {
    method: 'GET',
    path
  });
}

async function requestJson(settings, input) {
  const siteUrl = normalizeSiteUrl(settings.JiraCloudSiteUrl);
  const method = String(input?.method || 'GET').toUpperCase();
  const path = String(input?.path || '').trim();
  const response = await fetch(`${siteUrl}${path}`, {
    method,
    headers: {
      Authorization: createBasicAuthHeader(settings),
      Accept: 'application/json',
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' })
    },
    ...(input?.body === undefined ? {} : { body: JSON.stringify(input.body) })
  });

  const { data, text } = await readResponseSafe(response);
  if (response.status === 404 && input?.allowNotFound === true) {
    return null;
  }
  if (!response.ok) {
    const ErrorType = method === 'GET' ? DiscoveryRequestError : JiraRequestError;
    const error = new ErrorType(`Jira API request failed (HTTP ${response.status}).`, {
      request: {
        method,
        path: path.split('?')[0] || '',
        query: path.includes('?') ? path.split('?').slice(1).join('?') : ''
      },
      response: {
        status: response.status,
        contentType: '',
        bodyExcerpt: truncateExcerpt(text),
        ...buildSafeResponseSummary(data)
      }
    });
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function normalizeProject(row) {
  const id = trimValue(String(row?.id || ''));
  const key = trimValue(String(row?.key || ''));
  const name = trimValue(String(row?.name || ''));
  if (!id || !key || !name) {
    return null;
  }

  return { id, key, name };
}

function normalizeIssueType(row) {
  const id = trimValue(String(row?.id || ''));
  const name = trimValue(String(row?.name || ''));
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: trimValue(String(row?.description || '')),
    subtask: Boolean(row?.subtask)
  };
}

function dedupeRows(rows, keyBuilder) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row) continue;
    const key = keyBuilder(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function loadSettings(context, request = {}) {
  const requestSettings = request.settings || {};
  const settings = {};

  for (const key of REQUIRED_SETTINGS) {
    settings[key] = await resolveSetting(context, requestSettings, key);
  }

  settings.JiraCloudSiteUrl = normalizeSiteUrl(settings.JiraCloudSiteUrl);
  return settings;
}

function missingRequiredSettings(settings) {
  return REQUIRED_SETTINGS.filter((key) => !trimValue(settings?.[key]));
}

async function requestMyself(settings) {
  const siteUrl = normalizeSiteUrl(settings.JiraCloudSiteUrl);
  const email = trimValue(settings.JiraCloudUserEmail);
  const apiToken = trimValue(settings.JiraCloudApiToken);

  const response = await fetch(`${siteUrl}/rest/api/3/myself`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
      Accept: 'application/json'
    }
  });

  const { data, text } = await readResponseSafe(response);

  if (!response.ok) {
    const safeReason = buildSafeFailureMessage(data, sanitizeMessage(text) || `Jira API request failed (HTTP ${response.status}).`);
    const error = new Error(safeReason);
    error.statusCode = response.status;
    throw error;
  }

  return {
    accountId: trimValue(data?.accountId),
    displayName: trimValue(data?.displayName),
    emailAddress: trimValue(data?.emailAddress),
    siteUrl: sanitizeUrl(siteUrl)
  };
}

function buildIssueBrowseUrl(settings, issueKey) {
  const siteUrl = normalizeSiteUrl(settings?.JiraCloudSiteUrl);
  const key = trimValue(issueKey);
  if (!siteUrl || !key) {
    return '';
  }

  return `${siteUrl}/browse/${encodeURIComponent(key)}`;
}

function isIssueCompleted(issue = {}) {
  const statusCategoryKey = trimValue(issue?.statusCategoryKey).toLowerCase();
  return COMPLETED_STATUS_CATEGORY_KEYS.has(statusCategoryKey);
}

async function listProjects(settings) {
  try {
    const payload = await requestReadOnlyJson(settings, '/rest/api/3/project/search');
    const rows = Array.isArray(payload?.values)
      ? payload.values
      : Array.isArray(payload?.projects)
      ? payload.projects
      : Array.isArray(payload)
      ? payload
      : [];
    return dedupeRows(rows.map(normalizeProject).filter(Boolean), (row) => `${row.id}|${row.key}`);
  } catch (error) {
    if (!(error instanceof DiscoveryRequestError)) {
      throw error;
    }

    const fallbackPayload = await requestReadOnlyJson(settings, '/rest/api/3/project');
    const rows = Array.isArray(fallbackPayload?.values)
      ? fallbackPayload.values
      : Array.isArray(fallbackPayload?.projects)
      ? fallbackPayload.projects
      : Array.isArray(fallbackPayload)
      ? fallbackPayload
      : [];
    return dedupeRows(rows.map(normalizeProject).filter(Boolean), (row) => `${row.id}|${row.key}`);
  }
}

async function listIssueTypesForProject(settings, projectId) {
  const normalizedProjectId = trimValue(String(projectId || ''));
  if (!normalizedProjectId) {
    throw new DiscoveryRequestError('Jira issue type discovery requires a Jira project.', {
      request: {
        method: 'GET',
        path: '/rest/api/3/issuetype/project',
        query: ''
      },
      response: {
        status: null,
        contentType: '',
        bodyExcerpt: '',
        errorCode: 'missing_project_id',
        errorMessage: 'Jira issue type discovery requires a Jira project.'
      }
    });
  }

  const payload = await requestReadOnlyJson(
    settings,
    `/rest/api/3/issuetype/project?projectId=${encodeURIComponent(normalizedProjectId)}`
  );
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.issueTypes)
    ? payload.issueTypes
    : Array.isArray(payload?.values)
    ? payload.values
    : [];
  return dedupeRows(rows.map(normalizeIssueType).filter(Boolean), (row) => row.id);
}

function normalizeIssueSummary(data, settings) {
  const id = trimValue(data?.id);
  const key = trimValue(data?.key);
  if (!id || !key) {
    return null;
  }

  return {
    id,
    key,
    self: sanitizeUrl(data?.self),
    browseUrl: buildIssueBrowseUrl(settings, key),
    statusName: trimValue(data?.fields?.status?.name),
    statusCategoryKey: trimValue(data?.fields?.status?.statusCategory?.key),
    statusCategoryName: trimValue(data?.fields?.status?.statusCategory?.name),
    completed: false
  };
}

async function createIssue(settings, payload) {
  const data = await requestJson(settings, {
    method: 'POST',
    path: '/rest/api/3/issue',
    body: payload
  });

  const normalized = normalizeIssueSummary(data, settings);
  if (!normalized) {
    const error = new JiraRequestError('Jira create issue response was missing id or key.');
    error.code = 'jira_create_issue_invalid_response';
    throw error;
  }

  return normalized;
}

async function getIssue(settings, issueIdOrKey) {
  const normalizedIssueIdOrKey = trimValue(String(issueIdOrKey || ''));
  if (!normalizedIssueIdOrKey) {
    throw new JiraRequestError('Jira issue id or key is required.');
  }

  const data = await requestJson(settings, {
    method: 'GET',
    path: `/rest/api/3/issue/${encodeURIComponent(normalizedIssueIdOrKey)}?fields=status`,
    allowNotFound: true
  });
  if (!data) {
    return null;
  }

  const normalized = normalizeIssueSummary(data, settings);
  if (!normalized) {
    return null;
  }
  normalized.completed = isIssueCompleted(normalized);
  return normalized;
}

async function updateIssue(settings, issueIdOrKey, payload) {
  const normalizedIssueIdOrKey = trimValue(String(issueIdOrKey || ''));
  if (!normalizedIssueIdOrKey) {
    throw new JiraRequestError('Jira issue id or key is required.');
  }

  await requestJson(settings, {
    method: 'PUT',
    path: `/rest/api/3/issue/${encodeURIComponent(normalizedIssueIdOrKey)}`,
    body: payload
  });

  return { ok: true };
}

module.exports = {
  DiscoveryRequestError,
  JiraRequestError,
  REQUIRED_SETTINGS,
  buildIssueBrowseUrl,
  createIssue,
  getIssue,
  isIssueCompleted,
  loadSettings,
  listIssueTypesForProject,
  listProjects,
  missingRequiredSettings,
  normalizeSiteUrl,
  requestMyself,
  requestReadOnlyJson,
  requestJson,
  sanitizeMessage,
  sanitizeUrl,
  trimValue,
  updateIssue
};
