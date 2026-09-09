const { createAction1DiscoveryClient } = require('./action1DiscoveryClient');
const { createDbPolicyStore } = require('./policyStore');
const reportingStore = require('./reporting/reportingStore');
const { formatRuntimeElapsed, formatRuntimePercent, writeOperationalLog } = require('./runtimeLogging');

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

async function logOverview(context, event, fields = {}, level = 'info') {
  const messages = {
    start: fields.operationType === 'manual-refresh' ? 'Dashboard refresh started' : 'Dashboard load started',
    policy: 'Dashboard policy scope loaded',
    'report-read': 'Dashboard report read',
    'report-control-summary': 'Dashboard report controls summarized',
    'reports-loaded': 'Dashboard reports loaded',
    'report-endpoint-row': 'Dashboard report endpoint',
    'report-non-compliant-endpoint-row': 'Dashboard report non-compliant endpoint',
    'classification-endpoint': 'Dashboard endpoint',
    'policy-aggregate': 'Dashboard policy evaluated',
    'policy-result': 'Dashboard policy evaluated',
    'overview-aggregate': fields.operationType === 'manual-refresh' ? 'Dashboard refresh completed' : 'Dashboard load completed',
    complete: fields.operationType === 'manual-refresh' ? 'Dashboard refresh completed' : 'Dashboard load completed'
  };
  const message = messages[event] || `Dashboard ${event}`;
  const mapped = event === 'classification-endpoint'
    ? { policy: fields.policyId, endpoint: fields.endpoint, expected: fields.expectedControlCount, observed: fields.observedControlCount, nonCompliant: fields.nonCompliantControlCount, state: fields.classification }
    : event === 'reports-loaded'
      ? { policy: fields.policyId, endpoints: fields.endpoints, nonCompliantEndpoints: fields.nonCompliantEndpoints, nonCompliantControls: fields.nonCompliantControls, lastRequery: fields.lastRequery }
    : event === 'policy-aggregate' || event === 'policy-result'
      ? { policy: fields.policyId, assigned: fields.assignedCount, evaluated: fields.fullyEvaluatedCount, compliant: fields.compliantCount, attention: fields.needsAttentionCount, partial: fields.partialCount, noData: fields.noDataCount, coverage: formatRuntimePercent(fields.coveragePercent), compliance: formatRuntimePercent(fields.compliancePercent) }
      : event === 'complete' || event === 'overview-aggregate'
        ? { policies: fields.activePoliciesCount, assigned: fields.assignedCount, evaluated: fields.fullyEvaluatedCount, compliant: fields.compliantCount, attention: fields.needsAttentionCount, partial: fields.partialCount || 0, noData: fields.noDataCount || 0, coverage: formatRuntimePercent(fields.evaluationCoveragePercent), compliance: formatRuntimePercent(fields.compliancePercent), ...(fields.elapsedMs !== undefined ? { elapsed: formatRuntimeElapsed(fields.elapsedMs) } : {}) }
        : fields;
  await writeOperationalLog(context, level, message, mapped);
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

function normalizeDashboardControlRow(row, organizationId) {
  const fields = row?.fields && typeof row.fields === 'object' ? row.fields : row;
  const policyId = text(fields?.['Policy ID'] || fields?.policyId || fields?.policy_id);
  const policyName = text(fields?.['Policy Name'] || fields?.policyName || fields?.policy_name);
  const controlName = text(fields?.['Control Name'] || fields?.controlName || fields?.control_name);
  const affectedEndpointCount = count(fields?.Details ?? fields?.details ?? fields?.detail);
  if (!policyId || !controlName || affectedEndpointCount === null) return null;
  return { policyId, policyName, organizationId: text(organizationId || row?.organizationId || row?.organization_id), controlName, affectedEndpointCount };
}

function roundPercent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function selectTopControlsNeedingAttention(rows, policies) {
  const activePolicies = new Map((Array.isArray(policies) ? policies : [])
    .filter((policy) => policy?.enabled === true)
    .map((policy) => [`${text(policy.organizationId)}|${text(policy.policyId)}`, policy]));
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => activePolicies.has(`${text(row?.organizationId)}|${text(row?.policyId)}`))
    .sort((left, right) => Number(right.affectedEndpointCount) - Number(left.affectedEndpointCount)
      || text(left.controlName).localeCompare(text(right.controlName))
      || text(left.policyName).localeCompare(text(right.policyName))
      || text(left.policyId).localeCompare(text(right.policyId)))
    .slice(0, 5);
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

function buildOverviewViewModel({ policies = [], assignedEndpointsByPolicy = {}, observedRows = [], nonCompliantRows = [], dashboardControlRows = [] } = {}) {
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
  return { summary: buildOverviewSummary(policyModels), policies: policyModels, endpointAttention, topControlsNeedingAttention: selectTopControlsNeedingAttention(dashboardControlRows, activePolicies) };
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
  const policyStore = options.policyStore || createDbPolicyStore(context);
  const client = options.client || createAction1DiscoveryClient(context);
  const action1ConsoleOrigin = typeof client.resolveAction1ConsoleOrigin === 'function'
    ? await client.resolveAction1ConsoleOrigin()
    : null;
  const policies = (await policyStore.listPolicies()).filter((policy) => policy.enabled === true);
  await logOverview(context, 'start', { operationType, activePolicies: policies.length });
  const reporting = options.reportingState || await reportingStore.load(context);
  if (!reporting.dashboardEndpoints || !reporting.dashboardNonCompliantEndpoints || !reporting.dashboardNonCompliantControls) {
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
    }, 'debug');
  }

  const organizations = [...new Set(policies.map((policy) => policy.organizationId))];
  const observedRows = [];
  const nonCompliantRows = [];
  const dashboardControlRows = [];
  for (const organizationId of organizations) {
    const reportReads = [
      { kind: 'dashboard-endpoints', reportId: reporting.dashboardEndpoints, target: observedRows },
      { kind: 'dashboard-non-compliant', reportId: reporting.dashboardNonCompliantEndpoints, target: nonCompliantRows },
      { kind: 'dashboard-non-compliant-controls', reportId: reporting.dashboardNonCompliantControls, target: dashboardControlRows }
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
      const normalizedRows = read.kind === 'dashboard-non-compliant-controls'
        ? rows.map((row) => normalizeDashboardControlRow(row, organizationId)).filter(Boolean)
        : rows.map(normalizeReportRow).filter(Boolean).map((row) => ({ ...row, organizationId }));
      const policyIds = [...new Set(normalizedRows.map((row) => row.policyId).filter(Boolean))];
      for (const policyId of policyIds) {
        await logOverview(context, 'report-read', {
          policyId,
          organizationId,
          reportKind: read.kind,
          reportId: read.reportId,
          attempt: 1,
          returnedRowCount: rowCount,
          normalizedRowCount: normalizedRows.filter((row) => row.policyId === policyId).length,
          lastRequery: result.snapshot.lastRequery,
          requestTimestamp: new Date(requestStartedAt).toISOString(),
          responseTimestamp: new Date(responseReceivedAt).toISOString(),
          elapsedMs: responseReceivedAt - requestStartedAt,
          httpStatus: pages.length ? pages[pages.length - 1].statusCode : null
        }, 'debug');
      }
      if (read.kind === 'dashboard-endpoints' || read.kind === 'dashboard-non-compliant') {
        const event = read.kind === 'dashboard-endpoints' ? 'report-endpoint-row' : 'report-non-compliant-endpoint-row';
        for (const row of normalizedRows.slice(0, 100)) {
          await logOverview(context, event, read.kind === 'dashboard-endpoints'
            ? { policyId: row.policyId, endpoint: row.endpointName, observedControlCount: row.details }
            : { policyId: row.policyId, endpoint: row.endpointName, nonCompliantControlCount: row.details }, 'debug');
        }
      } else {
        const byPolicy = new Map();
        for (const row of normalizedRows) {
          if (!byPolicy.has(row.policyId)) byPolicy.set(row.policyId, []);
          byPolicy.get(row.policyId).push(row);
        }
        for (const [policyId, policyRows] of byPolicy) {
          const top = [...policyRows]
            .sort((left, right) => right.affectedEndpointCount - left.affectedEndpointCount || left.controlName.localeCompare(right.controlName))
            .slice(0, 5)
            .map((row) => ({ controlName: row.controlName, affectedEndpointCount: row.affectedEndpointCount }));
          await logOverview(context, 'report-control-summary', {
            policyId,
            totalRows: policyRows.length,
            topControlCount: top.length,
            topControls: top
          }, 'debug');
        }
      }
      if (policyIds.length === 0) {
        await logOverview(context, 'report-read', {
          policyId: null,
          organizationId,
          reportKind: read.kind,
          reportId: read.reportId,
          attempt: 1,
          returnedRowCount: rowCount,
          normalizedRowCount: normalizedRows.length,
          lastRequery: result.snapshot.lastRequery,
          requestTimestamp: new Date(requestStartedAt).toISOString(),
          responseTimestamp: new Date(responseReceivedAt).toISOString(),
          elapsedMs: responseReceivedAt - requestStartedAt,
          httpStatus: pages.length ? pages[pages.length - 1].statusCode : null
        }, 'debug');
      }
      result.rows = rows;
    }
    for (const result of readResults) {
      if (result.kind === 'dashboard-non-compliant-controls') {
        result.target.push(...result.rows.map((row) => normalizeDashboardControlRow(row, organizationId)).filter(Boolean));
      } else {
        result.target.push(...result.rows.map(normalizeReportRow).filter(Boolean).map((row) => ({ ...row, organizationId })));
      }
    }
  }
  const result = {
    ...buildOverviewViewModel({ policies, assignedEndpointsByPolicy, observedRows, nonCompliantRows, dashboardControlRows }),
    action1ConsoleOrigin,
    reporting: { dashboardNonCompliantEndpoints: reporting.dashboardNonCompliantEndpoints, dashboardNonCompliantControls: reporting.dashboardNonCompliantControls }
  };
  for (const policy of result.policies) {
    const diagnosticCap = 50;
    const diagnosticEndpoints = policy.endpoints.slice(0, diagnosticCap);
    const seenDiagnostics = new Set();
    for (const endpoint of diagnosticEndpoints) {
      const diagnosticKey = `${policy.policyId}|${endpoint.endpointId || endpoint.endpointName}`;
      if (seenDiagnostics.has(diagnosticKey)) continue;
      seenDiagnostics.add(diagnosticKey);
      await logOverview(context, 'classification-endpoint', {
        policyId: policy.policyId,
        endpoint: endpoint.endpointName,
        expectedControlCount: policy.expectedControlCount,
        observedControlCount: endpoint.observedCount,
        nonCompliantControlCount: endpoint.nonCompliantCount,
        classification: endpoint.status
      }, 'debug');
    }
    if (policy.endpoints.length > diagnosticEndpoints.length) {
      await writeOperationalLog(context, 'debug', 'Dashboard endpoint diagnostics truncated', { policy: policy.policyId, logged: diagnosticEndpoints.length, total: policy.endpoints.length });
    }
    await logOverview(context, 'policy-aggregate', {
      policyId: policy.policyId,
      policyName: policy.policyName,
      organizationId: policy.organizationId,
      scopeType: policy.scope.type,
      assignedCount: policy.assignedCount,
      expectedControlCount: policy.expectedControlCount,
      fullyEvaluatedCount: policy.fullyEvaluatedCount,
      compliantCount: policy.compliantCount,
      needsAttentionCount: policy.needsAttentionCount,
      partialCount: policy.partialCount,
      noDataCount: policy.noDataCount,
      coveragePercent: policy.evaluationCoveragePercent,
      compliancePercent: policy.compliancePercent
    });
    await logOverview(context, 'reports-loaded', { policyId: policy.policyId, organizationId: policy.organizationId, endpoints: policy.assignedCount, nonCompliantEndpoints: policy.needsAttentionCount + policy.partialCount, nonCompliantControls: null, lastRequery: null });
  }
  await logOverview(context, 'complete', { ...result.summary, partialCount: result.policies.reduce((total, policy) => total + policy.partialCount, 0), noDataCount: result.policies.reduce((total, policy) => total + policy.noDataCount, 0), operationType, elapsedMs: Date.now() - startedAt });
  return result;
}

module.exports = { buildOverviewSummary, buildOverviewViewModel, getOverview, normalizeDashboardControlRow, normalizeEndpointRow, normalizeReportRow, roundPercent, selectTopControlsNeedingAttention };
