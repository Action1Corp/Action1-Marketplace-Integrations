'use strict';

/*
 * Temporary live diagnostic. This file is intentionally outside the automated
 * test runner and is not registered in the integration manifest.
 *
 * Run with Action1 credentials supplied through environment variables:
 *   ACTION1_CLIENT_ID
 *   ACTION1_CLIENT_SECRET
 *   ACTION1_BASE_URL (optional; defaults to https://app.action1.com/api/3.0)
 *
 * The diagnostic uses the integration discovery client for credential
 * resolution, token acquisition, rate-limit handling, and authenticated HTTP.
 * The CLI context.http adapter below only bridges that existing runtime seam
 * to Node fetch and records response metadata; it never prints credentials or
 * headers.
 */

const { createAction1DiscoveryClient } = require('../../action1DiscoveryClient');

const TARGET_ORGANIZATION_ID = 'e1f36170-ae17-11f0-94b4-4bdbbcb1d790';
const REPORTS = [
  {
    kind: 'dashboard-endpoints',
    id: 'configuration_management___dashboard_endpoints_1787786038800'
  },
  {
    kind: 'dashboard-non-compliant',
    id: 'configuration_management___dashboard_non_compliant_endpoints_1787786040877'
  }
];

const SHAPES = [
  { name: 'marketplace', query: '?limit=500&from=0' },
  { name: 'browser', query: '?limit=200&from=0&live_only=no&details=no' },
  { name: 'swagger', query: '' }
];

function isoNow() {
  return new Date().toISOString();
}

function valueFrom(row, keys) {
  const fields = row && typeof row.fields === 'object' ? row.fields : {};
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) return row[key];
    if (fields[key] !== undefined && fields[key] !== null) return fields[key];
  }
  return null;
}

function normalizeRow(row) {
  return {
    policyId: valueFrom(row, ['Policy ID', 'policy_id', 'policyId']),
    policyName: valueFrom(row, ['Policy Name', 'policy_name', 'policyName']),
    endpointName: valueFrom(row, ['Endpoint Name', 'endpoint_name', 'endpointName']),
    details: valueFrom(row, ['Details', 'details'])
  };
}

function readMetadata(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    totalItems: data.total_items ?? data.totalItems ?? null,
    itemCount: items.length,
    totalLiveResponses: data.total_live_responses ?? data.totalLiveResponses ?? null,
    totalSentRequests: data.total_sent_requests ?? data.totalSentRequests ?? null,
    lastRequery: data.last_requery ?? data.lastRequery ?? null,
    rows: items.map(normalizeRow)
  };
}

function safeError(error) {
  return {
    message: String(error?.message || 'Action1 request failed.'),
    status: error?.statusCode ?? error?.diagnostics?.statusCode ?? null
  };
}

function buildPath(organizationId, reportId, query) {
  return `/reportdata/${encodeURIComponent(organizationId)}/${encodeURIComponent(reportId)}/data${query}`;
}

function printEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function createCliContext() {
  const clientId = process.env.ACTION1_CLIENT_ID;
  const clientSecret = process.env.ACTION1_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set ACTION1_CLIENT_ID and ACTION1_CLIENT_SECRET before running the diagnostic.');
  }

  const baseUrl = process.env.ACTION1_BASE_URL || 'https://app.action1.com/api/3.0';
  const requests = [];

  const context = {
    action1: {
      async getCredentials() {
        return { clientId, clientSecret, baseUrl };
      }
    },
    logger: {
      info() {},
      warn() {}
    },
    async http(options) {
      const startedAt = Date.now();
      const headers = options.headers || {};
      const response = await fetch(options.url, {
        method: options.method,
        headers,
        body: options.data instanceof URLSearchParams ? options.data : options.data
      });
      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      requests.push({
        method: options.method,
        path: options.path,
        status: response.status,
        startedAt,
        endedAt: Date.now()
      });
      return {
        status: response.status,
        data,
        headers: Object.fromEntries(response.headers.entries())
      };
    }
  };

  return { context, requests };
}

async function readReport(client, requests, organizationId, report, shape, lifecycle, emit = printEvent) {
  const path = buildPath(organizationId, report.id, shape.query);
  const startedAt = Date.now();
  let payload;
  let error;
  try {
    payload = await client.requestAction1Mutation({
      operation: `manual-diagnostic-${report.kind}-${shape.name}`,
      method: 'GET',
      organizationId,
      path
    });
  } catch (requestError) {
    error = safeError(requestError);
  }
  const transport = requests[requests.length - 1] || {};
  const metadata = payload ? readMetadata(payload) : null;
  emit({
    event: 'report-data',
    timestamp: isoNow(),
    reportKind: report.kind,
    reportId: report.id,
    organizationId,
    shape: shape.name,
    requestPath: path,
    status: error?.status ?? transport.status ?? null,
    elapsedSinceRequeryMs: lifecycle?.requeryAt ? Date.now() - lifecycle.requeryAt : null,
    ...(metadata || { totalItems: null, itemCount: null, totalLiveResponses: null, totalSentRequests: null, lastRequery: null, rows: [] }),
    ...(error ? { error } : {})
  });
  return metadata;
}

async function requery(client, requests, organizationId, report, emit = printEvent) {
  const path = `/reportdata/${encodeURIComponent(organizationId)}/${encodeURIComponent(report.id)}/requery`;
  const startedAt = Date.now();
  let payload;
  let error;
  try {
    payload = await client.requestAction1Mutation({
      operation: `manual-diagnostic-${report.kind}-requery`,
      method: 'POST',
      organizationId,
      path
    });
  } catch (requestError) {
    error = safeError(requestError);
  }
  const transport = requests[requests.length - 1] || {};
  emit({
    event: 'requery',
    timestamp: isoNow(),
    reportKind: report.kind,
    reportId: report.id,
    organizationId,
    requestPath: path,
    method: 'POST',
    status: error?.status ?? transport.status ?? null,
    elapsedMs: Date.now() - startedAt,
    responseMetadata: payload && typeof payload === 'object' ? {
      lastRequery: payload.last_requery ?? payload.lastRequery ?? null
    } : null,
    ...(error ? { error } : {})
  });
  if (error) throw new Error(`${report.kind} requery failed: ${error.message}`);
  return Date.now();
}

async function runReport(client, requests, organizationId, report, emit = printEvent) {
  emit({ event: 'report-start', timestamp: isoNow(), reportKind: report.kind, reportId: report.id, organizationId });
  for (const shape of SHAPES) await readReport(client, requests, organizationId, report, shape, null, emit);

  const requeryAt = await requery(client, requests, organizationId, report, emit);
  const lifecycle = { requeryAt };
  await readReport(client, requests, organizationId, report, SHAPES[1], lifecycle, emit);
  for (const delayMs of [2000, 3000, 5000]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await readReport(client, requests, organizationId, report, SHAPES[1], lifecycle, emit);
  }
  emit({ event: 'report-complete', timestamp: isoNow(), reportKind: report.kind, reportId: report.id, organizationId });
}

async function runDiagnostic(context, options = {}) {
  const organizationId = options.organizationId || TARGET_ORGANIZATION_ID;
  const reports = options.reports || REPORTS;
  const requests = options.requests || [];
  const emit = options.emit || printEvent;
  const originalHttp = context.http;
  if (typeof originalHttp !== 'function') throw new Error('A Marketplace-compatible context.http seam is required.');
  context.http = async (requestOptions) => {
    const response = await originalHttp(requestOptions);
    requests.push({
      method: requestOptions.method,
      path: requestOptions.path,
      status: response?.statusCode ?? response?.status ?? null,
      startedAt: Date.now(),
      endedAt: Date.now()
    });
    return response;
  };
  try {
    const client = createAction1DiscoveryClient(context, { maxRetries: 0 });
    for (const report of reports) await runReport(client, requests, organizationId, report, emit);
  } finally {
    context.http = originalHttp;
  }
}

async function main() {
  const { context, requests } = createCliContext();
  await runDiagnostic(context, { requests });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: 'diagnostic-failed', error: safeError(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildPath, normalizeRow, readMetadata, runReport, runDiagnostic };
