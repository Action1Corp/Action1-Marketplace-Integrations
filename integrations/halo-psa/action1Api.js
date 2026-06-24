const ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';
const { LOG_EVENT_TYPES, emitLog } = require('./runtimeLogging');
const { createSafeHttpClient, sleepMs } = require('./safeHttpClient');
const { normalizeSignalRulesConfig } = require('./signalRulesConfig');
const { filterQualifiedVulnerabilityItems, normalizeRemediationStatus, normalizeUpdateSeverity } = require('./signalQualification');
const { ensureUrl, joinUrl, toAbsoluteUrl } = require('./urlUtils');

const ACTION1_VULNERABILITY_FILTER_COMBINATION_CAP = 8;
const ACTION1_VULNERABILITY_SCORE_VALUES = Object.freeze({
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
});
const ACTION1_VULNERABILITY_REMEDIATION_VALUES = Object.freeze({
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due_soon'
});
const ACTION1_UPDATE_SECURITY_SEVERITY_VALUES = Object.freeze({
  CRITICAL: 'Critical',
  IMPORTANT: 'Important',
  MODERATE: 'Moderate',
  LOW: 'Low',
  UNSPECIFIED: 'Unspecified'
});
const VULNERABILITY_DIAGNOSTIC_SAMPLE_LIMIT = 5;
const UPDATE_DIAGNOSTIC_SAMPLE_LIMIT = 5;

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
  const params = new URLSearchParams();
  params.append('client_id', credentials.apiKey);
  params.append('client_secret', credentials.apiSecret);
  params.append('grant_type', 'client_credentials');

  const response = await fetch(`${ACTION1_BASE_URL}/oauth2/token`, {
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

async function discoverAction1Organizations(accessToken) {
  const response = await fetch(`${ACTION1_BASE_URL}/organizations`, {
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

  if (!apiKey || !apiSecret) {
    throw new DiscoveryRequestError('Action1 organization discovery failed.', {
      operation: 'discover-action1-organizations',
      request: {
        method: 'POST',
        path: '/oauth2/token',
        query: ''
      },
      response: {
        status: null,
        errorCode: 'missing_action1_credentials',
        errorMessage: 'Marketplace Action1 credentials are incomplete.'
      }
    });
  }

  return { apiKey, apiSecret };
}

const TOKEN_REUSE_SAFETY_MARGIN_MS = 60 * 1000;
const ACTION1_RATE_LIMIT_BASE_DELAY_MS = 2000;
const ACTION1_RATE_LIMIT_MAX_DELAY_MS = 60 * 1000;

function createAction1Client(opts = {}) {
  const runLogger = opts.runLogger || null;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const httpClient = opts.httpClient || createSafeHttpClient({ name: 'action1', runLogger, now });
  const action1RateLimitMaxRetries =
    opts.action1RateLimitMaxRetries === undefined || opts.action1RateLimitMaxRetries === null
      ? null
      : Number.isInteger(Number(opts.action1RateLimitMaxRetries))
      ? Math.max(0, Number(opts.action1RateLimitMaxRetries))
      : null;

  let tokenCache = {
    cacheKey: null,
    accessToken: null,
    expiresAtMs: 0
  };

  return {
    collectEndpointSignals,
    getAccessToken,
    listAutomationFailuresByOrg,
    listEndpoints,
    listMissingUpdatesByOrg,
    listOrganizations,
    listVulnerabilityFindingsByOrg
  };

  async function listOrganizations(opts = {}) {
    const connection = await resolveConnection(opts.context, opts.connection);
    return fetchPagedCollection({
      runId: String(opts.runId || 'action1-discovery'),
      firstUrl: joinUrl(connection.baseUrl, '/organizations'),
      pageLimit: Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 200,
      resolveAccessToken: () => getAccessToken(connection, String(opts.runId || 'action1-discovery')),
      resourceName: 'Action1 organizations',
      normalizeItem: normalizeOrganization,
      baseUrl: connection.baseUrl
    });
  }

  async function listEndpoints(orgId, opts = {}) {
    if (!orgId) throw new Error('Action1 listEndpoints requires orgId');
    const connection = await resolveConnection(opts.context, opts.connection);
    return fetchPagedCollection({
      runId: String(opts.runId || 'action1-discovery'),
      firstUrl: joinUrl(connection.baseUrl, `/endpoints/managed/${encodeURIComponent(String(orgId))}?limit=100&from=0&fields=*`),
      pageLimit: Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 200,
      resolveAccessToken: () => getAccessToken(connection, String(opts.runId || 'action1-discovery')),
      resourceName: `Action1 endpoints org=${orgId}`,
      normalizeItem: normalizeEndpoint,
      baseUrl: connection.baseUrl,
      orgId: String(orgId),
      abortSignal: opts.abortSignal || null
    });
  }

  async function listVulnerabilityFindingsByOrg(orgId, opts = {}) {
    if (!orgId) throw new Error('Action1 listVulnerabilityFindingsByOrg requires orgId');
    const connection = await resolveConnection(opts.context, opts.connection);
    const runId = String(opts.runId || 'action1-vulnerabilities');
    const resolveAccessToken = () => getAccessToken(connection, runId);
    const listLimit = Number.isFinite(Number(opts.listLimit)) ? Math.max(1, Math.floor(Number(opts.listLimit))) : 200;
    const endpointLimit = Number.isFinite(Number(opts.endpointLimit)) ? Math.max(1, Math.floor(Number(opts.endpointLimit))) : 200;
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 500;
    const filter = normalizeVulnerabilityCollectionFilter(opts.filter);
    const filterPlan = buildVulnerabilityServerFilterPlan(filter, {
      maxCombinations: opts.maxFilterCombinations
    });
    const strategy = filterPlan.strategy;
    let vulnerabilities = [];
    const serverFilterBreakdown = [];

    if (strategy === 'server-filtered') {
      for (const requestPlan of filterPlan.requests) {
        const fetchMeta = { pagesFetched: 0, rawRowsFetched: 0 };
        const filterRows = await fetchPagedCollection({
          runId,
          firstUrl: buildVulnerabilityTopLevelUrl(connection.baseUrl, orgId, listLimit, requestPlan),
          pageLimit,
          resolveAccessToken,
          resourceName: `Action1 vulnerabilities org=${orgId} score=${requestPlan.score || 'any'} remediation=${requestPlan.remediationStatus || 'any'}`,
          normalizeItem: (item) => item,
          baseUrl: connection.baseUrl,
          orgId: String(orgId),
          abortSignal: opts.abortSignal || null,
          meta: fetchMeta
        });
        vulnerabilities = vulnerabilities.concat(filterRows);
        serverFilterBreakdown.push(buildVulnerabilityFilterBreakdown(requestPlan, filterRows, fetchMeta, {
          sampleLimit: VULNERABILITY_DIAGNOSTIC_SAMPLE_LIMIT
        }));
      }
    } else {
      vulnerabilities = await fetchPagedCollection({
        runId,
        firstUrl: buildVulnerabilityTopLevelUrl(connection.baseUrl, orgId, listLimit),
        pageLimit,
        resolveAccessToken,
        resourceName: `Action1 vulnerabilities org=${orgId}`,
        normalizeItem: (item) => item,
        baseUrl: connection.baseUrl,
        orgId: String(orgId),
        abortSignal: opts.abortSignal || null
      });
    }

    const fetchedSummary = summarizeVulnerabilityTopLevelRows(vulnerabilities, {
      sampleLimit: VULNERABILITY_DIAGNOSTIC_SAMPLE_LIMIT
    });
    const dedupedVulnerabilities = dedupeVulnerabilityRowsByCve(vulnerabilities);
    const qualifiedVulnerabilities = filterQualifiedVulnerabilityItems(dedupedVulnerabilities, filter);
    const topLevelRowsFetched = vulnerabilities.length;
    const topLevelRowsDeduped = dedupedVulnerabilities.length;
    const topLevelUniqueCvesAfterDedupe = dedupedVulnerabilities.length;
    const topLevelRowsWithoutCanonicalCve = fetchedSummary.rowsMissingCanonicalCve;
    const rowsAfterLocalQualification = qualifiedVulnerabilities.length;
    const crossFilterDiagnostics = buildCrossFilterDuplicateDiagnostics(serverFilterBreakdown, {
      sampleLimit: VULNERABILITY_DIAGNOSTIC_SAMPLE_LIMIT
    });
    let deepEndpointFetchesCompleted = 0;

    await emitLog({
      runLogger,
      runId,
      level: 'DEBUG',
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: 'Action1 vulnerability collection planned.',
      context: {
        orgId: String(orgId),
        vulnerabilityFilterStrategy: strategy,
        serverFilterRequestsPlanned: filterPlan.requests.length,
        topLevelRowsFetched,
        topLevelRowsDeduped,
        topLevelUniqueCvesAfterDedupe,
        topLevelRowsWithoutCanonicalCve,
        rowsAfterLocalQualification,
        rowsSkippedBeforeDeepFetch: Math.max(0, topLevelRowsDeduped - rowsAfterLocalQualification),
        deepEndpointFetchesPlanned: rowsAfterLocalQualification,
        deepEndpointFetchesCompleted,
        serverFilterBreakdown: toPublicVulnerabilityFilterBreakdown(serverFilterBreakdown),
        crossFilterDuplicateCves: crossFilterDiagnostics.crossFilterDuplicateCves,
        crossFilterDuplicatePairs: crossFilterDiagnostics.crossFilterDuplicatePairs
      }
    });

    const out = [];
    for (const vuln of qualifiedVulnerabilities) {
      const cveId = String(vuln?.cve_id || vuln?.id || '').trim();
      if (!cveId) continue;
      const endpointRows = await fetchPagedCollection({
        runId,
        firstUrl: joinUrl(connection.baseUrl, `/vulnerabilities/${encodeURIComponent(String(orgId))}/${encodeURIComponent(cveId)}/endpoints?limit=${endpointLimit}&from=0`),
        pageLimit,
        resolveAccessToken,
        resourceName: `Action1 vulnerability endpoints org=${orgId} cve=${cveId}`,
        normalizeItem: (item) => item,
        baseUrl: connection.baseUrl,
        orgId: String(orgId),
        abortSignal: opts.abortSignal || null
      });
      deepEndpointFetchesCompleted += 1;

      for (const endpointRow of endpointRows) {
        const endpointId = String(endpointRow?.id || endpointRow?.endpoint_id || '').trim();
        if (!endpointId) continue;
        out.push({
          endpointId,
          cve_id: cveId,
          severity: vuln?.severity !== undefined ? vuln.severity : undefined,
          security_severity: vuln?.security_severity !== undefined ? vuln.security_severity : undefined,
          cvss_score: vuln?.cvss_score !== undefined ? vuln.cvss_score : vuln?.cvssScore,
          published_date: vuln?.published_date ?? vuln?.publishedDate ?? vuln?.published,
          remediation_deadline: vuln?.remediation_deadline ?? vuln?.remediationDeadline ?? vuln?.deadline,
          remediation_status: vuln?.remediation_status ?? vuln?.remediationStatus ?? vuln?.slaStatus,
          remediationStatus: vuln?.remediationStatus,
          slaStatus: vuln?.slaStatus,
          cisa_kev: vuln?.cisa_kev !== undefined ? vuln.cisa_kev : vuln?.cisaKev,
          software: Array.isArray(vuln?.software) ? vuln.software : []
        });
      }
    }

    await emitLog({
      runLogger,
      runId,
      level: 'DEBUG',
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: 'Action1 vulnerability collection completed.',
      context: {
        orgId: String(orgId),
        vulnerabilityFilterStrategy: strategy,
        serverFilterRequestsPlanned: filterPlan.requests.length,
        topLevelRowsFetched,
        topLevelRowsDeduped,
        topLevelUniqueCvesAfterDedupe,
        topLevelRowsWithoutCanonicalCve,
        rowsAfterLocalQualification,
        rowsSkippedBeforeDeepFetch: Math.max(0, topLevelRowsDeduped - rowsAfterLocalQualification),
        deepEndpointFetchesPlanned: rowsAfterLocalQualification,
        deepEndpointFetchesCompleted,
        serverFilterBreakdown: toPublicVulnerabilityFilterBreakdown(serverFilterBreakdown),
        crossFilterDuplicateCves: crossFilterDiagnostics.crossFilterDuplicateCves,
        crossFilterDuplicatePairs: crossFilterDiagnostics.crossFilterDuplicatePairs
      }
    });

    return out;
  }

  async function listMissingUpdatesByOrg(orgId, opts = {}) {
    if (!orgId) throw new Error('Action1 listMissingUpdatesByOrg requires orgId');
    const connection = await resolveConnection(opts.context, opts.connection);
    const runId = String(opts.runId || 'action1-updates');
    const resolveAccessToken = () => getAccessToken(connection, runId);
    const listLimit = Number.isFinite(Number(opts.listLimit)) ? Math.max(1, Math.floor(Number(opts.listLimit))) : 50;
    const endpointLimit = Number.isFinite(Number(opts.endpointLimit)) ? Math.max(1, Math.floor(Number(opts.endpointLimit))) : 200;
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 500;
    const filter = normalizeUpdateCollectionFilter(opts.filter);
    const filterPlan = buildUpdateServerFilterPlan(filter);
    const strategy = filterPlan.strategy;
    let updates = [];
    const serverFilterBreakdown = [];

    if (strategy === 'server-filtered') {
      for (const requestPlan of filterPlan.requests) {
        const fetchMeta = { pagesFetched: 0, rawRowsFetched: 0 };
        const filterRows = await fetchPagedCollection({
          runId,
          firstUrl: buildUpdateTopLevelUrl(connection.baseUrl, orgId, listLimit, requestPlan),
          pageLimit,
          resolveAccessToken,
          resourceName: `Action1 updates org=${orgId} severity=${requestPlan.securitySeverity || 'any'}`,
          normalizeItem: (item) => item,
          baseUrl: connection.baseUrl,
          orgId: String(orgId),
          abortSignal: opts.abortSignal || null,
          meta: fetchMeta
        });
        updates = updates.concat(filterRows);
        serverFilterBreakdown.push(buildUpdateFilterBreakdown(requestPlan, filterRows, fetchMeta, {
          sampleLimit: UPDATE_DIAGNOSTIC_SAMPLE_LIMIT
        }));
      }
    } else {
      updates = await fetchPagedCollection({
        runId,
        firstUrl: buildUpdateTopLevelUrl(connection.baseUrl, orgId, listLimit),
        pageLimit,
        resolveAccessToken,
        resourceName: `Action1 updates org=${orgId}`,
        normalizeItem: (item) => item,
        baseUrl: connection.baseUrl,
        orgId: String(orgId),
        abortSignal: opts.abortSignal || null
      });
    }

    const topLevelRowsFetched = updates.length;
    const extractedVersionDescriptors = [];
    for (const updateItem of updates) {
      extractedVersionDescriptors.push(...extractUpdateVersionDescriptors(updateItem));
    }
    const topLevelUniquePackageVersionKeysAfterDedupe = dedupeUpdateVersionDescriptors(extractedVersionDescriptors);
    const rowsAfterLocalQualification = filterQualifiedUpdateVersionDescriptors(topLevelUniquePackageVersionKeysAfterDedupe, filter);
    const topLevelRowsWithoutPackageVersionKey = summarizeUpdateTopLevelRows(updates, {
      sampleLimit: UPDATE_DIAGNOSTIC_SAMPLE_LIMIT
    }).rowsMissingPackageVersionKey;
    const updateCrossFilterDiagnostics = buildUpdateCrossFilterDuplicateDiagnostics(serverFilterBreakdown, {
      sampleLimit: UPDATE_DIAGNOSTIC_SAMPLE_LIMIT
    });
    let deepEndpointFetchesCompleted = 0;

    await emitLog({
      runLogger,
      runId,
      level: 'DEBUG',
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: 'Action1 update collection planned.',
      context: {
        orgId: String(orgId),
        updateFilterStrategy: strategy,
        updateServerFilterRequestsPlanned: filterPlan.requests.length,
        updateTopLevelRowsFetched: topLevelRowsFetched,
        updateTopLevelUniquePackageVersionKeysAfterDedupe: topLevelUniquePackageVersionKeysAfterDedupe.length,
        updateTopLevelRowsWithoutPackageVersionKey: topLevelRowsWithoutPackageVersionKey,
        updateRowsAfterLocalQualification: rowsAfterLocalQualification.length,
        updateRowsSkippedBeforeDeepFetch: Math.max(0, topLevelUniquePackageVersionKeysAfterDedupe.length - rowsAfterLocalQualification.length),
        updateDeepEndpointFetchesPlanned: rowsAfterLocalQualification.length,
        updateDeepEndpointFetchesCompleted: deepEndpointFetchesCompleted,
        updateServerFilterBreakdown: toPublicUpdateFilterBreakdown(serverFilterBreakdown),
        updateCrossFilterDuplicateKeys: updateCrossFilterDiagnostics.crossFilterDuplicateKeys,
        updateCrossFilterDuplicatePairs: updateCrossFilterDiagnostics.crossFilterDuplicatePairs
      }
    });

    const out = [];
    for (const version of rowsAfterLocalQualification) {
      const endpointRows = await fetchPagedCollection({
        runId,
        firstUrl: joinUrl(connection.baseUrl, `/updates/${encodeURIComponent(String(orgId))}/${encodeURIComponent(version.packageId)}/versions/${encodeURIComponent(version.versionId)}/endpoints?limit=${endpointLimit}&from=0`),
        pageLimit,
        resolveAccessToken,
        resourceName: `Action1 update endpoints org=${orgId} package=${version.packageId} version=${version.versionId}`,
        normalizeItem: (item) => item,
        baseUrl: connection.baseUrl,
        orgId: String(orgId),
        abortSignal: opts.abortSignal || null
      });
      deepEndpointFetchesCompleted += 1;
      for (const endpointRow of endpointRows) {
        const endpointId = String(endpointRow?.id || endpointRow?.endpoint_id || '').trim();
        if (!endpointId) continue;
        out.push({
          endpointId,
          packageId: version.packageId,
          versionId: version.versionId,
          id: `${version.packageId}:${version.versionId}`,
          security_severity: version.securitySeverity,
          severity: version.severity,
          update_sla_status: version.updateSlaStatus,
          update_sla_deadline: version.updateSlaDeadline,
          security_CVE: version.securityCve,
          package_name: version.packageName,
          version_name: version.versionName,
          vendor: version.vendor,
          update_type: version.updateType,
          classification: version.classification,
          slaStatus: version.slaStatus,
          remediation_status: version.remediationStatus,
          remediationStatus: version.remediationStatus
        });
      }
    }

    await emitLog({
      runLogger,
      runId,
      level: 'DEBUG',
      eventType: LOG_EVENT_TYPES.DISCOVERY_FETCH,
      message: 'Action1 update collection completed.',
      context: {
        orgId: String(orgId),
        updateFilterStrategy: strategy,
        updateServerFilterRequestsPlanned: filterPlan.requests.length,
        updateTopLevelRowsFetched: topLevelRowsFetched,
        updateTopLevelUniquePackageVersionKeysAfterDedupe: topLevelUniquePackageVersionKeysAfterDedupe.length,
        updateTopLevelRowsWithoutPackageVersionKey: topLevelRowsWithoutPackageVersionKey,
        updateRowsAfterLocalQualification: rowsAfterLocalQualification.length,
        updateRowsSkippedBeforeDeepFetch: Math.max(0, topLevelUniquePackageVersionKeysAfterDedupe.length - rowsAfterLocalQualification.length),
        updateDeepEndpointFetchesPlanned: rowsAfterLocalQualification.length,
        updateDeepEndpointFetchesCompleted: deepEndpointFetchesCompleted,
        updateServerFilterBreakdown: toPublicUpdateFilterBreakdown(serverFilterBreakdown),
        updateCrossFilterDuplicateKeys: updateCrossFilterDiagnostics.crossFilterDuplicateKeys,
        updateCrossFilterDuplicatePairs: updateCrossFilterDiagnostics.crossFilterDuplicatePairs
      }
    });

    return out;
  }

  async function listAutomationFailuresByOrg(orgId, opts = {}) {
    if (!orgId) throw new Error('Action1 listAutomationFailuresByOrg requires orgId');
    const connection = await resolveConnection(opts.context, opts.connection);
    const runId = String(opts.runId || 'action1-automation-failed');
    const resolveAccessToken = () => getAccessToken(connection, runId);
    const instanceLimit = Number.isFinite(Number(opts.instanceLimit)) ? Math.max(1, Math.floor(Number(opts.instanceLimit))) : 50;
    const endpointLimit = Number.isFinite(Number(opts.endpointLimit)) ? Math.max(1, Math.floor(Number(opts.endpointLimit))) : 50;
    const pageLimit = Number.isFinite(Number(opts.pageLimit)) ? Math.max(1, Math.floor(Number(opts.pageLimit))) : 500;
    const cutoffEndTime = asTrimmedString(opts.cutoffEndTime);
    const watermarkEndTime = asTrimmedString(opts.watermarkEndTime);
    const meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : null;

    if (meta) {
      meta.instancesSeen = 0;
      meta.instancesSkippedOld = 0;
      meta.instancesQualified = 0;
      meta.instancesFailed = 0;
      meta.maxSeenEndTime = '';
      meta.lastInstanceId = '';
    }

    const instances = await fetchPagedCollection({
      runId,
      firstUrl: joinUrl(connection.baseUrl, `/automations/instances/${encodeURIComponent(String(orgId))}?status=${encodeURIComponent('Warning')}&completed=${encodeURIComponent('yes')}&sortby=${encodeURIComponent('-end_time')}&limit=${instanceLimit}&from=0`),
      pageLimit,
      resolveAccessToken,
      resourceName: `Action1 automation instances org=${orgId}`,
      normalizeItem: (item) => item,
      baseUrl: connection.baseUrl,
      orgId: String(orgId),
      abortSignal: opts.abortSignal || null
    });

    const out = [];
    for (const instance of instances) {
      const instanceEndTime = asTrimmedString(instance?.end_time || instance?.completed_at || instance?.updated_at || instance?.created_at);
      if (meta) meta.instancesSeen += 1;
      if (instanceEndTime) {
        if (meta && (!meta.maxSeenEndTime || instanceEndTime > meta.maxSeenEndTime)) {
          meta.maxSeenEndTime = instanceEndTime;
          meta.lastInstanceId = asTrimmedString(instance?.id);
        }
        if (cutoffEndTime && instanceEndTime < cutoffEndTime) {
          if (meta) meta.instancesSkippedOld += 1;
          break;
        }
        if (watermarkEndTime && instanceEndTime <= watermarkEndTime) {
          if (meta) meta.instancesSkippedOld += 1;
          break;
        }
      }
      const instanceId = asTrimmedString(instance?.id);
      if (!instanceId) continue;

      let endpointResults = [];
      try {
        endpointResults = await fetchPagedCollection({
          runId,
          firstUrl: joinUrl(connection.baseUrl, `/automations/instances/${encodeURIComponent(String(orgId))}/${encodeURIComponent(instanceId)}/endpoint-results?last_status=${encodeURIComponent('Error')}&limit=${endpointLimit}&from=0`),
          pageLimit,
          resolveAccessToken,
          resourceName: `Action1 automation endpoint-results org=${orgId} instance=${instanceId}`,
          normalizeItem: (item) => item,
          baseUrl: connection.baseUrl,
          orgId: String(orgId),
          abortSignal: opts.abortSignal || null
        });
      } catch (error) {
        if (meta) meta.instancesFailed += 1;
        throw error;
      }

      for (const row of endpointResults) {
        const endpointId = asTrimmedString(row?.id || row?.endpoint_id || row?.endpointId);
        if (!endpointId) continue;
        const status = asTrimmedString(row?.status || row?.last_status || row?.lastStatus || 'ERROR');
        out.push({
          endpointId,
          endpoint_id: endpointId,
          id: endpointId,
          instanceId,
          instanceName: asTrimmedString(instance?.name),
          instanceStartTime: asTrimmedString(instance?.start_time || instance?.started_at || instance?.created_at),
          instanceEndTime: asTrimmedString(instance?.end_time),
          status,
          last_status: status,
          failed: status.toUpperCase() === 'ERROR' || status.toUpperCase() === 'FAILED',
          severity: 'UNSPECIFIED',
          description: asTrimmedString(row?.description),
          action_name: asTrimmedString(row?.action_name),
          percent_completed: row?.percent_completed
        });
      }
      if (meta) meta.instancesQualified += 1;
    }
    return out;
  }

  async function collectEndpointSignals(orgId, endpointId, opts = {}) {
    if (!orgId) throw new Error('Action1 collectEndpointSignals requires orgId');
    if (!endpointId) throw new Error('Action1 collectEndpointSignals requires endpointId');
    return {
      orgId: String(orgId),
      endpointId: String(endpointId),
      endpoint: null,
      signals: { vulnerabilities: [], updates: [], automationFailed: [] },
      supportedSignals: ['OFFLINE', 'REBOOT_REQUIRED', 'AUTOMATION_FAILED', 'VULNERABILITY', 'UPDATE'],
      collectedAt: new Date().toISOString(),
      detail: 'Signal collection is implemented through per-organization collectors in Marketplace sync.'
    };
  }

  async function fetchPagedCollection(input) {
    const rows = [];
    const seen = new Set();
    let nextUrl = input.firstUrl;
    let page = 0;

    while (nextUrl) {
      page += 1;
      if (page > input.pageLimit) throw new Error(`${input.resourceName} paging exceeded limit ${input.pageLimit}`);
      const absolute = toAbsoluteUrl(input.baseUrl, nextUrl);
      if (seen.has(absolute)) throw new Error(`${input.resourceName} paging loop detected`);
      seen.add(absolute);
      if (input.meta && typeof input.meta === 'object') {
        input.meta.pagesFetched = Number(input.meta.pagesFetched || 0) + 1;
      }

      const response = await requestAction1GetWithRateLimitRetry({
        runId: input.runId,
        url: absolute,
        resolveAccessToken: input.resolveAccessToken,
        orgId: input.orgId || '',
        abortSignal: input.abortSignal || null
      });

      const payload = response.data && typeof response.data === 'object' ? response.data : {};
      const pageItems = Array.isArray(payload.items) ? payload.items : [];
      if (input.meta && typeof input.meta === 'object') {
        input.meta.rawRowsFetched = Number(input.meta.rawRowsFetched || 0) + pageItems.length;
      }
      for (const item of pageItems) rows.push(input.normalizeItem(item));

      nextUrl =
        payload.next_page ||
        payload.nextPage ||
        payload.next ||
        payload.nextLink ||
        buildOffsetNextPage({
          baseUrl: input.baseUrl,
          currentPath: absolute,
          totalItems: payload.total_items,
          from: payload.from,
          pageItemCount: pageItems.length
        });
    }

    return rows;
  }

  async function requestAction1GetWithRateLimitRetry(input) {
    const maxRetries = action1RateLimitMaxRetries;
    let retryAttempt = 0;
    let consecutive429 = 0;

    while (true) {
      try {
        const accessToken = await input.resolveAccessToken();
        const response = await httpClient.requestJson({
          method: 'GET',
          url: input.url,
          headers: { Authorization: `Bearer ${accessToken}` },
          runId: input.runId,
          abortSignal: input.abortSignal || null,
          maxAttempts: 1
        });
        consecutive429 = 0;
        return response;
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        const isRateLimited = statusCode === 429 || String(error?.code || '').toUpperCase() === 'RATE_LIMITED';
        const retriesExceeded = Number.isFinite(maxRetries) && retryAttempt >= maxRetries;
        if (!isRateLimited || retriesExceeded) throw error;
        retryAttempt += 1;
        consecutive429 += 1;
        const retryAfterMs = resolveRetryAfterMs(error);
        const delayMs = computeAction1RateLimitDelayMs(retryAfterMs, consecutive429);
        await emitLog({
          runLogger,
          runId: input.runId,
          level: 'WARN',
          eventType: LOG_EVENT_TYPES.RETRY,
          message: '[Action1][rate-limit] 429',
          context: { org: String(input.orgId || ''), retryAttempt, consecutive429Count: consecutive429, delayMs, retryAfterMs: retryAfterMs ?? null }
        });
        await sleepMs(delayMs, input.abortSignal || null);
      }
    }
  }

  async function getAccessToken(connectionInput, runId = 'action1-auth') {
    const connection = await resolveConnection(null, connectionInput);
    const cacheKey = `${connection.baseUrl}|${connection.clientId}|${connection.clientSecret}`;
    const current = now();
    if (tokenCache.cacheKey === cacheKey && tokenCache.accessToken && current < tokenCache.expiresAtMs - TOKEN_REUSE_SAFETY_MARGIN_MS) {
      return tokenCache.accessToken;
    }

    const response = await httpClient.requestJson({
      method: 'POST',
      url: joinUrl(connection.baseUrl, '/oauth2/token'),
      body: {
        grant_type: 'client_credentials',
        client_id: connection.clientId,
        client_secret: connection.clientSecret
      },
      runId
    });

    const payload = response.data && typeof response.data === 'object' ? response.data : {};
    const accessToken = payload.access_token ? String(payload.access_token) : '';
    if (!accessToken) throw new Error('Action1 token response did not include access_token');
    const expiresInMs = Number.isFinite(Number(payload.expires_in)) && Number(payload.expires_in) > 0 ? Math.floor(Number(payload.expires_in) * 1000) : 3600000;
    tokenCache = { cacheKey, accessToken, expiresAtMs: now() + expiresInMs };
    return accessToken;
  }

  async function resolveConnection(context, connectionInput) {
    const raw = connectionInput || (context ? await buildConnectionFromContext(context) : null);
    if (!raw || typeof raw !== 'object') throw new Error('Action1 connection is not configured');
    const baseUrl = ensureUrl(raw.baseUrl || ACTION1_BASE_URL, 'Action1 baseUrl');
    const clientId = String(raw.clientId || '').trim();
    const clientSecret = String(raw.clientSecret || '').trim();
    if (!clientId) throw new Error('Action1 clientId is required');
    if (!clientSecret) throw new Error('Action1 clientSecret is required');
    return { baseUrl, clientId, clientSecret };
  }

  async function buildConnectionFromContext(context) {
    const credentials = await loadAction1Credentials(context);
    return {
      baseUrl: ACTION1_BASE_URL,
      clientId: credentials.apiKey,
      clientSecret: credentials.apiSecret
    };
  }
}

function normalizeOrganization(item) {
  return {
    id: String(item?.id || item?.org_id || ''),
    name: String(item?.name || item?.org_name || '')
  };
}

function normalizeEndpoint(item) {
  const rebootRaw = item?.rebootRequired !== undefined ? item.rebootRequired : item?.reboot_required !== undefined ? item.reboot_required : item?.reboot;
  return {
    id: String(item?.id || item?.endpoint_id || ''),
    name: String(item?.name || item?.endpoint_name || ''),
    lastSeenAt: item?.last_seen ? String(item.last_seen) : undefined,
    rebootRequired: toOptionalBoolean(rebootRaw)
  };
}

function toOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return undefined;
  return normalized === 'TRUE' || normalized === 'YES' || normalized === 'Y' || normalized === '1';
}

function buildOffsetNextPage({ baseUrl, currentPath, totalItems, from, pageItemCount }) {
  const total = Number(totalItems);
  const currentFrom = Number(from);
  const currentCount = Number(pageItemCount);
  if (!Number.isFinite(total) || !Number.isFinite(currentFrom) || !Number.isFinite(currentCount) || currentCount <= 0) return null;
  const nextFrom = currentFrom + currentCount;
  if (nextFrom >= total || nextFrom <= currentFrom) return null;
  const url = new URL(currentPath || baseUrl);
  url.searchParams.set('from', String(nextFrom));
  const currentLimitRaw = Number(url.searchParams.get('limit'));
  if (Number.isFinite(currentLimitRaw) && currentLimitRaw > 0) url.searchParams.set('limit', String(Math.floor(currentLimitRaw)));
  return url.toString();
}

function computeAction1RateLimitDelayMs(retryAfterMs, consecutive429Count) {
  const normalizedCount = Number.isFinite(Number(consecutive429Count)) ? Math.max(1, Math.floor(Number(consecutive429Count))) : 1;
  const calculatedBackoffMs = Math.min(ACTION1_RATE_LIMIT_MAX_DELAY_MS, ACTION1_RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, normalizedCount - 1));
  return Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.max(Math.floor(calculatedBackoffMs), Math.floor(retryAfterMs)) : Math.floor(calculatedBackoffMs);
}

function resolveRetryAfterMs(error) {
  if (Number.isFinite(Number(error?.retryAfterMs)) && Number(error.retryAfterMs) >= 0) return Math.floor(Number(error.retryAfterMs));
  return parseRetryAfterMs(error?.responseHeaders?.['retry-after']);
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) return Math.floor(numericSeconds * 1000);
  const absoluteEpochMs = Date.parse(String(value));
  return Number.isFinite(absoluteEpochMs) ? Math.max(0, absoluteEpochMs - Date.now()) : null;
}

function extractUpdateVersionDescriptors(updateItem) {
  const rows = [];
  const packageIdDirect = asTrimmedString(updateItem?.packageId || updateItem?.package_id || updateItem?.package?.id || updateItem?.id);
  const versionIdDirect = asTrimmedString(updateItem?.versionId || updateItem?.version_id || updateItem?.version?.id);
  if (packageIdDirect && versionIdDirect) rows.push(buildUpdateVersionDescriptor(packageIdDirect, versionIdDirect, updateItem));
  const versions = Array.isArray(updateItem?.versions) ? updateItem.versions : [];
  for (const versionRow of versions) {
    const packageId = packageIdDirect || asTrimmedString(updateItem?.id || updateItem?.package?.id || versionRow?.packageId);
    const versionId = asTrimmedString(versionRow?.versionId || versionRow?.version_id || versionRow?.id);
    if (!packageId || !versionId) continue;
    rows.push(buildUpdateVersionDescriptor(packageId, versionId, { ...updateItem, ...versionRow }));
  }
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.packageId}|${row.versionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function buildUpdateVersionDescriptor(packageId, versionId, source) {
  return {
    packageId,
    versionId,
    securitySeverity: asTrimmedString(source?.security_severity || source?.securitySeverity || source?.severity || source?.severityBucket),
    severity: asTrimmedString(source?.severity || source?.security_severity || source?.severityBucket),
    updateSlaStatus: asTrimmedString(source?.update_sla_status || source?.updateSlaStatus || source?.slaStatus || source?.remediation_status || source?.remediationStatus),
    updateSlaDeadline: asTrimmedString(source?.update_sla_deadline || source?.updateSlaDeadline || source?.slaDeadline),
    securityCve: asTrimmedString(source?.security_CVE || source?.securityCVE || source?.cves),
    packageName: asTrimmedString(source?.package_name || source?.packageName || source?.name || source?.title),
    versionName: asTrimmedString(source?.version_name || source?.version || source?.displayVersion),
    vendor: asTrimmedString(source?.vendor || source?.publisher),
    updateType: asTrimmedString(source?.update_type || source?.updateType),
    classification: asTrimmedString(source?.classification || source?.category),
    slaStatus: asTrimmedString(source?.slaStatus || source?.update_sla_status || source?.remediation_status),
    remediationStatus: asTrimmedString(source?.remediation_status || source?.remediationStatus || source?.slaStatus || source?.update_sla_status)
  };
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

function normalizeVulnerabilityCollectionFilter(filter) {
  return normalizeSignalRulesConfig({
    signalFilters: {
      vulnerability: filter && typeof filter === 'object' ? filter : {}
    }
  }).signalFilters.vulnerability;
}

function buildVulnerabilityFilterBreakdown(requestPlan, rows, fetchMeta = {}, opts = {}) {
  const summary = summarizeVulnerabilityTopLevelRows(rows, opts);
  const rawRowsFetched = Number.isFinite(Number(fetchMeta.rawRowsFetched))
    ? Number(fetchMeta.rawRowsFetched)
    : Array.isArray(rows)
    ? rows.length
    : 0;
  return {
    score: String(requestPlan?.score || ''),
    remediation_status: String(requestPlan?.remediationStatus || ''),
    pagesFetched: Number(fetchMeta.pagesFetched || 0),
    rawRowsFetched,
    uniqueCves: summary.uniqueCves,
    duplicateCvesWithinFilter: summary.duplicateCvesWithinFilter,
    rowsMissingCanonicalCve: summary.rowsMissingCanonicalCve,
    sampleCves: summary.sampleCves,
    cveSet: summary.cveSet
  };
}

function summarizeVulnerabilityTopLevelRows(rows, opts = {}) {
  const sampleLimit = Number.isFinite(Number(opts.sampleLimit)) ? Math.max(1, Math.floor(Number(opts.sampleLimit))) : VULNERABILITY_DIAGNOSTIC_SAMPLE_LIMIT;
  const cveSet = new Set();
  const sampleCves = [];
  let rowsMissingCanonicalCve = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const cveId = canonicalVulnerabilityCveId(row);
    if (!cveId) {
      rowsMissingCanonicalCve += 1;
      continue;
    }
    if (!cveSet.has(cveId) && sampleCves.length < sampleLimit) {
      sampleCves.push(cveId);
    }
    cveSet.add(cveId);
  }
  const rawRowsFetched = Array.isArray(rows) ? rows.length : 0;
  return {
    rawRowsFetched,
    uniqueCves: cveSet.size,
    duplicateCvesWithinFilter: Math.max(0, rawRowsFetched - rowsMissingCanonicalCve - cveSet.size),
    rowsMissingCanonicalCve,
    sampleCves,
    cveSet
  };
}

function normalizeUpdateCollectionFilter(filter) {
  return normalizeSignalRulesConfig({
    signalFilters: {
      update: filter && typeof filter === 'object' ? filter : {}
    }
  }).signalFilters.update;
}

function summarizeUpdateTopLevelRows(rows, opts = {}) {
  const sampleLimit = Number.isFinite(Number(opts.sampleLimit)) ? Math.max(1, Math.floor(Number(opts.sampleLimit))) : UPDATE_DIAGNOSTIC_SAMPLE_LIMIT;
  const keySet = new Set();
  const sampleUpdateKeys = [];
  let extractedDescriptorCount = 0;
  let rowsMissingPackageVersionKey = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const descriptors = extractUpdateVersionDescriptors(row);
    if (descriptors.length === 0) {
      rowsMissingPackageVersionKey += 1;
      continue;
    }
    extractedDescriptorCount += descriptors.length;
    for (const descriptor of descriptors) {
      const key = canonicalUpdatePackageVersionKey(descriptor);
      if (!key || keySet.has(key)) continue;
      keySet.add(key);
      if (sampleUpdateKeys.length < sampleLimit) sampleUpdateKeys.push(key);
    }
  }

  return {
    uniquePackageVersionKeys: keySet.size,
    duplicatePackageVersionKeysWithinFilter: Math.max(0, extractedDescriptorCount - keySet.size),
    rowsMissingPackageVersionKey,
    sampleUpdateKeys,
    updateKeySet: keySet
  };
}

function buildUpdateFilterBreakdown(requestPlan, rows, fetchMeta = {}, opts = {}) {
  const summary = summarizeUpdateTopLevelRows(rows, opts);
  const rawRowsFetched = Number.isFinite(Number(fetchMeta.rawRowsFetched))
    ? Number(fetchMeta.rawRowsFetched)
    : Array.isArray(rows)
    ? rows.length
    : 0;
  return {
    security_severity: String(requestPlan?.securitySeverity || ''),
    pagesFetched: Number(fetchMeta.pagesFetched || 0),
    rawRowsFetched,
    uniquePackageVersionKeys: summary.uniquePackageVersionKeys,
    duplicatePackageVersionKeysWithinFilter: summary.duplicatePackageVersionKeysWithinFilter,
    rowsMissingPackageVersionKey: summary.rowsMissingPackageVersionKey,
    sampleUpdateKeys: summary.sampleUpdateKeys,
    updateKeySet: summary.updateKeySet
  };
}

function buildUpdateCrossFilterDuplicateDiagnostics(filterBreakdown, opts = {}) {
  const sampleLimit = Number.isFinite(Number(opts.sampleLimit)) ? Math.max(1, Math.floor(Number(opts.sampleLimit))) : UPDATE_DIAGNOSTIC_SAMPLE_LIMIT;
  const rows = Array.isArray(filterBreakdown) ? filterBreakdown : [];
  const keyFilterCounts = new Map();
  const crossFilterDuplicatePairs = [];

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    const leftSet = left?.updateKeySet instanceof Set ? left.updateKeySet : new Set();
    for (const key of leftSet) {
      keyFilterCounts.set(key, Number(keyFilterCounts.get(key) || 0) + 1);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      const rightSet = right?.updateKeySet instanceof Set ? right.updateKeySet : new Set();
      let duplicateKeys = 0;
      const sampleUpdateKeys = [];
      for (const key of leftSet) {
        if (!rightSet.has(key)) continue;
        duplicateKeys += 1;
        if (sampleUpdateKeys.length < sampleLimit) sampleUpdateKeys.push(key);
      }
      crossFilterDuplicatePairs.push({
        left: describeUpdateFilter(left),
        right: describeUpdateFilter(right),
        duplicateKeys,
        sampleUpdateKeys
      });
    }
  }

  let crossFilterDuplicateKeys = 0;
  for (const count of keyFilterCounts.values()) {
    if (count > 1) crossFilterDuplicateKeys += 1;
  }

  return {
    crossFilterDuplicateKeys,
    crossFilterDuplicatePairs
  };
}

function describeUpdateFilter(row) {
  const parts = [];
  if (row?.security_severity) parts.push(`security_severity=${row.security_severity}`);
  return parts.length > 0 ? parts.join(' ') : 'broad';
}

function toPublicUpdateFilterBreakdown(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    security_severity: row.security_severity,
    pagesFetched: row.pagesFetched,
    rawRowsFetched: row.rawRowsFetched,
    uniquePackageVersionKeys: row.uniquePackageVersionKeys,
    duplicatePackageVersionKeysWithinFilter: row.duplicatePackageVersionKeysWithinFilter,
    rowsMissingPackageVersionKey: row.rowsMissingPackageVersionKey,
    sampleUpdateKeys: Array.isArray(row.sampleUpdateKeys) ? row.sampleUpdateKeys.slice() : []
  }));
}

function buildUpdateServerFilterPlan(filter) {
  const severities = mapSupportedValues(filter?.severities, ACTION1_UPDATE_SECURITY_SEVERITY_VALUES);
  const rawSeverities = Array.isArray(filter?.severities) ? filter.severities.filter((value) => String(value || '').trim()) : [];

  if (severities.length === 0) {
    return {
      strategy: 'broad',
      reason: rawSeverities.length > 0 ? 'no_supported_filter_values' : 'no_usable_structured_filters',
      requests: []
    };
  }

  return {
    strategy: 'server-filtered',
    reason: '',
    requests: severities.map((securitySeverity) => ({ securitySeverity }))
  };
}

function buildUpdateTopLevelUrl(baseUrl, orgId, listLimit, requestPlan = null) {
  const url = new URL(joinUrl(baseUrl, `/updates/${encodeURIComponent(String(orgId))}`));
  url.searchParams.set('fields', '*');
  url.searchParams.set('limit', String(listLimit));
  url.searchParams.set('from', '0');
  if (requestPlan?.securitySeverity) {
    url.searchParams.set('security_severity', requestPlan.securitySeverity);
  }
  return url.toString();
}

function dedupeUpdateVersionDescriptors(rows) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = canonicalUpdatePackageVersionKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function canonicalUpdatePackageVersionKey(row) {
  const packageId = asTrimmedString(row?.packageId);
  const versionId = asTrimmedString(row?.versionId);
  return packageId && versionId ? `${packageId}:${versionId}` : '';
}

function filterQualifiedUpdateVersionDescriptors(rows, filter) {
  if (!filter?.enabled || !Array.isArray(filter.severities) || filter.severities.length === 0) return [];
  const allowedSeverities = new Set(filter.severities.map((value) => String(value || '').toUpperCase()));
  const allowedRemediation = new Set((filter.remediationStatuses || []).map((value) => String(value || '').toUpperCase()));
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const severity = normalizeUpdateSeverity({
      severity: row?.severity,
      security_severity: row?.securitySeverity
    });
    if (!severity || !allowedSeverities.has(severity)) return false;
    if (allowedRemediation.size === 0) return true;
    const remediation = normalizeRemediationStatus({
      remediationStatus: row?.remediationStatus,
      remediation_status: row?.remediationStatus,
      slaStatus: row?.slaStatus,
      update_sla_status: row?.updateSlaStatus
    });
    return remediation ? allowedRemediation.has(remediation) : false;
  });
}

function buildCrossFilterDuplicateDiagnostics(filterBreakdown, opts = {}) {
  const sampleLimit = Number.isFinite(Number(opts.sampleLimit)) ? Math.max(1, Math.floor(Number(opts.sampleLimit))) : VULNERABILITY_DIAGNOSTIC_SAMPLE_LIMIT;
  const cveFilterCounts = new Map();
  const crossFilterDuplicatePairs = [];
  const rows = Array.isArray(filterBreakdown) ? filterBreakdown : [];

  for (let index = 0; index < rows.length; index += 1) {
    const left = rows[index];
    const leftSet = left?.cveSet instanceof Set ? left.cveSet : new Set();
    for (const cveId of leftSet) {
      cveFilterCounts.set(cveId, Number(cveFilterCounts.get(cveId) || 0) + 1);
    }
    for (let inner = index + 1; inner < rows.length; inner += 1) {
      const right = rows[inner];
      const rightSet = right?.cveSet instanceof Set ? right.cveSet : new Set();
      const sampleCves = [];
      let duplicateCves = 0;
      for (const cveId of leftSet) {
        if (!rightSet.has(cveId)) continue;
        duplicateCves += 1;
        if (sampleCves.length < sampleLimit) sampleCves.push(cveId);
      }
      crossFilterDuplicatePairs.push({
        left: describeVulnerabilityFilter(left),
        right: describeVulnerabilityFilter(right),
        duplicateCves,
        sampleCves
      });
    }
  }

  let crossFilterDuplicateCves = 0;
  for (const count of cveFilterCounts.values()) {
    if (count > 1) crossFilterDuplicateCves += 1;
  }

  return {
    crossFilterDuplicateCves,
    crossFilterDuplicatePairs
  };
}

function describeVulnerabilityFilter(row) {
  const parts = [];
  if (row?.score) parts.push(`score=${row.score}`);
  if (row?.remediation_status) parts.push(`remediation_status=${row.remediation_status}`);
  return parts.length > 0 ? parts.join(' ') : 'broad';
}

function toPublicVulnerabilityFilterBreakdown(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    score: row.score,
    remediation_status: row.remediation_status,
    pagesFetched: row.pagesFetched,
    rawRowsFetched: row.rawRowsFetched,
    uniqueCves: row.uniqueCves,
    duplicateCvesWithinFilter: row.duplicateCvesWithinFilter,
    rowsMissingCanonicalCve: row.rowsMissingCanonicalCve,
    sampleCves: Array.isArray(row.sampleCves) ? row.sampleCves.slice() : []
  }));
}

function buildVulnerabilityServerFilterPlan(filter, opts = {}) {
  const severities = mapSupportedValues(filter?.severities, ACTION1_VULNERABILITY_SCORE_VALUES);
  const remediationStatuses = mapSupportedValues(filter?.remediationStatuses, ACTION1_VULNERABILITY_REMEDIATION_VALUES);
  const maxCombinations = Number.isFinite(Number(opts.maxCombinations))
    ? Math.max(1, Math.floor(Number(opts.maxCombinations)))
    : ACTION1_VULNERABILITY_FILTER_COMBINATION_CAP;

  if (severities.length === 0 && remediationStatuses.length === 0) {
    return {
      strategy: 'broad',
      reason: hasAnyFilterValues(filter) ? 'no_supported_filter_values' : 'no_usable_filters',
      requests: []
    };
  }

  const requests = [];
  if (severities.length > 0 && remediationStatuses.length > 0) {
    for (const score of severities) {
      for (const remediationStatus of remediationStatuses) {
        requests.push({ score, remediationStatus });
      }
    }
  } else if (severities.length > 0) {
    for (const score of severities) requests.push({ score, remediationStatus: '' });
  } else {
    for (const remediationStatus of remediationStatuses) requests.push({ score: '', remediationStatus });
  }

  if (requests.length > maxCombinations) {
    return {
      strategy: 'broad',
      reason: 'combination_cap_exceeded',
      requests: []
    };
  }

  return {
    strategy: 'server-filtered',
    reason: '',
    requests
  };
}

function buildVulnerabilityTopLevelUrl(baseUrl, orgId, listLimit, requestPlan = null) {
  const url = new URL(joinUrl(baseUrl, `/vulnerabilities/${encodeURIComponent(String(orgId))}`));
  url.searchParams.set('limit', String(listLimit));
  url.searchParams.set('from', '0');
  if (requestPlan?.score) {
    url.searchParams.set('score', requestPlan.score);
  }
  if (requestPlan?.remediationStatus) {
    url.searchParams.set('remediation_status', requestPlan.remediationStatus);
  }
  if (requestPlan?.score || requestPlan?.remediationStatus) {
    url.searchParams.set('sortby', 'cve_id');
  }
  return url.toString();
}

function dedupeVulnerabilityRowsByCve(rows) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const cveId = canonicalVulnerabilityCveId(row);
    if (!cveId || seen.has(cveId)) continue;
    seen.add(cveId);
    out.push(row);
  }
  return out;
}

function canonicalVulnerabilityCveId(row) {
  return String(row?.cve_id || row?.cveId || row?.id || '').trim();
}

function mapSupportedValues(values, supportedMap) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim().toUpperCase();
    const mapped = supportedMap[normalized];
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

function hasAnyFilterValues(filter) {
  return (
    (Array.isArray(filter?.severities) && filter.severities.some((value) => String(value || '').trim())) ||
    (Array.isArray(filter?.remediationStatuses) && filter.remediationStatuses.some((value) => String(value || '').trim()))
  );
}

module.exports = {
  ACTION1_BASE_URL,
  DiscoveryRequestError,
  __private: {
    buildCrossFilterDuplicateDiagnostics,
    buildUpdateCrossFilterDuplicateDiagnostics,
    buildUpdateFilterBreakdown,
    buildUpdateServerFilterPlan,
    buildUpdateTopLevelUrl,
    buildVulnerabilityFilterBreakdown,
    buildVulnerabilityServerFilterPlan,
    buildVulnerabilityTopLevelUrl,
    canonicalVulnerabilityCveId,
    canonicalUpdatePackageVersionKey,
    dedupeUpdateVersionDescriptors,
    dedupeVulnerabilityRowsByCve,
    describeUpdateFilter,
    describeVulnerabilityFilter,
    normalizeUpdateCollectionFilter,
    normalizeVulnerabilityCollectionFilter,
    summarizeUpdateTopLevelRows,
    summarizeVulnerabilityTopLevelRows,
    toPublicUpdateFilterBreakdown,
    toPublicVulnerabilityFilterBreakdown
  },
  createAction1Client,
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage,
  trimValue
};
