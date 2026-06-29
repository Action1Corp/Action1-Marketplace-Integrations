const { buildGroupedPayloadHashInput, buildGroupedTicketContentFromCandidate } = require('./groupedTicketContentBuilder');
const { buildTicketContentFromCandidate } = require('./ticketContentBuilder');

function buildJiraIssuePayload(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === 'object' ? input.candidate : {};
  const routing = candidate?.routing && typeof candidate.routing === 'object' ? candidate.routing : {};
  const projectId = asTrimmedString(routing.jiraProjectId);
  const issueTypeId = asTrimmedString(routing.jiraIssueTypeId);
  if (!projectId) throw new Error('jira_issue_payload_missing_project_id');
  if (!issueTypeId) throw new Error('jira_issue_payload_missing_issue_type_id');

  const content = candidate?.ticketModel === 'grouped'
    ? buildGroupedTicketContentFromCandidate(input)
    : buildTicketContentFromCandidate(input);

  const summary = asTrimmedString(content?.summary);
  if (!summary) throw new Error('jira_issue_payload_missing_summary');
  if (!content?.descriptionAdf || typeof content.descriptionAdf !== 'object') {
    throw new Error('jira_issue_payload_missing_description_adf');
  }

  const payload = {
    fields: {
      project: { id: projectId },
      issuetype: { id: issueTypeId },
      summary,
      description: content.descriptionAdf,
      labels: buildNormalizedLabels(candidate)
    }
  };

  return {
    payload,
    summary,
    details: asTrimmedString(content?.details),
    descriptionAdf: content.descriptionAdf,
    labels: payload.fields.labels,
    normalizedPayload: payload,
    payloadHash: hashPayload(payload),
    content
  };
}

function buildNormalizedLabels(candidate) {
  const labels = buildCandidateLabels(candidate);

  const normalized = [];
  const seen = new Set();
  for (const value of labels) {
    const label = normalizeCandidateLabel(value);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    normalized.push(label);
  }
  return normalized.sort(compareLabels);
}

function buildCandidateLabels(candidate) {
  const signalType = asTrimmedString(candidate?.signal?.type).toUpperCase();
  const labels = [
    'action1',
    `action1-org-${slugifyOrgLabel(candidate?.routing?.action1OrgName)}`,
    signalSpecificLabel(signalType),
    ...severityLabelsForCandidate(candidate, signalType),
    ...rawCveLabelsForCandidate(candidate, signalType)
  ];
  return labels.filter(Boolean);
}

function signalSpecificLabel(signalType) {
  const normalized = asTrimmedString(signalType).toUpperCase();
  if (normalized === 'OFFLINE') return 'action1-offline';
  if (normalized === 'REBOOT_REQUIRED') return 'action1-reboot-required';
  if (normalized === 'VULNERABILITY') return 'action1-vulnerabilities';
  if (normalized === 'UPDATE') return 'action1-updates';
  if (normalized === 'AUTOMATION_FAILED') return 'action1-automation-failures';
  return 'action1-signal';
}

function severityLabelsForCandidate(candidate, signalType) {
  if (signalType === 'VULNERABILITY') {
    const severities = collectNormalizedVulnerabilitySeverities(candidate);
    return severities.map((severity) => `action1-vuln-${severity.toLowerCase()}`);
  }
  if (signalType === 'UPDATE') {
    const severities = collectNormalizedUpdateSeverities(candidate);
    return severities.map((severity) => `action1-update-${severity.toLowerCase()}`);
  }
  return [];
}

function collectNormalizedVulnerabilitySeverities(candidate) {
  const fromCounts = Object.keys(candidate?.signal?.details?.severityCounts || {}).map((value) => normalizeVulnerabilitySeverity(value));
  const fromMatches = collectPreviewItems(candidate).map((item) => normalizeVulnerabilitySeverity(item?.severity || item?.severityLabel));
  const grouped = candidate?.ticketModel === 'grouped'
    ? [normalizeVulnerabilitySeverity(candidate?.grouped?.issueMetadata?.severity || candidate?.grouped?.issueMetadata?.severityLabel)]
    : [];
  return collectUniqueKnownSeverities([...fromCounts, ...fromMatches, ...grouped], ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], 'UNKNOWN');
}

function collectNormalizedUpdateSeverities(candidate) {
  const fromCounts = Object.keys(candidate?.signal?.details?.severityCounts || {}).map((value) => normalizeUpdateSeverity(value));
  const fromMatches = collectPreviewItems(candidate).map((item) => normalizeUpdateSeverity(item?.severity || item?.severityLabel));
  const grouped = candidate?.ticketModel === 'grouped'
    ? [normalizeUpdateSeverity(candidate?.grouped?.issueMetadata?.severity || candidate?.grouped?.issueMetadata?.severityLabel)]
    : [];
  return collectUniqueKnownSeverities([...fromCounts, ...fromMatches, ...grouped], ['CRITICAL', 'IMPORTANT', 'MODERATE', 'LOW'], 'UNKNOWN');
}

function collectPreviewItems(candidate) {
  return Array.isArray(candidate?.signal?.matchedItemsPreview) ? candidate.signal.matchedItemsPreview : [];
}

function collectUniqueKnownSeverities(values, allowed, fallback) {
  const allowSet = new Set(allowed);
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = asTrimmedString(value).toUpperCase();
    if (!normalized || !allowSet.has(normalized) || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out.length > 0 ? out : [fallback];
}

function rawCveLabelsForCandidate(candidate, signalType) {
  if (signalType !== 'VULNERABILITY' || candidate?.ticketModel !== 'grouped') {
    return [];
  }
  const normalized = normalizeCveLabel(
    candidate?.grouped?.issueMetadata?.cveId ||
    candidate?.grouped?.issueMetadata?.id ||
    candidate?.issueKey ||
    candidate?.grouped?.issueKey
  );
  return normalized ? [normalized] : [];
}

function normalizeCandidateLabel(value) {
  const raw = asTrimmedString(value);
  if (!raw) return '';
  const cveLabel = normalizeCveLabel(raw);
  if (cveLabel) return cveLabel;
  return normalizeLabel(raw);
}

function normalizeLabel(value) {
  const label = asTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return label.slice(0, 255);
}

function slugifyOrgLabel(value) {
  const label = asTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return label || 'unknown';
}

function normalizeVulnerabilitySeverity(value) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === 'CRITICAL') return 'CRITICAL';
  if (normalized === 'HIGH') return 'HIGH';
  if (normalized === 'MEDIUM') return 'MEDIUM';
  if (normalized === 'LOW') return 'LOW';
  return '';
}

function normalizeUpdateSeverity(value) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === 'CRITICAL') return 'CRITICAL';
  if (normalized === 'IMPORTANT') return 'IMPORTANT';
  if (normalized === 'MODERATE') return 'MODERATE';
  if (normalized === 'LOW') return 'LOW';
  return '';
}

function normalizeCveLabel(value) {
  const normalized = asTrimmedString(value).toUpperCase();
  return /^CVE-\d{4}-\d{4,}$/i.test(normalized) ? normalized : '';
}

function compareLabels(a, b) {
  const lowerCompare = String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
  return lowerCompare || String(a || '').localeCompare(String(b || ''));
}

function hashPayload(payload) {
  return stableStringify(payload);
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function buildPayloadHashInput(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === 'object' ? input.candidate : {};
  if (candidate?.ticketModel === 'grouped') {
    return buildGroupedPayloadHashInput(input);
  }
  const content = buildTicketContentFromCandidate(input);
  return {
    mode: 'endpoint',
    identityKey: asTrimmedString(candidate?.identity?.key),
    orgLinkId: asTrimmedString(candidate?.identity?.orgLinkId),
    endpointId: asTrimmedString(candidate?.identity?.endpointId || candidate?.endpoint?.id),
    signalType: asTrimmedString(candidate?.identity?.signalType || candidate?.signal?.type),
    summary: content.summary,
    details: content.details,
    description: content.descriptionAdf
  };
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

module.exports = {
  buildJiraIssuePayload,
  buildNormalizedLabels,
  buildPayloadHashInput,
  hashPayload,
  normalizeLabel,
  stableStringify
};
