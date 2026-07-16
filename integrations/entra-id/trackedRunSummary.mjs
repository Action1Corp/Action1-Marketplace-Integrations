function normalizeDetailsPayload(details) {
  if (details && typeof details === 'object') {
    return {
      object: details,
      text: ''
    };
  }

  return {
    object: null,
    text: String(details || '').trim()
  };
}

function isStructuredPayloadCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (
    (value.summary && typeof value.summary === 'object') ||
    (value.diagnostics && typeof value.diagnostics === 'object') ||
    Array.isArray(value.results)
  );
}

function getPayloadSummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const nestedSummary = payload?.summary || payload?.details?.summary;
  if (nestedSummary && typeof nestedSummary === 'object') {
    return nestedSummary;
  }

  if (isStructuredPayloadCandidate(payload)) {
    return {};
  }

  return payload;
}

function parseStructuredPayloadCandidate(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isStructuredPayloadCandidate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractStructuredPayload(detailsObject, detailsText) {
  if (detailsObject && typeof detailsObject === 'object') {
    if (isStructuredPayloadCandidate(detailsObject)) {
      return detailsObject;
    }

    if (detailsObject?.details && isStructuredPayloadCandidate(detailsObject.details)) {
      return detailsObject.details;
    }

    const summary = getPayloadSummary(detailsObject);
    if (summary && Object.keys(summary).length > 0) {
      return detailsObject;
    }
  }

  if (!detailsText) {
    return null;
  }

  const directPayload = parseStructuredPayloadCandidate(detailsText);
  if (directPayload) {
    return directPayload;
  }

  const lines = String(detailsText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const directLinePayload = parseStructuredPayloadCandidate(line);
    if (directLinePayload?.summary) {
      return directLinePayload;
    }

    const timestampPrefixedPayload = parseStructuredPayloadCandidate(
      line.match(/^\d{1,2}:\d{2}:\d{2}\s*-\s*(\{.*\})$/)?.[1] || ''
    );
    if (timestampPrefixedPayload?.summary) {
      return timestampPrefixedPayload;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const directLinePayload = parseStructuredPayloadCandidate(line);
    if (directLinePayload) {
      return directLinePayload;
    }

    const timestampPrefixedPayload = parseStructuredPayloadCandidate(
      line.match(/^\d{1,2}:\d{2}:\d{2}\s*-\s*(\{.*\})$/)?.[1] || ''
    );
    if (timestampPrefixedPayload) {
      return timestampPrefixedPayload;
    }
  }

  return null;
}

function extractFinishedTimestamp(payload, summary = {}) {
  const directValue =
    summary?.finishedAt ||
    summary?.completedAt ||
    payload?.finishedAt ||
    payload?.completedAt ||
    payload?.summary?.finishedAt ||
    payload?.summary?.completedAt ||
    payload?.details?.finishedAt ||
    payload?.details?.completedAt ||
    payload?.details?.summary?.finishedAt ||
    payload?.details?.summary?.completedAt;

  if (String(directValue || '').trim()) {
    return String(directValue).trim();
  }

  return '';
}

export function extractTrackedRunPayload(details) {
  const normalized = normalizeDetailsPayload(details);
  const payload = extractStructuredPayload(normalized.object, normalized.text);
  const summary = getPayloadSummary(payload);
  const finishedAt = extractFinishedTimestamp(payload, summary);

  return {
    payload: payload && typeof payload === 'object' ? payload : null,
    summary: summary && typeof summary === 'object' ? summary : {},
    diagnostics: payload?.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : {},
    results: Array.isArray(payload?.results) ? payload.results : [],
    finishedAt
  };
}

export function extractTrackedRunSummary(details) {
  const extracted = extractTrackedRunPayload(details);
  return {
    summary: extracted.summary,
    finishedAt: extracted.finishedAt
  };
}
