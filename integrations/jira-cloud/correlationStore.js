const ENDPOINT_CORRELATIONS_TABLE = 'jira_cloud_endpoint_correlations';
const GROUPED_CORRELATIONS_TABLE = 'jira_cloud_grouped_correlations';
const INTEGRATION_ID = 'jira-cloud';

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

function toOptionalString(value) {
  const out = asTrimmedString(value);
  return out ? out : null;
}

function normalizeEndpointIdentity(input = {}) {
  const orgLinkId = asTrimmedString(input.orgLinkId);
  const endpointId = asTrimmedString(input.endpointId);
  const signalType = asTrimmedString(input.signalType).toUpperCase();

  return {
    orgLinkId,
    endpointId,
    signalType,
    identityKey: orgLinkId && endpointId && signalType ? `${orgLinkId}|${endpointId}|${signalType}` : ''
  };
}

function normalizeGroupedIdentity(input = {}) {
  const orgLinkId = asTrimmedString(input.orgLinkId);
  const signalType = asTrimmedString(input.signalType).toUpperCase();
  const issueKey = asTrimmedString(input.issueKey);

  return {
    orgLinkId,
    signalType,
    issueKey,
    identityKey: orgLinkId && signalType && issueKey ? `${orgLinkId}|${signalType}|${issueKey}` : ''
  };
}

function normalizeEndpointRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    mode: 'endpoint',
    id: row.id ?? null,
    integrationId: asTrimmedString(row.integration_id || INTEGRATION_ID),
    identityKey: asTrimmedString(row.identity_key),
    orgLinkId: asTrimmedString(row.org_link_id),
    action1OrgId: asTrimmedString(row.action1_org_id),
    endpointId: asTrimmedString(row.endpoint_id),
    signalType: asTrimmedString(row.signal_type).toUpperCase(),
    jiraIssueId: asTrimmedString(row.jira_issue_id),
    jiraIssueKey: asTrimmedString(row.jira_issue_key),
    jiraIssueUrl: toOptionalString(row.jira_issue_url),
    linkedIssueId: asTrimmedString(row.jira_issue_id),
    linkedIssueKey: asTrimmedString(row.jira_issue_key),
    linkedIssueUrl: toOptionalString(row.jira_issue_url),
    payloadHash: toOptionalString(row.payload_hash),
    linkedIssueStatus: toOptionalString(row.linked_issue_status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeGroupedRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    mode: 'grouped',
    id: row.id ?? null,
    integrationId: asTrimmedString(row.integration_id || INTEGRATION_ID),
    identityKey: asTrimmedString(row.identity_key),
    orgLinkId: asTrimmedString(row.org_link_id),
    action1OrgId: asTrimmedString(row.action1_org_id),
    signalType: asTrimmedString(row.signal_type).toUpperCase(),
    issueKey: asTrimmedString(row.issue_key),
    jiraIssueId: asTrimmedString(row.jira_issue_id),
    jiraIssueKey: asTrimmedString(row.jira_issue_key),
    jiraIssueUrl: toOptionalString(row.jira_issue_url),
    linkedIssueId: asTrimmedString(row.jira_issue_id),
    linkedIssueKey: asTrimmedString(row.jira_issue_key),
    linkedIssueUrl: toOptionalString(row.jira_issue_url),
    payloadHash: toOptionalString(row.payload_hash),
    linkedIssueStatus: toOptionalString(row.linked_issue_status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeEndpointRecord(input = {}) {
  const identity = normalizeEndpointIdentity(input);
  const jiraIssueId = asTrimmedString(input.jiraIssueId || input.linkedIssueId);
  const jiraIssueKey = asTrimmedString(input.jiraIssueKey || input.linkedIssueKey);

  if (!identity.orgLinkId) throw new Error('endpoint_correlation_org_link_id_required');
  if (!identity.endpointId) throw new Error('endpoint_correlation_endpoint_id_required');
  if (!identity.signalType) throw new Error('endpoint_correlation_signal_type_required');
  if (!jiraIssueId) throw new Error('endpoint_correlation_jira_issue_id_required');
  if (!jiraIssueKey) throw new Error('endpoint_correlation_jira_issue_key_required');

  const createdAt = trimValue(input.createdAt) || new Date().toISOString();
  const updatedAt = trimValue(input.updatedAt) || createdAt;

  return {
    integrationId: asTrimmedString(input.integrationId || INTEGRATION_ID),
    identityKey: identity.identityKey,
    orgLinkId: identity.orgLinkId,
    action1OrgId: asTrimmedString(input.action1OrgId),
    endpointId: identity.endpointId,
    signalType: identity.signalType,
    jiraIssueId,
    jiraIssueKey,
    jiraIssueUrl: toOptionalString(input.jiraIssueUrl || input.linkedIssueUrl),
    payloadHash: toOptionalString(input.payloadHash),
    linkedIssueStatus: toOptionalString(input.linkedIssueStatus || input.statusName || input.ticketStatusName),
    createdAt,
    updatedAt
  };
}

function normalizeGroupedRecord(input = {}) {
  const identity = normalizeGroupedIdentity(input);
  const jiraIssueId = asTrimmedString(input.jiraIssueId || input.linkedIssueId);
  const jiraIssueKey = asTrimmedString(input.jiraIssueKey || input.linkedIssueKey);

  if (!identity.orgLinkId) throw new Error('grouped_correlation_org_link_id_required');
  if (!identity.signalType) throw new Error('grouped_correlation_signal_type_required');
  if (!identity.issueKey) throw new Error('grouped_correlation_issue_key_required');
  if (!jiraIssueId) throw new Error('grouped_correlation_jira_issue_id_required');
  if (!jiraIssueKey) throw new Error('grouped_correlation_jira_issue_key_required');

  const createdAt = trimValue(input.createdAt) || new Date().toISOString();
  const updatedAt = trimValue(input.updatedAt) || createdAt;

  return {
    integrationId: asTrimmedString(input.integrationId || INTEGRATION_ID),
    identityKey: asTrimmedString(input.identityKey) || identity.identityKey,
    orgLinkId: identity.orgLinkId,
    action1OrgId: asTrimmedString(input.action1OrgId),
    signalType: identity.signalType,
    issueKey: identity.issueKey,
    jiraIssueId,
    jiraIssueKey,
    jiraIssueUrl: toOptionalString(input.jiraIssueUrl || input.linkedIssueUrl),
    payloadHash: toOptionalString(input.payloadHash),
    linkedIssueStatus: toOptionalString(input.linkedIssueStatus || input.statusName || input.ticketStatusName),
    createdAt,
    updatedAt
  };
}

async function getEndpointCorrelation(context, orgLinkId, endpointId, signalType) {
  const identity = normalizeEndpointIdentity({ orgLinkId, endpointId, signalType });
  if (!identity.orgLinkId || !identity.endpointId || !identity.signalType) {
    return null;
  }

  const row = await context.db.get(
    `SELECT id, integration_id, identity_key, org_link_id, action1_org_id, endpoint_id, signal_type, jira_issue_id, jira_issue_key, jira_issue_url, payload_hash, linked_issue_status, created_at, updated_at
       FROM ${ENDPOINT_CORRELATIONS_TABLE}
      WHERE org_link_id = ?
        AND endpoint_id = ?
        AND signal_type = ?`,
    [identity.orgLinkId, identity.endpointId, identity.signalType]
  );

  return normalizeEndpointRow(row);
}

async function upsertEndpointCorrelation(context, record) {
  const normalized = normalizeEndpointRecord(record);
  const existing = await getEndpointCorrelation(context, normalized.orgLinkId, normalized.endpointId, normalized.signalType);

  if (existing) {
    await context.db.run(
      `UPDATE ${ENDPOINT_CORRELATIONS_TABLE}
          SET integration_id = ?,
              identity_key = ?,
              action1_org_id = ?,
              jira_issue_id = ?,
              jira_issue_key = ?,
              jira_issue_url = ?,
              payload_hash = ?,
              linked_issue_status = ?,
              created_at = ?,
              updated_at = ?
        WHERE org_link_id = ?
          AND endpoint_id = ?
          AND signal_type = ?`,
      [
        normalized.integrationId,
        normalized.identityKey,
        normalized.action1OrgId,
        normalized.jiraIssueId,
        normalized.jiraIssueKey,
        normalized.jiraIssueUrl,
        normalized.payloadHash,
        normalized.linkedIssueStatus,
        existing.createdAt || normalized.createdAt,
        normalized.updatedAt,
        normalized.orgLinkId,
        normalized.endpointId,
        normalized.signalType
      ]
    );
  } else {
    await context.db.run(
      `INSERT INTO ${ENDPOINT_CORRELATIONS_TABLE} (
         integration_id,
         identity_key,
         org_link_id,
         action1_org_id,
         endpoint_id,
         signal_type,
         jira_issue_id,
         jira_issue_key,
         jira_issue_url,
         payload_hash,
         linked_issue_status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalized.integrationId,
        normalized.identityKey,
        normalized.orgLinkId,
        normalized.action1OrgId,
        normalized.endpointId,
        normalized.signalType,
        normalized.jiraIssueId,
        normalized.jiraIssueKey,
        normalized.jiraIssueUrl,
        normalized.payloadHash,
        normalized.linkedIssueStatus,
        normalized.createdAt,
        normalized.updatedAt
      ]
    );
  }

  return getEndpointCorrelation(context, normalized.orgLinkId, normalized.endpointId, normalized.signalType);
}

async function deleteEndpointCorrelation(context, orgLinkId, endpointId, signalType) {
  const identity = normalizeEndpointIdentity({ orgLinkId, endpointId, signalType });
  if (!identity.orgLinkId || !identity.endpointId || !identity.signalType) {
    return;
  }

  await context.db.run(
    `DELETE FROM ${ENDPOINT_CORRELATIONS_TABLE}
      WHERE org_link_id = ?
        AND endpoint_id = ?
        AND signal_type = ?`,
    [identity.orgLinkId, identity.endpointId, identity.signalType]
  );
}

async function listEndpointCorrelationsByOrgLink(context, orgLinkId) {
  const key = asTrimmedString(orgLinkId);
  if (!key) {
    return [];
  }

  const rows = await context.db.all(
    `SELECT id, integration_id, identity_key, org_link_id, action1_org_id, endpoint_id, signal_type, jira_issue_id, jira_issue_key, jira_issue_url, payload_hash, linked_issue_status, created_at, updated_at
       FROM ${ENDPOINT_CORRELATIONS_TABLE}
      WHERE org_link_id = ?
      ORDER BY signal_type ASC, endpoint_id ASC, id ASC`,
    [key]
  );

  return (Array.isArray(rows) ? rows : []).map(normalizeEndpointRow).filter(Boolean);
}

async function getGroupedCorrelation(context, orgLinkId, signalType, issueKey) {
  const identity = normalizeGroupedIdentity({ orgLinkId, signalType, issueKey });
  if (!identity.orgLinkId || !identity.signalType || !identity.issueKey) {
    return null;
  }

  const row = await context.db.get(
    `SELECT id, integration_id, identity_key, org_link_id, action1_org_id, signal_type, issue_key, jira_issue_id, jira_issue_key, jira_issue_url, payload_hash, linked_issue_status, created_at, updated_at
       FROM ${GROUPED_CORRELATIONS_TABLE}
      WHERE org_link_id = ?
        AND signal_type = ?
        AND issue_key = ?`,
    [identity.orgLinkId, identity.signalType, identity.issueKey]
  );

  return normalizeGroupedRow(row);
}

async function upsertGroupedCorrelation(context, record) {
  const normalized = normalizeGroupedRecord(record);
  const existing = await getGroupedCorrelation(context, normalized.orgLinkId, normalized.signalType, normalized.issueKey);

  if (existing) {
    await context.db.run(
      `UPDATE ${GROUPED_CORRELATIONS_TABLE}
          SET integration_id = ?,
              identity_key = ?,
              action1_org_id = ?,
              jira_issue_id = ?,
              jira_issue_key = ?,
              jira_issue_url = ?,
              payload_hash = ?,
              linked_issue_status = ?,
              created_at = ?,
              updated_at = ?
        WHERE org_link_id = ?
          AND signal_type = ?
          AND issue_key = ?`,
      [
        normalized.integrationId,
        normalized.identityKey,
        normalized.action1OrgId,
        normalized.jiraIssueId,
        normalized.jiraIssueKey,
        normalized.jiraIssueUrl,
        normalized.payloadHash,
        normalized.linkedIssueStatus,
        existing.createdAt || normalized.createdAt,
        normalized.updatedAt,
        normalized.orgLinkId,
        normalized.signalType,
        normalized.issueKey
      ]
    );
  } else {
    await context.db.run(
      `INSERT INTO ${GROUPED_CORRELATIONS_TABLE} (
         integration_id,
         identity_key,
         org_link_id,
         action1_org_id,
         signal_type,
         issue_key,
         jira_issue_id,
         jira_issue_key,
         jira_issue_url,
         payload_hash,
         linked_issue_status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalized.integrationId,
        normalized.identityKey,
        normalized.orgLinkId,
        normalized.action1OrgId,
        normalized.signalType,
        normalized.issueKey,
        normalized.jiraIssueId,
        normalized.jiraIssueKey,
        normalized.jiraIssueUrl,
        normalized.payloadHash,
        normalized.linkedIssueStatus,
        normalized.createdAt,
        normalized.updatedAt
      ]
    );
  }

  return getGroupedCorrelation(context, normalized.orgLinkId, normalized.signalType, normalized.issueKey);
}

async function deleteGroupedCorrelation(context, orgLinkId, signalType, issueKey) {
  const identity = normalizeGroupedIdentity({ orgLinkId, signalType, issueKey });
  if (!identity.orgLinkId || !identity.signalType || !identity.issueKey) {
    return;
  }

  await context.db.run(
    `DELETE FROM ${GROUPED_CORRELATIONS_TABLE}
      WHERE org_link_id = ?
        AND signal_type = ?
        AND issue_key = ?`,
    [identity.orgLinkId, identity.signalType, identity.issueKey]
  );
}

async function listGroupedCorrelationsByOrgLink(context, orgLinkId) {
  const key = asTrimmedString(orgLinkId);
  if (!key) {
    return [];
  }

  const rows = await context.db.all(
    `SELECT id, integration_id, identity_key, org_link_id, action1_org_id, signal_type, issue_key, jira_issue_id, jira_issue_key, jira_issue_url, payload_hash, linked_issue_status, created_at, updated_at
       FROM ${GROUPED_CORRELATIONS_TABLE}
      WHERE org_link_id = ?
      ORDER BY signal_type ASC, issue_key ASC, id ASC`,
    [key]
  );

  return (Array.isArray(rows) ? rows : []).map(normalizeGroupedRow).filter(Boolean);
}

function createDbCorrelationStore(context) {
  return {
    getEndpointCorrelation: (orgLinkId, endpointId, signalType) =>
      getEndpointCorrelation(context, orgLinkId, endpointId, signalType),
    upsertEndpointCorrelation: (record) => upsertEndpointCorrelation(context, record),
    deleteEndpointCorrelation: (orgLinkId, endpointId, signalType) =>
      deleteEndpointCorrelation(context, orgLinkId, endpointId, signalType),
    listEndpointCorrelationsByOrgLink: (orgLinkId) => listEndpointCorrelationsByOrgLink(context, orgLinkId),
    getGroupedCorrelation: (orgLinkId, signalType, issueKey) =>
      getGroupedCorrelation(context, orgLinkId, signalType, issueKey),
    upsertGroupedCorrelation: (record) => upsertGroupedCorrelation(context, record),
    deleteGroupedCorrelation: (orgLinkId, signalType, issueKey) =>
      deleteGroupedCorrelation(context, orgLinkId, signalType, issueKey),
    listGroupedCorrelationsByOrgLink: (orgLinkId) => listGroupedCorrelationsByOrgLink(context, orgLinkId),
    getCorrelation: (orgLinkId, endpointId, signalType) =>
      getEndpointCorrelation(context, orgLinkId, endpointId, signalType),
    upsertCorrelation: (record) => upsertEndpointCorrelation(context, record),
    deleteCorrelation: (orgLinkId, endpointId, signalType) =>
      deleteEndpointCorrelation(context, orgLinkId, endpointId, signalType),
    listCorrelationsByOrgLink: async (orgLinkId, opts = {}) => {
      const endpointRows = await listEndpointCorrelationsByOrgLink(context, orgLinkId);
      if (!opts || opts.includeGrouped !== true) {
        return endpointRows;
      }

      const groupedRows = await listGroupedCorrelationsByOrgLink(context, orgLinkId);
      return endpointRows.concat(groupedRows);
    }
  };
}

module.exports = {
  ENDPOINT_CORRELATIONS_TABLE,
  GROUPED_CORRELATIONS_TABLE,
  createDbCorrelationStore,
  deleteCorrelation: deleteEndpointCorrelation,
  deleteEndpointCorrelation,
  deleteGroupedCorrelation,
  getCorrelation: getEndpointCorrelation,
  getEndpointCorrelation,
  getGroupedCorrelation,
  listCorrelationsByOrgLink: listEndpointCorrelationsByOrgLink,
  listEndpointCorrelationsByOrgLink,
  listGroupedCorrelationsByOrgLink,
  normalizeEndpointIdentity,
  normalizeEndpointRecord,
  normalizeEndpointRow,
  normalizeGroupedIdentity,
  normalizeGroupedRecord,
  normalizeGroupedRow,
  upsertCorrelation: upsertEndpointCorrelation,
  upsertEndpointCorrelation,
  upsertGroupedCorrelation
};
