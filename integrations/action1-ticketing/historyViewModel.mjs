const SUMMARY_BLOCK_BEGIN = 'HALO_PSA_SYNC_SUMMARY_BEGIN';
const SUMMARY_BLOCK_END = 'HALO_PSA_SYNC_SUMMARY_END';

export function normalizeRunStatus(rawStatus) {
  const value = String(rawStatus || '').trim().toLowerCase();

  if (!value) {
    return 'Not started';
  }
  if (value === 'running' || value === 'in progress') {
    return 'Running';
  }
  if (value === 'completed' || value === 'success' || value === 'succeeded') {
    return 'Completed';
  }
  if (value === 'interrupted') {
    return 'Interrupted';
  }
  if (value === 'failed' || value === 'error') {
    return 'Failed';
  }

  return String(rawStatus || '').trim() || 'Not started';
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

export function extractTotals(details) {
  const defaults = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const parsed = normalizeDetailsPayload(details);
  const text = parsed.text;

  if (!text && !parsed.object) {
    return defaults;
  }

  const summary = extractStructuredSummary(parsed.object, text);
  if (summary) {
    return {
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      skipped: Number(summary.skipped || 0),
      failed: Number(summary.failed || 0)
    };
  }

  const delimitedSummary = extractDelimitedSummaryBlock(text);
  if (delimitedSummary) {
    return {
      created: readCountFromText(delimitedSummary, 'created'),
      updated: readCountFromText(delimitedSummary, 'updated'),
      skipped: readCountFromText(delimitedSummary, 'skipped'),
      failed: readCountFromText(delimitedSummary, 'failed')
    };
  }

  return {
    created: readCountFromText(text, 'created'),
    updated: readCountFromText(text, 'updated'),
    skipped: readCountFromText(text, 'skipped'),
    failed: readCountFromText(text, 'failed')
  };
}

export function buildHistoryRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const totals = extractTotals(row?.details);
    const normalizedDetails = normalizeDetailsPayload(row?.details);

    return {
      id: row?.id ?? null,
      started: formatDateTime(row?.timestamp),
      result: normalizeRunStatus(row?.status),
      created: totals.created,
      updated: totals.updated,
      skipped: totals.skipped,
      failed: totals.failed,
      actionId: String(row?.action_id || '').trim(),
      actionLabel: String(row?.action_label || '').trim(),
      details: normalizedDetails.text,
      assetsProcessed: Number(row?.assets_processed || 0)
    };
  });
}

function normalizeDetailsPayload(details) {
  if (details && typeof details === 'object') {
    try {
      return {
        object: details,
        text: JSON.stringify(details)
      };
    } catch {
      return {
        object: details,
        text: ''
      };
    }
  }

  const text = String(details || '').trim();
  return {
    object: null,
    text
  };
}

function extractStructuredSummary(detailsObject, detailsText) {
  if (detailsObject && typeof detailsObject === 'object') {
    const summary = detailsObject?.summary || detailsObject?.details?.summary || detailsObject;
    if (summary && typeof summary === 'object') {
      return summary;
    }
  }

  if (!detailsText) {
    return null;
  }

  try {
    const parsed = JSON.parse(detailsText);
    const summary = parsed?.summary || parsed?.details?.summary || parsed;
    return summary && typeof summary === 'object' ? summary : null;
  } catch {
    return null;
  }
}

function extractDelimitedSummaryBlock(detailsText) {
  const text = String(detailsText || '');
  if (!text) {
    return '';
  }

  const startIndex = text.indexOf(SUMMARY_BLOCK_BEGIN);
  if (startIndex < 0) {
    return '';
  }

  const afterBegin = startIndex + SUMMARY_BLOCK_BEGIN.length;
  const endIndex = text.indexOf(SUMMARY_BLOCK_END, afterBegin);
  if (endIndex < 0) {
    return '';
  }

  return text.slice(afterBegin, endIndex).trim();
}

function readCountFromText(text, label) {
  const match = String(text || '').match(new RegExp(`(?:^|\\n|\\r)\\s*${label}\\s*[:=]\\s*(\\d+)`, 'i'));
  return match ? Number(match[1]) : 0;
}
