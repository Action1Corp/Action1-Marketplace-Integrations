const { createAction1DiscoveryClient } = require('./action1DiscoveryClient');
const { createDbPolicyStore } = require('./policyStore');
const reportingStore = require('./reporting/reportingStore');

function text(value) {
  return String(value ?? '').trim();
}

function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
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
  const policyId = text(row?.['Policy ID'] || row?.policyId || row?.policy_id);
  const policyName = text(row?.['Policy Name'] || row?.policyName || row?.policy_name);
  const endpointName = text(row?.['Endpoint Name'] || row?.endpointName || row?.endpoint_name);
  if (!policyId || !endpointName) return null;
  const details = count(row?.Details ?? row?.details ?? row?.detail);
  const organizationId = text(row?.organizationId || row?.organization_id || row?.org_id);
  return { ...(organizationId ? { organizationId } : {}), policyId, policyName, endpointName, details, ...(details === null ? { malformed: true } : {}) };
}

function roundPercent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
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
      notFullyEvaluatedCount: counts.partialCount + counts.noDataCount + counts.inconsistentCount,
      evaluationCoveragePercent: roundPercent(counts.fullyEvaluatedCount, counts.assignedCount),
      compliancePercent: roundPercent(counts.compliantCount, counts.fullyEvaluatedCount),
      endpoints
    };
  });
  return { policies: policyModels, endpointAttention };
}

async function getOverview(context, options = {}) {
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
  }

  const organizations = [...new Set(policies.map((policy) => policy.organizationId))];
  const observedRows = [];
  const nonCompliantRows = [];
  for (const organizationId of organizations) {
    const [observed, attention] = await Promise.all([
      client.listReportData(organizationId, reporting.dashboardEndpoints),
      client.listReportData(organizationId, reporting.dashboardNonCompliantEndpoints)
    ]);
    observedRows.push(...observed.map(normalizeReportRow).filter(Boolean).map((row) => ({ ...row, organizationId })));
    nonCompliantRows.push(...attention.map(normalizeReportRow).filter(Boolean).map((row) => ({ ...row, organizationId })));
  }
  return buildOverviewViewModel({ policies, assignedEndpointsByPolicy, observedRows, nonCompliantRows });
}

module.exports = { buildOverviewViewModel, getOverview, normalizeEndpointRow, normalizeReportRow, roundPercent };
