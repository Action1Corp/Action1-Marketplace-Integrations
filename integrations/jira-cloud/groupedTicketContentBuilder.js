const { buildAction1EndpointUrl, buildAction1UpdatesConsoleUrl, getOrigin } = require('./action1ConsoleUrls');
const { buildAdfFromSections } = require('./jiraAdf');
const { formatRemediationStatusLabel } = require('./statusLabelFormatter');

function buildGroupedTicketContentFromCandidate(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === 'object' ? input.candidate : {};
  const signalType = asTrimmedString(candidate?.signal?.type).toUpperCase();
  const grouped = candidate?.grouped && typeof candidate.grouped === 'object' ? candidate.grouped : {};
  const issueMetadata = grouped.issueMetadata && typeof grouped.issueMetadata === 'object' ? grouped.issueMetadata : {};
  const impactedEndpointsSorted = sortImpactedEndpoints(Array.isArray(grouped.impactedEndpoints) ? grouped.impactedEndpoints : []);
  const impactedEndpointCount = toPositiveInt(grouped.impactedEndpointCount, impactedEndpointsSorted.length || 0);
  const visible = impactedEndpointsSorted.slice(0, normalizeVisibleLimit(input.maxImpactedEndpointsInGroupedTicket));
  const problemName = deriveProblemName(signalType, candidate, issueMetadata);
  const summary = `[Action1] ${problemName} - ${signalTitle(signalType)} on ${impactedEndpointCount} endpoints`.slice(0, 240);
  const problemUrl = buildGroupedProblemUrl({
    signalType,
    action1BaseUrl: input.action1BaseUrl,
    action1OrgId: candidate?.routing?.action1OrgId,
    issueMetadata
  });

  const details = [
    'This ticket was created automatically by the Action1 Connector for HaloPSA.',
    '',
    whyLine(signalType),
    `Action1 Organization: ${orDash(candidate?.routing?.action1OrgName)}`,
    ''
  ];
  appendSignalDetails(details, signalType, issueMetadata);
  if (problemUrl) {
    details.push('');
    details.push(`${groupedProblemLinkLabel(signalType)}:`);
    details.push(problemUrl);
  }
  details.push('', `Showing ${visible.length} of ${impactedEndpointCount} impacted endpoints.`, '');
  appendEndpointTable(details, signalType, visible);
  if (impactedEndpointCount > visible.length) details.push('', 'Additional impacted endpoints are available in Action1.');

  const sections = buildAdfSections({
    signalType,
    issueMetadata,
    problemUrl,
    impactedEndpointCount,
    visible,
    action1BaseUrl: input.action1BaseUrl,
    action1OrgId: candidate?.routing?.action1OrgId,
    action1OrgName: candidate?.routing?.action1OrgName
  });

  return {
    summary,
    details: details.join('\n'),
    descriptionAdf: buildAdfFromSections(sections),
    problemUrl,
    impactedEndpointCount,
    visibleImpactedEndpoints: visible.map(toVisibleEndpointForHash),
    sections
  };
}

function buildGroupedPayloadHashInput(input = {}) {
  const candidate = input?.candidate && typeof input.candidate === 'object' ? input.candidate : {};
  const identity = candidate?.identity && typeof candidate.identity === 'object' ? candidate.identity : {};
  const content = buildGroupedTicketContentFromCandidate(input);
  return {
    mode: 'grouped',
    identityKey: asTrimmedString(identity.identityKey),
    orgLinkId: asTrimmedString(identity.orgLinkId),
    signalType: asTrimmedString(identity.signalType || candidate?.signal?.type),
    issueKey: asTrimmedString(candidate?.issueKey || candidate?.grouped?.issueKey),
    impactedEndpointCount: Number(content.impactedEndpointCount || 0),
    visibleImpactedEndpoints: content.visibleImpactedEndpoints,
    summary: content.summary,
    details: content.details,
    description: content.descriptionAdf
  };
}

function buildAdfSections(input = {}) {
  const signalType = asTrimmedString(input?.signalType).toUpperCase();
  const issueMetadata = input?.issueMetadata && typeof input.issueMetadata === 'object' ? input.issueMetadata : {};
  const visible = Array.isArray(input?.visible) ? input.visible : [];
  const sections = [{
    paragraphs: ['This ticket was created automatically by the Action1 Connector for HaloPSA.']
  }, {
    paragraphs: [
      whyLine(signalType),
      `Action1 Organization: ${orDash(input?.action1OrgName)}`
    ]
  }];

  const detailParagraphs = buildSignalDetailParagraphs(signalType, issueMetadata);
  if (detailParagraphs.length > 0) {
    sections.push({ paragraphs: detailParagraphs });
  }

  if (asTrimmedString(input?.problemUrl)) {
    sections.push({
      heading: groupedProblemLinkLabel(signalType),
      paragraphs: [{ text: 'Open in Action1', href: input.problemUrl }]
    });
  }

  sections.push({
    paragraphs: [`Showing ${visible.length} of ${Number(input?.impactedEndpointCount || 0)} impacted endpoints.`]
  });

  sections.push({
    paragraphs: signalType === 'AUTOMATION_FAILED' ? [] : ['Endpoint  Last Seen'],
    bullets: visible.map((row) => formatVisibleEndpoint(signalType, row, input?.action1BaseUrl, input?.action1OrgId))
  });

  if (Number(input?.impactedEndpointCount || 0) > visible.length) {
    sections.push({
      paragraphs: ['Additional impacted endpoints are available in Action1.']
    });
  }

  return sections;
}

function appendSignalDetails(lines, signalType, issueMetadata) {
  if (signalType === 'VULNERABILITY') {
    pushField(lines, 'CVE', issueMetadata.cveId || issueMetadata.id);
    pushField(lines, 'CVSS', issueMetadata.cvssScore);
    pushField(lines, 'Remediation status', formatRemediationStatusLabel(issueMetadata.remediationStatus));
    pushField(lines, 'Deadline', formatDateOnly(issueMetadata.remediationDeadline || issueMetadata.deadline));
    return;
  }
  if (signalType === 'UPDATE') {
    pushField(lines, 'Update', issueMetadata.packageName || issueMetadata.displayName || issueMetadata.id);
    pushField(lines, 'Vendor', issueMetadata.vendor);
    pushField(lines, 'Version', issueMetadata.version || issueMetadata.versionName);
    pushField(lines, 'Security severity', issueMetadata.severityLabel || issueMetadata.severity);
    pushField(lines, 'SLA status', formatRemediationStatusLabel(issueMetadata.slaStatus || issueMetadata.remediationStatus));
    pushField(lines, 'SLA deadline', formatDateOnly(issueMetadata.slaDeadline || issueMetadata.remediationDeadline));
    return;
  }
  if (signalType === 'AUTOMATION_FAILED') {
    pushField(lines, 'Automation', issueMetadata.automationName || issueMetadata.instanceName);
    pushField(lines, 'Status', issueMetadata.status);
    pushField(lines, 'Started', formatDateTimeMinute(issueMetadata.startedAt || issueMetadata.startTime));
    pushField(lines, 'Ended', formatDateTimeMinute(issueMetadata.endedAt || issueMetadata.endTime));
  }
}

function buildSignalDetailParagraphs(signalType, issueMetadata) {
  const lines = [];
  appendSignalDetails(lines, signalType, issueMetadata);
  return lines;
}

function appendEndpointTable(lines, signalType, visible) {
  if (signalType === 'AUTOMATION_FAILED') {
    for (const row of visible) {
      lines.push(orBlank(row.endpointName || row?.endpoint?.name));
    }
    return;
  }
  lines.push('Endpoint  Last Seen');
  for (const row of visible) {
    lines.push(`${orBlank(row.endpointName || row?.endpoint?.name)}  ${orBlank(formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt))}`);
  }
}

function formatVisibleEndpoint(signalType, row, action1BaseUrl, action1OrgId) {
  const endpointName = asTrimmedString(row.endpointName || row?.endpoint?.name);
  const endpointUrl = buildAction1EndpointUrl(
    action1BaseUrl,
    action1OrgId,
    row.endpointId || row?.endpoint?.id,
    row.endpointName || row?.endpoint?.name
  );

  if (signalType === 'AUTOMATION_FAILED') {
    return endpointUrl ? [{ text: endpointName, href: endpointUrl }] : [{ text: endpointName }];
  }

  return [
    endpointUrl ? { text: endpointName, href: endpointUrl } : { text: endpointName },
    { text: ` | ${orBlank(formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt))}` }
  ];
}

function buildGroupedProblemUrl(input) {
  const signalType = asTrimmedString(input?.signalType).toUpperCase();
  const issue = input?.issueMetadata && typeof input.issueMetadata === 'object' ? input.issueMetadata : {};
  const org = asTrimmedString(input?.action1OrgId);
  const origin = getOrigin(input?.action1BaseUrl);
  if (!origin || !org) return '';
  if (signalType === 'VULNERABILITY') {
    const cveId = asTrimmedString(issue.cveId || issue.id);
    return cveId ? `${origin}/console/vulnerabilities/${encodeURIComponent(cveId)}/affected_endpoints?org=${encodeURIComponent(org)}` : '';
  }
  if (signalType === 'UPDATE') {
    return buildAction1UpdatesConsoleUrl(input?.action1BaseUrl, org, issue.packageName || issue.displayName || issue.id);
  }
  if (signalType === 'AUTOMATION_FAILED') {
    const automationInstanceId = asTrimmedString(issue.automationInstanceId || issue.instanceId);
    return automationInstanceId ? `${origin}/console/automations/history/${encodeURIComponent(automationInstanceId)}/details?limit=50&from=0&org=${encodeURIComponent(org)}` : '';
  }
  return '';
}

function deriveProblemName(signalType, candidate, issueMetadata) {
  if (signalType === 'VULNERABILITY') return asTrimmedString(issueMetadata.cveId || issueMetadata.id || candidate?.issueKey) || 'Vulnerability';
  if (signalType === 'UPDATE') {
    return [asTrimmedString(issueMetadata.packageName || issueMetadata.displayName), asTrimmedString(issueMetadata.version || issueMetadata.versionName)]
      .filter(Boolean)
      .join(' ') || asTrimmedString(candidate?.issueKey) || 'Missing update';
  }
  if (signalType === 'AUTOMATION_FAILED') return asTrimmedString(issueMetadata.automationName || issueMetadata.instanceName || candidate?.issueKey) || 'Automation run';
  return asTrimmedString(candidate?.issueKey) || 'Issue';
}

function signalTitle(signalType) {
  if (signalType === 'VULNERABILITY') return 'Vulnerability detected';
  if (signalType === 'UPDATE') return 'Missing update detected';
  if (signalType === 'AUTOMATION_FAILED') return 'Automation failures detected';
  return 'Signal detected';
}

function whyLine(signalType) {
  if (signalType === 'VULNERABILITY') return 'A vulnerability matched the configured connector filters.';
  if (signalType === 'UPDATE') return 'A missing update matched the configured connector filters.';
  if (signalType === 'AUTOMATION_FAILED') return 'An Action1 automation run matched the configured connector failure filters.';
  return 'An Action1 signal matched the configured filters.';
}

function groupedProblemLinkLabel(signalType) {
  if (signalType === 'VULNERABILITY') return 'View affected endpoints in Action1';
  if (signalType === 'UPDATE') return 'View missing update in Action1';
  if (signalType === 'AUTOMATION_FAILED') return 'View automation run in Action1';
  return 'View in Action1';
}

function pushField(lines, label, value) {
  const text = asTrimmedString(value);
  if (text) lines.push(`${label}: ${text}`);
}

function formatDateTimeMinute(raw) {
  const parts = parseDateParts(raw);
  if (!parts) return asTrimmedString(raw);
  if (!parts.hour || !parts.minute) return `${parts.year}-${parts.month}-${parts.day}`;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatDateOnly(raw) {
  const parts = parseDateParts(raw);
  if (!parts) return asTrimmedString(raw);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateParts(raw) {
  const text = asTrimmedString(raw);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ _T](\d{2})[-:](\d{2})(?:[-:](\d{2}))?)?/);
  if (match) {
    return {
      year: match[1],
      month: match[2],
      day: match[3],
      hour: match[4] || null,
      minute: match[5] || null
    };
  }
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
    hour: String(date.getUTCHours()).padStart(2, '0'),
    minute: String(date.getUTCMinutes()).padStart(2, '0')
  };
}

function normalizeVisibleLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 25;
  return Math.min(100, Math.max(1, Math.trunc(number)));
}

function sortImpactedEndpoints(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const nameA = asTrimmedString(a.endpointName || a?.endpoint?.name).toLowerCase();
    const nameB = asTrimmedString(b.endpointName || b?.endpoint?.name).toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return asTrimmedString(a.endpointId || a?.endpoint?.id).localeCompare(asTrimmedString(b.endpointId || b?.endpoint?.id));
  });
}

function toVisibleEndpointForHash(row) {
  return {
    endpointId: asTrimmedString(row.endpointId || row?.endpoint?.id),
    endpointName: asTrimmedString(row.endpointName || row?.endpoint?.name),
    platform: asTrimmedString(row?.endpoint?.platform || row.platform),
    lastSeenAt: formatDateTimeMinute(row?.endpoint?.lastSeenAt || row.lastSeenAt),
    status: asTrimmedString(row.status || row.lastStatus),
    time: formatDateTimeMinute(row.time || row.failureTime || row.endpointResultTime),
    description: asTrimmedString(row.description)
  };
}

function toPositiveInt(value, fallback) {
  const number = Number(value);
  const integer = Math.trunc(number);
  return Number.isFinite(number) && integer > 0 ? integer : fallback;
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

function orBlank(value) {
  return asTrimmedString(value) || '';
}

function orDash(value) {
  return asTrimmedString(value) || '-';
}

module.exports = {
  buildGroupedPayloadHashInput,
  buildGroupedProblemUrl,
  buildGroupedTicketContentFromCandidate
};
