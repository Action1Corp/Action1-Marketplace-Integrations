const GROUPED_SIGNALS = new Set(['VULNERABILITY', 'UPDATE', 'AUTOMATION_FAILED']);

function buildGroupedCandidateIdentity(input = {}) {
  const orgLinkId = asTrimmedString(input.orgLinkId);
  const signalType = asTrimmedString(input.signalType).toUpperCase();
  const issue = input.issue && typeof input.issue === 'object' ? input.issue : {};

  if (!orgLinkId) return { ok: false, reason: 'missing_org_link_id' };
  if (!GROUPED_SIGNALS.has(signalType)) return { ok: false, reason: 'unsupported_signal_type' };

  if (signalType === 'VULNERABILITY') {
    const cveId = asTrimmedString(issue.cveId || issue.id);
    if (!cveId) return { ok: false, reason: 'missing_cve_id' };
    return buildIdentity(orgLinkId, 'VULNERABILITY', cveId);
  }

  if (signalType === 'UPDATE') {
    const packageId = asTrimmedString(issue.packageId);
    const versionId = asTrimmedString(issue.versionId);
    if (!packageId || !versionId) return { ok: false, reason: 'missing_package_or_version_id' };
    return buildIdentity(orgLinkId, 'UPDATE', `${packageId}:${versionId}`);
  }

  const automationInstanceId = asTrimmedString(issue.automationInstanceId || issue.instanceId);
  if (!automationInstanceId) return { ok: false, reason: 'missing_automation_instance_id' };
  return buildIdentity(orgLinkId, 'AUTOMATION_FAILED', automationInstanceId);
}

function buildIdentity(orgLinkId, signalType, issueKey) {
  return {
    ok: true,
    issueKey,
    identityKey: `${orgLinkId}|${signalType}|${issueKey}`,
    identity: {
      orgLinkId,
      signalType,
      issueKey,
      key: `${orgLinkId}|${signalType}|${issueKey}`
    }
  };
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

module.exports = {
  GROUPED_SIGNALS,
  buildGroupedCandidateIdentity
};
