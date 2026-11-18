const ENDPOINT_CORRELATIONS_TABLE = 'action1_ticketing_endpoint_correlations';
const GROUPED_CORRELATIONS_TABLE = 'action1_ticketing_grouped_correlations';
const INTEGRATION_ID = 'action1-ticketing';
const { assertProviderId } = require('./providerAdapterContract');
const { getMappingById } = require('./mappingStore');
const { normalizeExternalTicketReference } = require('./providerAdapterContract');

function asTrimmedString(value) {
  return String(value || '').trim();
}

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptionalString(value) {
  const out = asTrimmedString(value);
  return out ? out : null;
}

function normalizeEndpointIdentity(input = {}) {
  const orgLinkId = asTrimmedString(input.orgLinkId);
  const endpointId = asTrimmedString(input.endpointId);
  const signalType = asTrimmedString(input.signalType).toUpperCase();
  return { orgLinkId, endpointId, signalType, identityKey: orgLinkId && endpointId && signalType ? `${orgLinkId}|${endpointId}|${signalType}` : '' };
}

function normalizeGroupedIdentity(input = {}) {
  const orgLinkId = asTrimmedString(input.orgLinkId);
  const signalType = asTrimmedString(input.signalType).toUpperCase();
  const issueKey = asTrimmedString(input.issueKey);
  return { orgLinkId, signalType, issueKey, identityKey: orgLinkId && signalType && issueKey ? `${orgLinkId}|${signalType}|${issueKey}` : '' };
}

function parseReferenceMetadata(value) {
  const raw = asTrimmedString(value);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeReferenceFromRow(row) {
  const id = asTrimmedString(row.external_ticket_id ?? row.linked_ticket_id);
  if (!id) return null;
  try {
    return normalizeExternalTicketReference({
      id,
      displayId: row.external_display_id || undefined,
      url: row.external_url || undefined,
      metadata: parseReferenceMetadata(row.provider_metadata_json)
    });
  } catch {
    return { id };
  }
}

function normalizeEndpointRow(row) {
  if (!row || typeof row !== 'object') return null;
  const externalTicketRef = normalizeReferenceFromRow(row);
  const linkedTicketId = externalTicketRef?.id || '';
  const linkedTicketStatus = toOptionalString(row.observed_status_name ?? row.linked_ticket_status);
  return {
    mode: 'endpoint',
    id: row.id ?? null,
    integrationId: asTrimmedString(row.integration_id || INTEGRATION_ID),
    providerId: asTrimmedString(row.provider_id),
    identityKey: asTrimmedString(row.identity_key),
    orgLinkId: asTrimmedString(row.org_link_id),
    action1OrgId: asTrimmedString(row.action1_org_id),
    endpointId: asTrimmedString(row.endpoint_id),
    signalType: asTrimmedString(row.signal_type).toUpperCase(),
    externalTicketRef,
    linkedTicketId,
    haloTicketId: linkedTicketId,
    payloadHash: toOptionalString(row.comparison_value ?? row.payload_hash),
    comparisonValue: toOptionalString(row.comparison_value ?? row.payload_hash),
    comparisonVersion: toOptionalString(row.comparison_version),
    observedStatusId: toOptionalString(row.observed_status_id),
    linkedTicketStatus,
    ticketStatusId: toOptionalString(row.observed_status_id),
    ticketStatusName: linkedTicketStatus,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeGroupedRow(row) {
  if (!row || typeof row !== 'object') return null;
  const externalTicketRef = normalizeReferenceFromRow(row);
  const linkedTicketId = externalTicketRef?.id || '';
  const linkedTicketStatus = toOptionalString(row.observed_status_name ?? row.linked_ticket_status);
  return {
    mode: 'grouped',
    id: row.id ?? null,
    integrationId: asTrimmedString(row.integration_id || INTEGRATION_ID),
    providerId: asTrimmedString(row.provider_id),
    identityKey: asTrimmedString(row.identity_key),
    orgLinkId: asTrimmedString(row.org_link_id),
    action1OrgId: asTrimmedString(row.action1_org_id),
    signalType: asTrimmedString(row.signal_type).toUpperCase(),
    issueKey: asTrimmedString(row.issue_key),
    externalTicketRef,
    linkedTicketId,
    payloadHash: toOptionalString(row.comparison_value ?? row.payload_hash),
    comparisonValue: toOptionalString(row.comparison_value ?? row.payload_hash),
    comparisonVersion: toOptionalString(row.comparison_version),
    observedStatusId: toOptionalString(row.observed_status_id),
    linkedTicketStatus,
    ticketStatusId: toOptionalString(row.observed_status_id),
    ticketStatusName: linkedTicketStatus,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeEndpointRecord(input = {}) {
  const identity = normalizeEndpointIdentity(input);
  const legacyTicketId = asTrimmedString(input.linkedTicketId || input.haloTicketId);
  const externalTicketRef = normalizeExternalTicketReference(input.externalTicketRef || { id: legacyTicketId });
  if (!identity.orgLinkId) throw new Error('endpoint_correlation_org_link_id_required');
  if (!identity.endpointId) throw new Error('endpoint_correlation_endpoint_id_required');
  if (!identity.signalType) throw new Error('endpoint_correlation_signal_type_required');
  const createdAt = trimValue(input.createdAt) || new Date().toISOString();
  return {
    identityKey: identity.identityKey,
    orgLinkId: identity.orgLinkId,
    action1OrgId: asTrimmedString(input.action1OrgId),
    endpointId: identity.endpointId,
    signalType: identity.signalType,
    externalTicketRef,
    comparisonValue: toOptionalString(input.comparisonValue ?? input.payloadHash),
    comparisonVersion: toOptionalString(input.comparisonVersion),
    observedStatusId: toOptionalString(input.observedStatusId ?? input.ticketStatusId),
    observedStatusName: toOptionalString(input.observedStatusName ?? input.linkedTicketStatus ?? input.ticketStatusName),
    createdAt,
    updatedAt: trimValue(input.updatedAt) || createdAt
  };
}

function normalizeGroupedRecord(input = {}) {
  const identity = normalizeGroupedIdentity(input);
  const legacyTicketId = asTrimmedString(input.linkedTicketId || input.haloTicketId);
  const externalTicketRef = normalizeExternalTicketReference(input.externalTicketRef || { id: legacyTicketId });
  if (!identity.orgLinkId) throw new Error('grouped_correlation_org_link_id_required');
  if (!identity.signalType) throw new Error('grouped_correlation_signal_type_required');
  if (!identity.issueKey) throw new Error('grouped_correlation_issue_key_required');
  const createdAt = trimValue(input.createdAt) || new Date().toISOString();
  return {
    identityKey: asTrimmedString(input.identityKey) || identity.identityKey,
    orgLinkId: identity.orgLinkId,
    action1OrgId: asTrimmedString(input.action1OrgId),
    signalType: identity.signalType,
    issueKey: identity.issueKey,
    externalTicketRef,
    comparisonValue: toOptionalString(input.comparisonValue ?? input.payloadHash),
    comparisonVersion: toOptionalString(input.comparisonVersion),
    observedStatusId: toOptionalString(input.observedStatusId ?? input.ticketStatusId),
    observedStatusName: toOptionalString(input.observedStatusName ?? input.linkedTicketStatus ?? input.ticketStatusName),
    createdAt,
    updatedAt: trimValue(input.updatedAt) || createdAt
  };
}

function providerAndContext(context, providerId) {
  return { context, providerId: assertProviderId(providerId) };
}

async function assertMappingOwnership(context, providerId, orgLinkId) {
  const mapping = await getMappingById(context, providerId, orgLinkId);
  if (!mapping) {
    const error = new Error('Mapping was not found for this provider.');
    error.code = 'provider_mapping_not_found';
    throw error;
  }
}

const ENDPOINT_COLUMNS = 'id, integration_id, provider_id, identity_key, org_link_id, action1_org_id, endpoint_id, signal_type, external_ticket_id, external_display_id, external_url, provider_metadata_json, comparison_value, comparison_version, observed_status_id, observed_status_name, created_at, updated_at';
const GROUPED_COLUMNS = 'id, integration_id, provider_id, identity_key, org_link_id, action1_org_id, signal_type, issue_key, external_ticket_id, external_display_id, external_url, provider_metadata_json, comparison_value, comparison_version, observed_status_id, observed_status_name, created_at, updated_at';

async function getEndpointCorrelation(context, providerId, orgLinkId, endpointId, signalType) {
  const provider = assertProviderId(providerId);
  const identity = normalizeEndpointIdentity({ orgLinkId, endpointId, signalType });
  if (!identity.orgLinkId || !identity.endpointId || !identity.signalType) return null;
  const row = await context.db.get(
    `SELECT ${ENDPOINT_COLUMNS} FROM ${ENDPOINT_CORRELATIONS_TABLE}
      WHERE provider_id = ? AND org_link_id = ? AND endpoint_id = ? AND signal_type = ?`,
    [provider, identity.orgLinkId, identity.endpointId, identity.signalType]
  );
  return normalizeEndpointRow(row);
}

async function upsertEndpointCorrelation(context, providerId, record) {
  const provider = assertProviderId(providerId);
  const normalized = normalizeEndpointRecord(record);
  await assertMappingOwnership(context, provider, normalized.orgLinkId);
  const existing = await getEndpointCorrelation(context, provider, normalized.orgLinkId, normalized.endpointId, normalized.signalType);
  const params = [
    provider, normalized.identityKey, normalized.action1OrgId, normalized.externalTicketRef.id,
    normalized.externalTicketRef.displayId || null, normalized.externalTicketRef.url || null,
    normalized.externalTicketRef.metadata ? JSON.stringify(normalized.externalTicketRef.metadata) : null,
    normalized.comparisonValue, normalized.comparisonVersion, normalized.observedStatusId,
    normalized.observedStatusName, existing?.createdAt || normalized.createdAt, normalized.updatedAt
  ];
  if (existing) {
    await context.db.run(
      `UPDATE ${ENDPOINT_CORRELATIONS_TABLE}
          SET provider_id = ?, identity_key = ?, action1_org_id = ?, external_ticket_id = ?, external_display_id = ?, external_url = ?, provider_metadata_json = ?, comparison_value = ?, comparison_version = ?, observed_status_id = ?, observed_status_name = ?, created_at = ?, updated_at = ?
        WHERE provider_id = ? AND org_link_id = ? AND endpoint_id = ? AND signal_type = ?`,
      [...params, provider, normalized.orgLinkId, normalized.endpointId, normalized.signalType]
    );
  } else {
    await context.db.run(
      `INSERT INTO ${ENDPOINT_CORRELATIONS_TABLE} (provider_id, integration_id, identity_key, org_link_id, action1_org_id, endpoint_id, signal_type, external_ticket_id, external_display_id, external_url, provider_metadata_json, comparison_value, comparison_version, observed_status_id, observed_status_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [provider, INTEGRATION_ID, normalized.identityKey, normalized.orgLinkId, normalized.action1OrgId, normalized.endpointId, normalized.signalType, normalized.externalTicketRef.id, normalized.externalTicketRef.displayId || null, normalized.externalTicketRef.url || null, normalized.externalTicketRef.metadata ? JSON.stringify(normalized.externalTicketRef.metadata) : null, normalized.comparisonValue, normalized.comparisonVersion, normalized.observedStatusId, normalized.observedStatusName, normalized.createdAt, normalized.updatedAt]
    );
  }
  return getEndpointCorrelation(context, provider, normalized.orgLinkId, normalized.endpointId, normalized.signalType);
}

async function deleteEndpointCorrelation(context, providerId, orgLinkId, endpointId, signalType) {
  const provider = assertProviderId(providerId);
  const identity = normalizeEndpointIdentity({ orgLinkId, endpointId, signalType });
  if (!identity.orgLinkId || !identity.endpointId || !identity.signalType) return;
  await context.db.run(
    `DELETE FROM ${ENDPOINT_CORRELATIONS_TABLE} WHERE provider_id = ? AND org_link_id = ? AND endpoint_id = ? AND signal_type = ?`,
    [provider, identity.orgLinkId, identity.endpointId, identity.signalType]
  );
}

async function listEndpointCorrelationsByOrgLink(context, providerId, orgLinkId) {
  const provider = assertProviderId(providerId);
  const key = asTrimmedString(orgLinkId);
  if (!key) return [];
  const rows = await context.db.all(
    `SELECT ${ENDPOINT_COLUMNS} FROM ${ENDPOINT_CORRELATIONS_TABLE}
      WHERE provider_id = ? AND org_link_id = ?
      ORDER BY signal_type ASC, endpoint_id ASC, id ASC`,
    [provider, key]
  );
  return (Array.isArray(rows) ? rows : []).map(normalizeEndpointRow).filter(Boolean);
}

async function getGroupedCorrelation(context, providerId, orgLinkId, signalType, issueKey) {
  const provider = assertProviderId(providerId);
  const identity = normalizeGroupedIdentity({ orgLinkId, signalType, issueKey });
  if (!identity.orgLinkId || !identity.signalType || !identity.issueKey) return null;
  const row = await context.db.get(
    `SELECT ${GROUPED_COLUMNS} FROM ${GROUPED_CORRELATIONS_TABLE}
      WHERE provider_id = ? AND org_link_id = ? AND signal_type = ? AND issue_key = ?`,
    [provider, identity.orgLinkId, identity.signalType, identity.issueKey]
  );
  return normalizeGroupedRow(row);
}

async function upsertGroupedCorrelation(context, providerId, record) {
  const provider = assertProviderId(providerId);
  const normalized = normalizeGroupedRecord(record);
  await assertMappingOwnership(context, provider, normalized.orgLinkId);
  const existing = await getGroupedCorrelation(context, provider, normalized.orgLinkId, normalized.signalType, normalized.issueKey);
  if (existing) {
    await context.db.run(
      `UPDATE ${GROUPED_CORRELATIONS_TABLE}
          SET provider_id = ?, identity_key = ?, action1_org_id = ?, external_ticket_id = ?, external_display_id = ?, external_url = ?, provider_metadata_json = ?, comparison_value = ?, comparison_version = ?, observed_status_id = ?, observed_status_name = ?, created_at = ?, updated_at = ?
        WHERE provider_id = ? AND org_link_id = ? AND signal_type = ? AND issue_key = ?`,
      [provider, normalized.identityKey, normalized.action1OrgId, normalized.externalTicketRef.id, normalized.externalTicketRef.displayId || null, normalized.externalTicketRef.url || null, normalized.externalTicketRef.metadata ? JSON.stringify(normalized.externalTicketRef.metadata) : null, normalized.comparisonValue, normalized.comparisonVersion, normalized.observedStatusId, normalized.observedStatusName, existing.createdAt || normalized.createdAt, normalized.updatedAt, provider, normalized.orgLinkId, normalized.signalType, normalized.issueKey]
    );
  } else {
    await context.db.run(
      `INSERT INTO ${GROUPED_CORRELATIONS_TABLE} (provider_id, integration_id, identity_key, org_link_id, action1_org_id, signal_type, issue_key, external_ticket_id, external_display_id, external_url, provider_metadata_json, comparison_value, comparison_version, observed_status_id, observed_status_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [provider, INTEGRATION_ID, normalized.identityKey, normalized.orgLinkId, normalized.action1OrgId, normalized.signalType, normalized.issueKey, normalized.externalTicketRef.id, normalized.externalTicketRef.displayId || null, normalized.externalTicketRef.url || null, normalized.externalTicketRef.metadata ? JSON.stringify(normalized.externalTicketRef.metadata) : null, normalized.comparisonValue, normalized.comparisonVersion, normalized.observedStatusId, normalized.observedStatusName, normalized.createdAt, normalized.updatedAt]
    );
  }
  return getGroupedCorrelation(context, provider, normalized.orgLinkId, normalized.signalType, normalized.issueKey);
}

async function deleteGroupedCorrelation(context, providerId, orgLinkId, signalType, issueKey) {
  const provider = assertProviderId(providerId);
  const identity = normalizeGroupedIdentity({ orgLinkId, signalType, issueKey });
  if (!identity.orgLinkId || !identity.signalType || !identity.issueKey) return;
  await context.db.run(
    `DELETE FROM ${GROUPED_CORRELATIONS_TABLE} WHERE provider_id = ? AND org_link_id = ? AND signal_type = ? AND issue_key = ?`,
    [provider, identity.orgLinkId, identity.signalType, identity.issueKey]
  );
}

async function listGroupedCorrelationsByOrgLink(context, providerId, orgLinkId) {
  const provider = assertProviderId(providerId);
  const key = asTrimmedString(orgLinkId);
  if (!key) return [];
  const rows = await context.db.all(
    `SELECT ${GROUPED_COLUMNS} FROM ${GROUPED_CORRELATIONS_TABLE}
      WHERE provider_id = ? AND org_link_id = ?
      ORDER BY signal_type ASC, issue_key ASC, id ASC`,
    [provider, key]
  );
  return (Array.isArray(rows) ? rows : []).map(normalizeGroupedRow).filter(Boolean);
}

function createDbCorrelationStore(context, providerId) {
  const provider = assertProviderId(providerId);
  return Object.freeze({
    providerId: provider,
    getEndpointCorrelation: (orgLinkId, endpointId, signalType) => getEndpointCorrelation(context, provider, orgLinkId, endpointId, signalType),
    upsertEndpointCorrelation: (record) => upsertEndpointCorrelation(context, provider, record),
    deleteEndpointCorrelation: (orgLinkId, endpointId, signalType) => deleteEndpointCorrelation(context, provider, orgLinkId, endpointId, signalType),
    listEndpointCorrelationsByOrgLink: (orgLinkId) => listEndpointCorrelationsByOrgLink(context, provider, orgLinkId),
    getGroupedCorrelation: (orgLinkId, signalType, issueKey) => getGroupedCorrelation(context, provider, orgLinkId, signalType, issueKey),
    upsertGroupedCorrelation: (record) => upsertGroupedCorrelation(context, provider, record),
    deleteGroupedCorrelation: (orgLinkId, signalType, issueKey) => deleteGroupedCorrelation(context, provider, orgLinkId, signalType, issueKey),
    listGroupedCorrelationsByOrgLink: (orgLinkId) => listGroupedCorrelationsByOrgLink(context, provider, orgLinkId),
    getCorrelation: (orgLinkId, endpointId, signalType) => getEndpointCorrelation(context, provider, orgLinkId, endpointId, signalType),
    upsertCorrelation: (record) => upsertEndpointCorrelation(context, provider, record),
    deleteCorrelation: (orgLinkId, endpointId, signalType) => deleteEndpointCorrelation(context, provider, orgLinkId, endpointId, signalType),
    listCorrelationsByOrgLink: async (orgLinkId, opts = {}) => {
      const endpointRows = await listEndpointCorrelationsByOrgLink(context, provider, orgLinkId);
      if (opts?.includeGrouped !== true) return endpointRows;
      const groupedRows = await listGroupedCorrelationsByOrgLink(context, provider, orgLinkId);
      return endpointRows.concat(groupedRows);
    }
  });
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
  upsertEndpointCorrelation
};
