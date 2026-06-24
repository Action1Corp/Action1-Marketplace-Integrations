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
  const problemUrl = buildGroupedProblemUrl({ signalType, action1BaseUrl: input.action1BaseUrl, action1OrgId: candidate?.routing?.action1OrgId, issueMetadata });

  const details = ['This ticket was created automatically by the Action1 Connector for HaloPSA.', '', whyLine(signalType), `Action1 Organization: ${orDash(candidate?.routing?.action1OrgName)}`, ''];
  appendSignalDetails(details, signalType, issueMetadata);
  if (problemUrl) {
    details.push('');
    details.push(`${groupedProblemLinkLabel(signalType)}:`);
    details.push(problemUrl);
  }
  details.push('', `Showing ${visible.length} of ${impactedEndpointCount} impacted endpoints.`, '');
  appendEndpointTable(details, signalType, visible);
  if (impactedEndpointCount > visible.length) details.push('', 'Additional impacted endpoints are available in Action1.');

  return {
    summary,
    details: details.join('\n'),
    detailsHtml: buildGroupedDetailsHtml({
      signalType,
      issueMetadata,
      problemUrl,
      impactedEndpointCount,
      visible,
      action1BaseUrl: input.action1BaseUrl,
      action1OrgId: candidate?.routing?.action1OrgId,
      action1OrgName: candidate?.routing?.action1OrgName
    }),
    problemUrl,
    impactedEndpointCount,
    visibleImpactedEndpoints: visible.map(toVisibleEndpointForHash)
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
    details_html: content.detailsHtml
  };
}

function appendSignalDetails(lines, signalType, issueMetadata) {
  if (signalType === 'VULNERABILITY') {
    pushField(lines, 'CVE', issueMetadata.cveId || issueMetadata.id);
    pushField(lines, 'CVSS', issueMetadata.cvssScore);
    pushField(lines, 'Remediation status', issueMetadata.remediationStatus);
    pushField(lines, 'Deadline', issueMetadata.remediationDeadline || issueMetadata.deadline);
    return;
  }
  if (signalType === 'UPDATE') {
    pushField(lines, 'Update', issueMetadata.packageName || issueMetadata.displayName || issueMetadata.id);
    pushField(lines, 'Vendor', issueMetadata.vendor);
    pushField(lines, 'Version', issueMetadata.version || issueMetadata.versionName);
    pushField(lines, 'Security severity', issueMetadata.severityLabel || issueMetadata.severity);
    pushField(lines, 'SLA status', issueMetadata.slaStatus || issueMetadata.remediationStatus);
    pushField(lines, 'SLA deadline', issueMetadata.slaDeadline || issueMetadata.remediationDeadline);
    return;
  }
  if (signalType === 'AUTOMATION_FAILED') {
    pushField(lines, 'Automation', issueMetadata.automationName || issueMetadata.instanceName);
    pushField(lines, 'Status', issueMetadata.status);
    pushField(lines, 'Started', issueMetadata.startedAt || issueMetadata.startTime);
    pushField(lines, 'Ended', issueMetadata.endedAt || issueMetadata.endTime);
  }
}

function appendEndpointTable(lines, signalType, visible) {
  if (signalType === 'AUTOMATION_FAILED') {
    lines.push('Endpoint  Status  Time  Description');
    for (const row of visible) lines.push(`${orBlank(row.endpointName || row?.endpoint?.name)}  ${orBlank(row.status || row?.lastStatus)}  ${orBlank(row.time || row.failureTime || row?.endpointResultTime)}  ${asTrimmedString(row.description || row?.endpoint?.description)}`);
    return;
  }
  lines.push('Endpoint  Last Seen');
  for (const row of visible) lines.push(`${orBlank(row.endpointName || row?.endpoint?.name)}  ${orBlank(row?.endpoint?.lastSeenAt || row.lastSeenAt)}`);
}

function buildGroupedProblemUrl(input) {
  const signalType = asTrimmedString(input?.signalType).toUpperCase();
  const origin = getOrigin(input?.action1BaseUrl);
  const org = asTrimmedString(input?.action1OrgId);
  const issue = input?.issueMetadata && typeof input.issueMetadata === 'object' ? input.issueMetadata : {};
  if (!origin || !org) return '';
  if (signalType === 'VULNERABILITY') {
    const cveId = asTrimmedString(issue.cveId || issue.id);
    return cveId ? `${origin}/console/vulnerabilities/${encodeURIComponent(cveId)}/affected_endpoints?org=${encodeURIComponent(org)}` : '';
  }
  if (signalType === 'UPDATE') {
    const packageId = asTrimmedString(issue.packageId);
    const versionSegment = asTrimmedString(issue.version || issue.versionName || issue.versionId);
    return packageId && versionSegment ? `${origin}/console/updates/${encodeURIComponent(packageId)}~${encodeURIComponent(versionSegment)}/endpoints?limit=50&from=0&only_latest=no&org=${encodeURIComponent(org)}` : '';
  }
  if (signalType === 'AUTOMATION_FAILED') {
    const automationInstanceId = asTrimmedString(issue.automationInstanceId || issue.instanceId);
    return automationInstanceId ? `${origin}/console/automations/history/${encodeURIComponent(automationInstanceId)}/details?limit=50&from=0&org=${encodeURIComponent(org)}` : '';
  }
  return '';
}

function buildAction1EndpointUrl(apiBaseUrl, orgId, endpointId, endpointName) {
  const origin = getOrigin(apiBaseUrl);
  const org = asTrimmedString(orgId);
  const endpoint = asTrimmedString(endpointId);
  const filterValue = asTrimmedString(endpointName) || endpoint;
  if (!origin || !org || !filterValue) return '';
  return `${origin}/console/endpoints?limit=20&from=0&org=${encodeURIComponent(org)}&filter=${encodeURIComponent(filterValue)}`;
}

function getOrigin(baseUrl) {
  try {
    const u = new URL(String(baseUrl || ''));
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function deriveProblemName(signalType, candidate, issueMetadata) {
  if (signalType === 'VULNERABILITY') return asTrimmedString(issueMetadata.cveId || issueMetadata.id || candidate?.issueKey) || 'Vulnerability';
  if (signalType === 'UPDATE') return [asTrimmedString(issueMetadata.packageName || issueMetadata.displayName), asTrimmedString(issueMetadata.version || issueMetadata.versionName)].filter(Boolean).join(' ') || asTrimmedString(candidate?.issueKey) || 'Missing update';
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
  const s = asTrimmedString(value);
  if (s) lines.push(`${label}: ${s}`);
}

function normalizeVisibleLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 25;
  return Math.min(100, Math.max(1, Math.trunc(n)));
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
    lastSeenAt: asTrimmedString(row?.endpoint?.lastSeenAt || row.lastSeenAt),
    status: asTrimmedString(row.status || row.lastStatus),
    time: asTrimmedString(row.time || row.failureTime || row.endpointResultTime),
    description: asTrimmedString(row.description)
  };
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  const i = Math.trunc(n);
  return Number.isFinite(n) && i > 0 ? i : fallback;
}

function buildGroupedDetailsHtml(input = {}) {
  const signalType = asTrimmedString(input?.signalType).toUpperCase();
  const issueMetadata = input?.issueMetadata && typeof input.issueMetadata === 'object' ? input.issueMetadata : {};
  const problemUrl = asTrimmedString(input?.problemUrl);
  const impactedEndpointCount = Number(input?.impactedEndpointCount || 0);
  const visible = Array.isArray(input?.visible) ? input.visible : [];
  const action1BaseUrl = input?.action1BaseUrl;
  const action1OrgId = input?.action1OrgId;

  const out = [];
  out.push('This ticket was created automatically by the Action1 Connector for HaloPSA.<br><br>');
  out.push(`${escapeHtml(whyLine(signalType))}<br><br>`);
  out.push(`<strong>Action1 Organization:</strong> ${escapeHtml(orDash(input?.action1OrgName))}<br><br>`);
  appendSignalDetailsHtml(out, signalType, issueMetadata);
  if (problemUrl) {
    out.push(`<a href="${escapeHtmlAttr(problemUrl)}">${escapeHtml(groupedProblemLinkLabel(signalType))}</a><br>`);
  }
  out.push('<br>');
  out.push(`Showing ${visible.length} of ${impactedEndpointCount} impacted endpoints.<br><br>`);
  out.push(buildImpactedEndpointsTableHtml(signalType, visible, action1BaseUrl, action1OrgId));
  if (impactedEndpointCount > visible.length) out.push('<br>Additional impacted endpoints are available in Action1.');
  return out.join('');
}

function appendSignalDetailsHtml(out, signalType, issueMetadata) {
  const pairs = [];
  if (signalType === 'VULNERABILITY') {
    pairs.push(['CVE', issueMetadata.cveId || issueMetadata.id]);
    pairs.push(['CVSS', issueMetadata.cvssScore]);
    pairs.push(['Remediation status', issueMetadata.remediationStatus]);
    pairs.push(['Deadline', issueMetadata.remediationDeadline || issueMetadata.deadline]);
  } else if (signalType === 'UPDATE') {
    pairs.push(['Update', issueMetadata.packageName || issueMetadata.displayName || issueMetadata.id]);
    pairs.push(['Vendor', issueMetadata.vendor]);
    pairs.push(['Version', issueMetadata.version || issueMetadata.versionName]);
    pairs.push(['Security severity', issueMetadata.severityLabel || issueMetadata.severity]);
    pairs.push(['SLA status', issueMetadata.slaStatus || issueMetadata.remediationStatus]);
    pairs.push(['SLA deadline', issueMetadata.slaDeadline || issueMetadata.remediationDeadline]);
  } else if (signalType === 'AUTOMATION_FAILED') {
    pairs.push(['Automation', issueMetadata.automationName || issueMetadata.instanceName]);
    pairs.push(['Status', issueMetadata.status]);
    pairs.push(['Started', issueMetadata.startedAt || issueMetadata.startTime]);
    pairs.push(['Ended', issueMetadata.endedAt || issueMetadata.endTime]);
  }

  for (const [label, value] of pairs) {
    const v = asTrimmedString(value);
    if (!v) continue;
    out.push(`<strong>${escapeHtml(label)}:</strong> ${escapeHtml(v)}<br>`);
  }
  out.push('<br>');
}

function buildImpactedEndpointsTableHtml(signalType, visible, action1BaseUrl, action1OrgId) {
  if (signalType === 'AUTOMATION_FAILED') {
    const lines = ['Endpoint  Status  Time  Description'];
    for (const row of visible) {
      const endpointName = asTrimmedString(row.endpointName || row?.endpoint?.name);
      const endpointUrl = buildAction1EndpointUrl(
        action1BaseUrl,
        action1OrgId,
        row.endpointId || row?.endpoint?.id,
        row.endpointName || row?.endpoint?.name
      );
      const endpointCell = endpointUrl ? `<a href="${escapeHtmlAttr(endpointUrl)}">${escapeHtml(endpointName)}</a>` : escapeHtml(endpointName);
      const status = escapeHtml(asTrimmedString(row.status || row?.lastStatus));
      const time = escapeHtml(asTrimmedString(row.time || row.failureTime || row?.endpointResultTime));
      const description = escapeHtml(asTrimmedString(row.description || row?.endpoint?.description));
      lines.push(`${endpointCell}  ${status}  ${time}  ${description}`);
    }
    return lines.join('<br>');
  }

  const lines = ['Endpoint  Last Seen'];
  for (const row of visible) {
    const endpointName = asTrimmedString(row.endpointName || row?.endpoint?.name);
    const endpointUrl = buildAction1EndpointUrl(
      action1BaseUrl,
      action1OrgId,
      row.endpointId || row?.endpoint?.id,
      row.endpointName || row?.endpoint?.name
    );
    const endpointCell = endpointUrl ? `<a href="${escapeHtmlAttr(endpointUrl)}">${escapeHtml(endpointName)}</a>` : escapeHtml(endpointName);
    const lastSeen = escapeHtml(asTrimmedString(row?.endpoint?.lastSeenAt || row.lastSeenAt));
    lines.push(`${endpointCell}  ${lastSeen}`);
  }
  return lines.join('<br>');
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
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
