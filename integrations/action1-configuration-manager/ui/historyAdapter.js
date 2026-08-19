const ACTION_LABEL_OPERATIONS = {
  'Policy created': 'Policy created',
  'Policy updated': 'Policy updated',
  'Policy disabled': 'Policy disabled',
  'Policy enabled': 'Policy enabled',
  'Policy deleted': 'Policy deleted',
  'Scheduled reconciliation': 'Reconciliation',
  'Reporting setup': 'Reporting setup'
};

function customerOperationLabel(label) {
  return label === 'Scheduled reconciliation' ? 'Reconciliation' : label;
}

const SAFE_STATUSES = new Set(['Success', 'Failed', 'Running']);
const DEFAULT_PAGE_SIZE = 50;

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

function fallbackRow(row) {
  const operation = ACTION_LABEL_OPERATIONS[row?.action_label] || 'Policy operation';
  const reporting = row?.action_label === 'Reporting setup';
  return {
    id: row?.id,
    timestamp: row?.timestamp || null,
    timestampLabel: formatTimestamp(row?.timestamp),
    operation,
    policyName: reporting ? '—' : 'Unavailable',
    organizationName: reporting ? '—' : 'Unavailable',
    result: SAFE_STATUSES.has(row?.status) ? row.status : 'Failed',
    summary: reporting ? (row?.status === 'Success' ? 'Data source and reports configured' : 'Reporting setup failed') : 'History details are unavailable for this entry.',
    counts: {},
    familyOutcomes: [],
    policies: [],
    errors: [],
    detailsAvailable: reporting
  };
}

function parseHistoryRow(row, extractEnvelope) {
  const envelope = extractEnvelope(row?.details);
  if (!envelope) return fallbackRow(row);
  const result = SAFE_STATUSES.has(row?.status) ? row.status : 'Failed';
  return {
    id: row?.id,
    timestamp: row?.timestamp || null,
    timestampLabel: formatTimestamp(row?.timestamp),
    operation: ACTION_LABEL_OPERATIONS[row?.action_label] || customerOperationLabel(envelope.operationLabel),
    policyName: envelope.policyNameSnapshot || '—',
    organizationName: envelope.organizationNameSnapshot || '—',
    result,
    summary: envelope.summary || (envelope.operation === 'REPORTING_SETUP' ? 'Reporting setup failed' : 'Policy operation completed.'),
    counts: envelope.counts || {},
    familyOutcomes: envelope.familyOutcomes || [],
    policies: envelope.policies || [],
    errors: envelope.errors || [],
    detailsAvailable: true
  };
}

export function createHistoryAdapter({ integration, fetchImpl = fetch, extractEnvelope }) {
  return {
    async list({ page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
      const params = new URLSearchParams({
        integration,
        page: String(page),
        pageSize: String(pageSize),
        sortKey: 'timestamp',
        sortDirection: 'desc'
      });
      const response = await fetchImpl(`/api/history?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Unable to load Policy History.');
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      return {
        rows: rows.map((row) => parseHistoryRow(row, extractEnvelope)),
        total: Number(payload.total) || 0,
        page: Number(payload.page) || page,
        pageSize: Number(payload.pageSize) || pageSize
      };
    }
  };
}

export { fallbackRow, formatTimestamp, parseHistoryRow };
