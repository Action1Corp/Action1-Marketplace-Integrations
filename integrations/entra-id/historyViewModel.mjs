import { extractTrackedRunPayload, extractTrackedRunSummary } from './trackedRunSummary.mjs';

export const TIMESTAMP_LABEL = 'STARTED';

export function normalizeRunStatus(rawStatus) {
  const value = String(rawStatus || '').trim().toLowerCase();

  if (!value) {
    return 'Never run';
  }
  if (value === 'running' || value === 'in progress') {
    return 'Running';
  }
  if (
    value === 'completedwithissues'
    || value === 'completed with issues'
    || value === 'partial'
    || value === 'mixed result'
  ) {
    return 'Completed with issues';
  }
  if (value === 'success' || value === 'completed' || value === 'succeeded') {
    return 'Success';
  }
  if (value === 'failure' || value === 'failed' || value === 'error') {
    return 'Failure';
  }

  return String(rawStatus || '').trim() || 'Never run';
}

export function resultTone(result) {
  if (result === 'Success') return { color: '#166534' };
  if (result === 'Running') return { color: '#1D4ED8' };
  if (result === 'Completed with issues') return { color: '#92400E' };
  if (result === 'Failure') return { color: '#B91C1C' };
  return { color: '#334155' };
}

export function formatDateTime(value) {
  if (!value) {
    return 'Not yet recorded';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not yet recorded';
  }

  return parsed.toLocaleString();
}

export function parseSummary(details) {
  return extractTrackedRunSummary(details).summary;
}

function truncateText(value, maxLength = 160) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function sanitizeDiagnosticText(value) {
  return truncateText(
    String(value || '')
      .replace(/bearer\s+[a-z0-9\-._~+/]+=*/gi, 'bearer [redacted]')
      .replace(/authorization(?:["']|\s)*[:=]\s*[^\r\n]+/gi, 'authorization=[redacted]')
      .replace(/access_token(?:["']|\s)*[:=]\s*[a-z0-9\-._~+/]+=*/gi, 'access_token=[redacted]')
      .replace(/refresh_token(?:["']|\s)*[:=]\s*[a-z0-9\-._~+/]+=*/gi, 'refresh_token=[redacted]')
      .replace(/client_secret(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'client_secret=[redacted]')
      .replace(/password(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'password=[redacted]')
      .replace(/https?:\/\/\S+/gi, '[redacted url]')
      .replace(/\b(org(?:anization)?[_ -]?id|endpoint[_ -]?id|tenant[_ -]?id)\b\s*[:=]\s*["']?[^"',\s}]+["']?/gi, '$1=[redacted]')
      .replace(/\b(org-[a-z0-9_-]+|ep-[a-z0-9_-]+|tenant-[a-z0-9_-]+)\b/gi, '[redacted]')
      .replace(/payload\s*=\s*\{[^}]*\}/gi, 'payload=[redacted]')
      .replace(/attribute name\s+['"][^'"]+['"]\s+does not supported/gi, 'Configured Action1 custom attribute was not found.')
      .replace(/\s+/g, ' ')
  );
}

function normalizeDiagnosticMessage(rawMessage, diagnostics = {}) {
  const message = String(rawMessage || '').trim();
  const lower = message.toLowerCase();
  const stage = String(diagnostics?.stage || '').trim().toLowerCase();
  const service = String(diagnostics?.service || '').trim().toLowerCase();
  const httpStatus = Number(diagnostics?.httpStatus || 0);

  if (!message) {
    if (stage === 'graph_authentication' || service === 'microsoft_graph') {
      return 'Microsoft Graph authentication failed.';
    }
    if (stage === 'action1_endpoint_collection' || (service === 'action1_api' && httpStatus === 401)) {
      return 'Action1 authentication failed.';
    }
    return '';
  }

  if (
    lower.includes('attribute name')
    || lower.includes('custom attribute')
    || lower.includes('does not supported')
    || lower.includes('not found')
  ) {
    return 'Configured Action1 custom attribute was not found.';
  }
  if (
    stage === 'graph_authentication'
    || service === 'microsoft_graph' && (httpStatus === 401 || lower.includes('token') || lower.includes('authentication'))
  ) {
    return 'Microsoft Graph authentication failed.';
  }
  if (
    service === 'action1_api'
    && (httpStatus === 401 || lower.includes('unauthorized') || lower.includes('authentication') || lower.includes('oauth'))
  ) {
    return 'Action1 authentication failed.';
  }
  if (httpStatus === 429 || lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'Rate limit reached before the update could complete.';
  }
  if (lower.includes('patch') && service === 'action1_api') {
    return 'Action1 rejected an endpoint update request.';
  }

  return sanitizeDiagnosticText(message);
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function collectDiagnosticMessages(results = [], diagnostics = {}) {
  const messages = [];

  for (const row of Array.isArray(results) ? results : []) {
    if (row?.error) {
      messages.push(normalizeDiagnosticMessage(row.error, diagnostics));
    }
    for (const patchError of Array.isArray(row?.patchErrors) ? row.patchErrors : []) {
      const rawMessage = typeof patchError === 'string' ? patchError : patchError?.error;
      messages.push(normalizeDiagnosticMessage(rawMessage, diagnostics));
    }
  }

  if (messages.length === 0) {
    const fallbackMessage = normalizeDiagnosticMessage(diagnostics?.message || '', diagnostics);
    if (fallbackMessage && !/^sync completed with issues\.?$/i.test(fallbackMessage)) {
      messages.push(fallbackMessage);
    }
  }

  return messages.filter(Boolean);
}

export function buildHistoryDiagnosticSummary(details, rowStatus = '') {
  const extracted = extractTrackedRunPayload(details);
  const summary = extracted.summary || {};
  const diagnostics = extracted.diagnostics || {};
  const results = extracted.results || [];
  const result = normalizeRunStatus(summary.finalStatus || rowStatus);
  const failedEndpointUpdates = Number(summary.failedEndpointUpdates || 0);
  const failedOrganizations = Number(summary.failedOrganizations || 0);
  const hasStructuredPayload = Boolean(extracted.payload && (
    Object.keys(summary).length > 0
    || Object.keys(diagnostics).length > 0
    || results.length > 0
  ));

  if (!hasStructuredPayload) {
    return null;
  }
  if (result === 'Success') {
    return null;
  }

  const counts = new Map();
  for (const message of collectDiagnosticMessages(results, diagnostics)) {
    counts.set(message, (counts.get(message) || 0) + 1);
  }

  const errorSummaries = Array.from(counts.entries())
    .map(([text, count]) => ({ text, count }))
    .filter((entry) => entry.text)
    .slice(0, 3);
  const moreUniqueErrors = Math.max(0, counts.size - errorSummaries.length);

  const lines = [`Result: ${result}`];
  if (failedEndpointUpdates > 0) {
    lines.push(`${pluralize(failedEndpointUpdates, 'endpoint update')} failed.`);
  }
  if (failedOrganizations > 0) {
    lines.push(`${pluralize(failedOrganizations, 'organization')} failed.`);
  }
  for (const entry of errorSummaries) {
    lines.push(entry.count > 1 ? `${entry.text} (${entry.count} occurrences)` : entry.text);
  }
  if (moreUniqueErrors > 0) {
    lines.push(`And ${moreUniqueErrors} more unique errors. Review the integration diagnostic log.`);
  }

  return {
    result,
    failedEndpointUpdates,
    failedOrganizations,
    errorSummaries,
    moreUniqueErrors,
    lines,
    copyText: lines.join('\n')
  };
}

export function buildHistoryRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const summary = parseSummary(row?.details);
    const diagnosticSummary = buildHistoryDiagnosticSummary(row?.details, summary.finalStatus || row?.status);
    return {
      id: row?.id ?? null,
      started: formatDateTime(row?.timestamp),
      result: normalizeRunStatus(summary.finalStatus || row?.status),
      endpointsSynchronized: Number(summary.endpointsSynchronized || 0),
      skipped: Number(summary.skipped || 0),
      failedEndpointUpdates: Number(summary.failedEndpointUpdates || 0),
      detailsLabel: diagnosticSummary ? 'View' : '—',
      diagnosticSummary
    };
  });
}
