const SUMMARY_BLOCK_BEGIN = 'ACTION1_TICKETING_SYNC_SUMMARY_BEGIN';
const SUMMARY_BLOCK_END = 'ACTION1_TICKETING_SYNC_SUMMARY_END';
const LEGACY_SUMMARY_BLOCK_BEGIN = 'HALO_PSA_SYNC_SUMMARY_BEGIN';
const LEGACY_SUMMARY_BLOCK_END = 'HALO_PSA_SYNC_SUMMARY_END';

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
    const provider = extractProviderAttribution(row?.details, normalizedDetails.text);

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
      providerId: provider.providerId,
      providerLabel: provider.providerLabel,
      details: normalizedDetails.text,
      assetsProcessed: Number(row?.assets_processed || 0)
    };
  });
}

function extractProviderAttribution(details, detailsText) {
  let parsed = details;
  if (typeof details === 'string') {
    try { parsed = JSON.parse(details); } catch { parsed = null; }
  }
  const candidates = [
    parsed,
    parsed?.result,
    parsed?.details,
    parsed?.provider,
    parsed?.details?.provider
  ].filter((value) => value && typeof value === 'object');
  let providerId = '';
  let providerLabel = '';
  for (const value of candidates) {
    providerId ||= normalizeProviderId(value.providerId || value.provider?.id || value.id);
    providerLabel ||= normalizeProviderLabel(value.providerLabel || value.provider?.label || value.label);
  }
  const text = String(detailsText || '');
  if (!providerId) providerId = normalizeProviderId(readLineValue(text, 'providerId'));
  if (!providerLabel) providerLabel = normalizeProviderLabel(readLineValue(text, 'providerLabel'));
  if (!providerLabel && providerId === 'connectwise-psa') providerLabel = 'ConnectWise PSA';
  return { providerId, providerLabel: providerLabel || 'Provider not recorded' };
}

function readLineValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp(`(?:^|\\r?\\n)${escaped}\\s*:\\s*([^\\r\\n]{1,160})`, 'i'));
  return match?.[1]?.trim() || '';
}

function normalizeProviderId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? id : '';
}

function normalizeProviderLabel(value) {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label || label.length > 80 || /[\r\n]|(?:secret|token|password|authorization|bearer)/i.test(label)) return '';
  return label;
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

  const begin = text.includes(SUMMARY_BLOCK_BEGIN) ? SUMMARY_BLOCK_BEGIN : LEGACY_SUMMARY_BLOCK_BEGIN;
  const end = begin === SUMMARY_BLOCK_BEGIN ? SUMMARY_BLOCK_END : LEGACY_SUMMARY_BLOCK_END;
  const startIndex = text.indexOf(begin);
  if (startIndex < 0) {
    return '';
  }

  const afterBegin = startIndex + begin.length;
  const endIndex = text.indexOf(end, afterBegin);
  if (endIndex < 0) {
    return '';
  }

  return text.slice(afterBegin, endIndex).trim();
}

function readCountFromText(text, label) {
  const match = String(text || '').match(new RegExp(`(?:^|\\n|\\r)\\s*${label}\\s*[:=]\\s*(\\d+)`, 'i'));
  return match ? Number(match[1]) : 0;
}
