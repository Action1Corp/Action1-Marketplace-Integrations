const { SIGNAL_TYPE_VALUES } = require('./signals');
const { buildCandidateIdentity } = require('./candidateIdentity');
const { normalizeSignalRulesConfig, validateSignalRulesConfigForCandidates } = require('./signalRulesConfig');
const { qualifyEndpointSignals } = require('./signalQualification');

function buildSignalCandidates(input) {
  const normalizedConfig = normalizeSignalRulesConfig(input?.config || {});
  const configErrors = validateSignalRulesConfigForCandidates(normalizedConfig);
  const mappingIndex = buildOrgMappingIndex(normalizedConfig.orgProjectMappings);
  const evaluations = Array.isArray(input?.evaluations) ? input.evaluations : [];

  const candidates = [];
  const skipped = [];

  for (const evaluation of evaluations) {
    const action1OrgId = String(evaluation?.action1OrgId || '').trim();
    const endpoint = evaluation?.endpoint && typeof evaluation.endpoint === 'object' ? evaluation.endpoint : {};
    const endpointId = String(endpoint?.id || endpoint?.endpoint_id || '').trim();
    if (!action1OrgId || !endpointId) {
      skipped.push({ action1OrgId, endpointId, signalType: null, reason: 'invalid_input' });
      continue;
    }

    if (configErrors.length > 0) {
      pushSkippedForSignals(skipped, {
        action1OrgId,
        endpointId,
        signalTypeValues: SIGNAL_TYPE_VALUES,
        reason: 'config_incomplete',
        detail: configErrors.map((row) => row.code).join(',')
      });
      continue;
    }

    const mapping = resolveOrgMapping(mappingIndex, action1OrgId);
    if (!mapping.ok) {
      pushSkippedForSignals(skipped, { action1OrgId, endpointId, signalTypeValues: SIGNAL_TYPE_VALUES, reason: mapping.reason });
      continue;
    }

    const qualificationResults = qualifyEndpointSignals({
      config: normalizedConfig,
      endpoint,
      signals: evaluation?.signals || {},
      now: input?.now
    });

    for (const result of qualificationResults) {
      if (!result.qualifies) {
        if (result.reason === 'signal_disabled') {
          continue;
        }
        skipped.push({
          action1OrgId,
          endpointId,
          signalType: result.signalType,
          reason: 'signal_not_qualified',
          detail: result.reason
        });
        continue;
      }

      const identity = buildCandidateIdentity({
        orgLinkId: mapping.orgLinkId,
        endpointId,
        signalType: result.signalType
      });
      const routing = {
        action1OrgId,
        action1OrgName: asTrimmedString(evaluation?.action1OrgName),
        orgLinkId: mapping.orgLinkId,
        jiraProjectId: mapping.jiraProjectId,
        jiraProjectKey: mapping.jiraProjectKey,
        jiraProjectName: mapping.jiraProjectName,
        jiraIssueTypeId: mapping.jiraIssueTypeId,
        jiraIssueTypeName: mapping.jiraIssueTypeName
      };

      candidates.push({
        ticketModel: 'endpoint',
        identity,
        routing,
        signal: {
          type: result.signalType,
          reason: result.reason,
          matchedCount: result.matchedCount,
          matchedItemsPreview: result.matchedItemsPreview,
          matchedItemsForGrouping: Array.isArray(result.matchedItemsForGrouping) ? result.matchedItemsForGrouping : [],
          details: result.details && typeof result.details === 'object' ? result.details : {}
        },
        endpoint: {
          id: endpointId,
          name: endpoint?.name ? String(endpoint.name) : undefined,
          lastSeenAt: endpoint?.lastSeenAt ? String(endpoint.lastSeenAt) : undefined,
          rebootRequired: endpoint?.rebootRequired === undefined ? undefined : Boolean(endpoint.rebootRequired),
          os: endpoint?.os ? String(endpoint.os) : undefined,
          platform: endpoint?.platform ? String(endpoint.platform) : undefined
        }
      });
    }
  }

  return { candidates, skipped, normalizedConfig };
}

function buildOrgMappingIndex(rows) {
  const orgRows = new Map();
  const invalidOrConflictingOrgs = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const orgId = String(row?.action1OrgId || '').trim();
    const projectId = String(row?.jiraProjectId || '').trim();
    const issueTypeId = String(row?.jiraIssueTypeId || '').trim();
    const mappingId = String(row?.mappingId || '').trim();
    if (!orgId || !projectId || !issueTypeId || !mappingId) {
      if (orgId) invalidOrConflictingOrgs.add(orgId);
      continue;
    }

    if (!orgRows.has(orgId)) orgRows.set(orgId, []);
    orgRows.get(orgId).push({
      orgId,
      projectId,
      mappingId,
      jiraProjectKey: String(row?.jiraProjectKey || '').trim(),
      jiraProjectName: String(row?.jiraProjectName || '').trim(),
      jiraIssueTypeId: issueTypeId,
      jiraIssueTypeName: String(row?.jiraIssueTypeName || '').trim()
    });
  }

  for (const [orgId, orgList] of orgRows.entries()) {
    if (orgList.length !== 1) invalidOrConflictingOrgs.add(orgId);
  }

  const orgResolved = new Map();
  for (const [orgId, orgList] of orgRows.entries()) {
    if (invalidOrConflictingOrgs.has(orgId)) continue;
    const row = orgList[0];
    orgResolved.set(orgId, {
      orgLinkId: row.mappingId,
      jiraProjectId: row.projectId,
      jiraProjectKey: row.jiraProjectKey,
      jiraProjectName: row.jiraProjectName,
      jiraIssueTypeId: row.jiraIssueTypeId,
      jiraIssueTypeName: row.jiraIssueTypeName
    });
  }

  return { orgResolved, invalidOrConflictingOrgs };
}

function resolveOrgMapping(index, action1OrgId) {
  if (!action1OrgId) return { ok: false, reason: 'unmapped_org' };
  if (index.invalidOrConflictingOrgs.has(action1OrgId)) return { ok: false, reason: 'invalid_or_conflicting_mapping' };
  const resolved = index.orgResolved.get(action1OrgId);
  if (!resolved || !resolved.orgLinkId || !resolved.jiraProjectId || !resolved.jiraIssueTypeId) {
    return { ok: false, reason: 'unmapped_org' };
  }
  return { ok: true, ...resolved };
}

function pushSkippedForSignals(skipped, input) {
  for (const signalType of input.signalTypeValues || []) {
    skipped.push({ action1OrgId: input.action1OrgId, endpointId: input.endpointId, signalType, reason: input.reason, detail: input.detail });
  }
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

module.exports = {
  buildOrgMappingIndex,
  buildSignalCandidates
};
