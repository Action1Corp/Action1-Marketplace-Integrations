const { createAction1DiscoveryClient } = require('./action1DiscoveryClient');
const { createDbPolicyStore } = require('./policyStore');
const reportingStore = require('./reporting/reportingStore');
const { writeAction1RuntimeLog } = require('./runtimeLogging');

const OVERVIEW_REFRESH_INTERVAL_MS = 1000;
const OVERVIEW_REFRESH_TIMEOUT_MS = 8000;

function text(value) {
  return String(value ?? '').trim();
}

function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

async function logOverview(context, event, fields = {}) {
  const safeFields = { event, timestamp: new Date().toISOString(), ...fields };
  const message = `Overview ${event}: ${JSON.stringify(safeFields)}`;
  await writeAction1RuntimeLog(context, 'info', message);
  context?.logger?.info?.(safeFields);
}

function normalizeEndpointRow(row) {
  const id = text(row?.id || row?.endpoint_id || row?.agent_id);
  const name = text(row?.name || row?.device_name || row?.endpoint_name);
  if (!name) return null;
  return {
    id,
    name,
    platform: text(row?.platform || row?.operating_system || row?.OS),
    status: text(row?.status),
    organizationId: text(row?.organization_id || row?.organizationId || row?.org_id)
  };
}

function normalizeReportRow(row) {
  const fields = row?.fields && typeof row.fields === 'object' ? row.fields : row;
  const policyId = text(fields?.['Policy ID'] || fields?.policyId || fields?.policy_id);
  const policyName = text(fields?.['Policy Name'] || fields?.policyName || fields?.policy_name);
  const endpointName = text(fields?.['Endpoint Name'] || fields?.endpointName || fields?.endpoint_name);
  if (!policyId || !endpointName) return null;
  const details = count(fields?.Details ?? fields?.details ?? fields?.detail);
  const organizationId = text(row?.organizationId || row?.organization_id || row?.org_id || fields?.organizationId || fields?.organization_id || fields?.org_id);
  return { ...(organizationId ? { organizationId } : {}), policyId, policyName, endpointName, details, ...(details === null ? { malformed: true } : {}) };
}

function roundPercent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function buildOverviewSummary(policyModels) {
  const policies = Array.isArray(policyModels) ? policyModels : [];
  const assignedCount = policies.reduce((total, policy) => total + policy.assignedCount, 0);
  const fullyEvaluatedCount = policies.reduce((total, policy) => total + policy.fullyEvaluatedCount, 0);
  const compliantCount = policies.reduce((total, policy) => total + policy.compliantCount, 0);
  const needsAttentionCount = policies.reduce((total, policy) => total + policy.needsAttentionCount, 0);
  const notFullyEvaluatedCount = policies.reduce((total, policy) => total + policy.notFullyEvaluatedCount, 0);
  return {
    activePoliciesCount: policies.length,
    assignedCount,
    fullyEvaluatedCount,
    compliantCount,
    needsAttentionCount,
    notFullyEvaluatedCount,
    evaluationCoveragePercent: roundPercent(fullyEvaluatedCount, assignedCount),
    compliancePercent: roundPercent(compliantCount, fullyEvaluatedCount)
  };
}

function scopeOf(policy) {
  return policy.scopeType === 'ALL_ENDPOINTS'
    ? { type: 'ALL_ENDPOINTS', endpointGroupId: null, name: 'All endpoints' }
    : { type: policy.scopeType, endpointGroupId: policy.endpointGroupId || null, name: policy.endpointGroupNameSnapshot || policy.endpointGroupId || '' };
}

function assignedFor(assignedEndpointsByPolicy, policyId) {
  if (assignedEndpointsByPolicy instanceof Map) return assignedEndpointsByPolicy.get(policyId) || [];
  return assignedEndpointsByPolicy?.[policyId] || [];
}

function mergeReportRows(rows) {
  const result = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeReportRow(raw);
    if (!row?.policyId || !row?.endpointName) continue;
    const key = `${row.organizationId || '*'}|${row.policyId}|${row.endpointName}`;
    const previous = result.get(key);
    if (!previous || row.malformed || previous.malformed) {
      result.set(key, { ...row, details: row.malformed || previous?.malformed ? null : row.details, malformed: Boolean(row.malformed || previous?.malformed) });
    } else if (row.details > previous.details) {
      result.set(key, row);
    }
  }
  return result;
}

function buildOverviewViewModel({ policies = [], assignedEndpointsByPolicy = {}, observedRows = [], nonCompliantRows = [] } = {}) {
  const activePolicies = (Array.isArray(policies) ? policies : []).filter((policy) => policy?.enabled === true);
  const observed = mergeReportRows(observedRows);
  const nonCompliant = mergeReportRows(nonCompliantRows);
  const endpointAttention = [];
  const policyModels = activePolicies.map((policy) => {
    const expectedControlCount = (policy.selectedControls || []).length;
    const endpoints = [];
    const seenEndpoints = new Set();
    for (const rawEndpoint of assignedFor(assignedEndpointsByPolicy, policy.policyId)) {
      const endpoint = rawEndpoint?.name ? rawEndpoint : normalizeEndpointRow(rawEndpoint);
      if (!endpoint || endpoint.platform !== 'Windows') continue;
      const identity = endpoint.id || endpoint.name;
      if (seenEndpoints.has(identity)) continue;
      seenEndpoints.add(identity);
      const key = `${policy.organizationId}|${policy.policyId}|${endpoint.name}`;
      const wildcardKey = `*|${policy.policyId}|${endpoint.name}`;
      const observedRow = observed.get(key) || observed.get(wildcardKey);
      const nonCompliantRow = nonCompliant.get(key) || nonCompliant.get(wildcardKey);
      const observedCount = observedRow?.details ?? null;
      const nonCompliantCount = nonCompliantRow?.details ?? 0;
      let status;
      if (!observedRow || observedCount === 0) {
        status = 'NO_DATA';
      } else if (observedRow.malformed || observedCount === null || nonCompliantRow?.malformed || nonCompliantCount > observedCount) {
        status = 'INCONSISTENT';
      } else if (observedCount < expectedControlCount) {
        status = 'PARTIAL';
      } else if (observedCount > expectedControlCount) {
        status = 'INCONSISTENT';
      } else if (nonCompliantCount > 0) {
        status = 'NEEDS_ATTENTION';
      } else {
        status = 'COMPLIANT';
      }
      const endpointModel = { endpointName: endpoint.name, endpointId: endpoint.id || null, observedCount, nonCompliantCount, status };
      endpoints.push(endpointModel);
      if (status === 'NEEDS_ATTENTION') {
        endpointAttention.push({ endpointName: endpoint.name, policyId: policy.policyId, policyName: policy.baseName || policy.displayName || '', nonCompliantCount });
      }
    }
    const counts = {
      assignedCount: endpoints.length,
      fullyEvaluatedCount: endpoints.filter((endpoint) => endpoint.status === 'COMPLIANT' || endpoint.status === 'NEEDS_ATTENTION').length,
      compliantCount: endpoints.filter((endpoint) => endpoint.status === 'COMPLIANT').length,
      needsAttentionCount: endpoints.filter((endpoint) => endpoint.status === 'NEEDS_ATTENTION').length,
      partialCount: endpoints.filter((endpoint) => endpoint.status === 'PARTIAL').length,
      noDataCount: endpoints.filter((endpoint) => endpoint.status === 'NO_DATA').length,
      inconsistentCount: endpoints.filter((endpoint) => endpoint.status === 'INCONSISTENT').length
    };
    return {
      policyId: policy.policyId,
      policyName: policy.baseName || policy.displayName || '',
      organizationId: policy.organizationId,
      scope: scopeOf(policy),
      expectedControlCount,
      ...counts,
      notFullyEvaluatedCount: counts.partialCount + counts.noDataCount,
      evaluationCoveragePercent: roundPercent(counts.fullyEvaluatedCount, counts.assignedCount),
      compliancePercent: roundPercent(counts.compliantCount, counts.fullyEvaluatedCount),
      endpoints
    };
  });
  return { summary: buildOverviewSummary(policyModels), policies: policyModels, endpointAttention };
}

async function readReportSnapshot(client, organizationId, reportId) {
  const pages = [];
  const rows = await client.listReportData(organizationId, reportId, {
    onPage: (page) => { pages.push(page); }
  });
  const latestPage = [...pages].reverse().find((page) => page && (
    page.lastRequery !== null && page.lastRequery !== undefined
      || page.totalLiveResponses !== null && page.totalLiveResponses !== undefined
      || page.totalSentRequests !== null && page.totalSentRequests !== undefined
  )) || {};
  return {
    rows,
    pages,
    lastRequery: latestPage.lastRequery ?? null,
    totalLiveResponses: latestPage.totalLiveResponses ?? null,
    totalSentRequests: latestPage.totalSentRequests ?? null
  };
}

function reportRefreshComplete(previous, current) {
  const freshnessAdvanced = current.lastRequery !== null
    && current.lastRequery !== undefined
    && current.lastRequery !== previous.lastRequery;
  const liveResponsesComplete = Number.isFinite(Number(current.totalLiveResponses))
    && Number.isFinite(Number(current.totalSentRequests))
    && Number(current.totalSentRequests) > 0
    && Number(current.totalLiveResponses) >= Number(current.totalSentRequests);
  return freshnessAdvanced || liveResponsesComplete;
}

async function readOverviewReports(client, organizationId, reportReads, options = {}) {
  const snapshots = await Promise.all(reportReads.map(async (read) => ({
    ...read,
    snapshot: await readReportSnapshot(client, organizationId, read.reportId)
  })));
  if (options.operationType !== 'manual-refresh') return snapshots;

  const previous = snapshots.map((entry) => entry.snapshot);
  await Promise.all(reportReads.map((read) => client.requestAction1Mutation({
    operation: `overview-${read.kind}-requery`,
    method: 'POST',
    organizationId,
    path: `/reportdata/${encodeURIComponent(organizationId)}/${encodeURIComponent(read.reportId)}/requery`
  })));

  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const intervalMs = Number.isFinite(Number(options.refreshIntervalMs)) ? Number(options.refreshIntervalMs) : OVERVIEW_REFRESH_INTERVAL_MS;
  const timeoutMs = Number.isFinite(Number(options.refreshTimeoutMs)) ? Number(options.refreshTimeoutMs) : OVERVIEW_REFRESH_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let latest = snapshots;
  while (true) {
    attempt += 1;
    latest = await Promise.all(reportReads.map(async (read) => ({
      ...read,
      snapshot: await readReportSnapshot(client, organizationId, read.reportId)
    })));
    if (latest.every((entry, index) => reportRefreshComplete(previous[index], entry.snapshot))) {
      return latest;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Configuration Manager Dashboard refresh did not complete within ${timeoutMs}ms.`);
    }
    await sleep(intervalMs);
  }
}

async function getOverview(context, options = {}) {
  const operationType = options.operationType === 'manual-refresh' ? 'manual-refresh' : 'initial-load';
  const startedAt = Date.now();
  await logOverview(context, 'start', { operationType });
  const policyStore = options.policyStore || createDbPolicyStore(context);
  const client = options.client || createAction1DiscoveryClient(context);
  const policies = (await policyStore.listPolicies()).filter((policy) => policy.enabled === true);
  const reporting = options.reportingState || await reportingStore.load(context);
  if (!reporting.dashboardEndpoints || !reporting.dashboardNonCompliantEndpoints) {
    throw new Error('Configuration Manager Dashboard reporting is not configured.');
  }

  const assignedEndpointsByPolicy = {};
  const inventoryCache = new Map();
  for (const policy of policies) {
    const inventoryKey = policy.scopeType === 'ALL_ENDPOINTS'
      ? `all|${policy.organizationId}`
      : `group|${policy.organizationId}|${policy.endpointGroupId}`;
    if (!inventoryCache.has(inventoryKey)) {
      const rows = policy.scopeType === 'ALL_ENDPOINTS'
        ? await client.listManagedEndpoints(policy.organizationId)
        : await client.listEndpointGroupContents(policy.organizationId, policy.endpointGroupId);
      inventoryCache.set(inventoryKey, rows.map(normalizeEndpointRow).filter(Boolean).filter((endpoint) => endpoint.platform === 'Windows'));
    }
    assignedEndpointsByPolicy[policy.policyId] = inventoryCache.get(inventoryKey);
    await logOverview(context, 'policy', {
      policyId: policy.policyId,
      organizationId: policy.organizationId,
      scopeType: policy.scopeType,
      expectedControlCount: (policy.selectedControls || []).length,
      assignedEndpointCount: assignedEndpointsByPolicy[policy.policyId].length
    });
  }

  const organizations = [...new Set(policies.map((policy) => policy.organizationId))];
  const observedRows = [];
  const nonCompliantRows = [];
  for (const organizationId of organizations) {
    const reportReads = [
      { kind: 'dashboard-endpoints', reportId: reporting.dashboardEndpoints, target: observedRows },
      { kind: 'dashboard-non-compliant', reportId: reporting.dashboardNonCompliantEndpoints, target: nonCompliantRows }
    ];
    const readResults = await readOverviewReports(client, organizationId, reportReads, {
      operationType,
      sleep: options.sleep,
      refreshIntervalMs: options.refreshIntervalMs,
      refreshTimeoutMs: options.refreshTimeoutMs
    });
    for (const result of readResults) {
      const read = result;
      const requestStartedAt = Date.now();
      const rows = result.snapshot.rows;
      const pages = result.snapshot.pages;
      const responseReceivedAt = Date.now();
      const rowCount = rows.length;
      const policyIds = [...new Set(rows.map((row) => normalizeReportRow(row)?.policyId).filter(Boolean))];
      for (const policyId of policyIds) {
        await logOverview(context, 'report-read', {
          policyId,
          organizationId,
          reportKind: read.kind,
          reportId: read.reportId,
          attempt: 1,
          returnedRowCount: rowCount,
          rowShape: rows.slice(0, 3).map((row) => ({
            keys: row && typeof row === 'object' ? Object.keys(row).slice(0, 20) : [],
            fieldKeys: row?.fields && typeof row.fields === 'object' ? Object.keys(row.fields).slice(0, 20) : []
          })),
          lastRequery: pages.find((page) => page.lastRequery !== null)?.lastRequery ?? null,
          requestTimestamp: new Date(requestStartedAt).toISOString(),
          responseTimestamp: new Date(responseReceivedAt).toISOString(),
          elapsedMs: responseReceivedAt - requestStartedAt,
          httpStatus: pages.length ? pages[pages.length - 1].statusCode : null
        });
      }
      if (policyIds.length === 0) {
        await logOverview(context, 'report-read', {
          policyId: null,
          organizationId,
          reportKind: read.kind,
          reportId: read.reportId,
          attempt: 1,
          returnedRowCount: rowCount,
          rowShape: rows.slice(0, 3).map((row) => ({
            keys: row && typeof row === 'object' ? Object.keys(row).slice(0, 20) : [],
            fieldKeys: row?.fields && typeof row.fields === 'object' ? Object.keys(row.fields).slice(0, 20) : []
          })),
          lastRequery: pages.find((page) => page.lastRequery !== null)?.lastRequery ?? null,
          requestTimestamp: new Date(requestStartedAt).toISOString(),
          responseTimestamp: new Date(responseReceivedAt).toISOString(),
          elapsedMs: responseReceivedAt - requestStartedAt,
          httpStatus: pages.length ? pages[pages.length - 1].statusCode : null
        });
      }
      result.rows = rows;
    }
    for (const result of readResults) {
      result.target.push(...result.rows.map(normalizeReportRow).filter(Boolean).map((row) => ({ ...row, organizationId })));
    }
  }
  const result = {
    ...buildOverviewViewModel({ policies, assignedEndpointsByPolicy, observedRows, nonCompliantRows }),
    reporting: { dashboardNonCompliantEndpoints: reporting.dashboardNonCompliantEndpoints }
  };
  for (const policy of result.policies) {
    await logOverview(context, 'policy-result', {
      policyId: policy.policyId,
      organizationId: policy.organizationId,
      assignedCount: policy.assignedCount,
      fullyEvaluatedCount: policy.fullyEvaluatedCount,
      partialCount: policy.partialCount,
      noDataCount: policy.noDataCount,
      compliantCount: policy.compliantCount,
      needsAttentionCount: policy.needsAttentionCount
    });
  }
  await logOverview(context, 'complete', { ...result.summary, elapsedMs: Date.now() - startedAt });
  return result;
}

module.exports = { buildOverviewSummary, buildOverviewViewModel, getOverview, normalizeEndpointRow, normalizeReportRow, roundPercent };
