const SIGNAL_WATERMARKS_TABLE = 'action1_ticketing_signal_watermarks';
const INTEGRATION_ID = 'action1-ticketing';
const AUTOMATION_FAILED_SIGNAL = 'AUTOMATION_FAILED';
const MAX_WATERMARK_METADATA_BYTES = 4096;
const { assertProviderId } = require('./providerAdapterContract');
const { getMappingById } = require('./mappingStore');

function asTrimmedString(value) {
  return String(value || '').trim();
}

function toOptionalString(value) {
  const out = asTrimmedString(value);
  return out ? out : null;
}

function safeJsonParse(value) {
  const raw = asTrimmedString(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeMetadata(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length > 32) {
    throw new Error('signal_watermark_metadata_invalid');
  }
  const json = JSON.stringify(parsed);
  if (Buffer.byteLength(json, 'utf8') > MAX_WATERMARK_METADATA_BYTES || /"[a-z0-9_]*(?:secret|token|password|authorization|credential|headers?)[a-z0-9_]*"\s*:/i.test(json)) {
    throw new Error('signal_watermark_metadata_invalid');
  }
  return json;
}

function normalizeWatermarkIdentity(input = {}) {
  return { orgLinkId: asTrimmedString(input.orgLinkId), signalType: asTrimmedString(input.signalType).toUpperCase() };
}

function normalizeWatermarkRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id ?? null,
    integrationId: asTrimmedString(row.integration_id || INTEGRATION_ID),
    providerId: asTrimmedString(row.provider_id),
    orgLinkId: asTrimmedString(row.org_link_id),
    action1OrgId: asTrimmedString(row.action1_org_id),
    signalType: asTrimmedString(row.signal_type).toUpperCase(),
    watermarkValue: toOptionalString(row.watermark_value),
    watermarkAt: toOptionalString(row.watermark_at),
    metadataJson: toOptionalString(row.metadata_json),
    metadata: safeJsonParse(row.metadata_json),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeWatermarkRecord(input = {}) {
  const identity = normalizeWatermarkIdentity(input);
  if (!identity.orgLinkId) throw new Error('signal_watermark_org_link_id_required');
  if (!identity.signalType) throw new Error('signal_watermark_signal_type_required');
  const createdAt = asTrimmedString(input.createdAt) || new Date().toISOString();
  return {
    orgLinkId: identity.orgLinkId,
    action1OrgId: asTrimmedString(input.action1OrgId),
    signalType: identity.signalType,
    watermarkValue: toOptionalString(input.watermarkValue),
    watermarkAt: toOptionalString(input.watermarkAt),
    metadataJson: input.metadataJson !== undefined ? normalizeMetadata(input.metadataJson) : normalizeMetadata(input.metadata),
    createdAt,
    updatedAt: asTrimmedString(input.updatedAt) || createdAt
  };
}

async function assertMappingOwnership(context, providerId, orgLinkId) {
  const mapping = await getMappingById(context, providerId, orgLinkId);
  if (!mapping) {
    const error = new Error('Mapping was not found for this provider.');
    error.code = 'provider_mapping_not_found';
    throw error;
  }
}

const WATERMARK_COLUMNS = 'id, integration_id, provider_id, org_link_id, action1_org_id, signal_type, watermark_value, watermark_at, metadata_json, created_at, updated_at';

async function getWatermark(context, providerId, orgLinkId, signalType) {
  const provider = assertProviderId(providerId);
  const identity = normalizeWatermarkIdentity({ orgLinkId, signalType });
  if (!identity.orgLinkId || !identity.signalType) return null;
  const row = await context.db.get(
    `SELECT ${WATERMARK_COLUMNS} FROM ${SIGNAL_WATERMARKS_TABLE}
      WHERE provider_id = ? AND org_link_id = ? AND signal_type = ?`,
    [provider, identity.orgLinkId, identity.signalType]
  );
  return normalizeWatermarkRow(row);
}

async function upsertWatermark(context, providerId, input) {
  const provider = assertProviderId(providerId);
  const normalized = normalizeWatermarkRecord(input);
  await assertMappingOwnership(context, provider, normalized.orgLinkId);
  const existing = await getWatermark(context, provider, normalized.orgLinkId, normalized.signalType);
  if (existing) {
    await context.db.run(
      `UPDATE ${SIGNAL_WATERMARKS_TABLE}
          SET provider_id = ?, action1_org_id = ?, watermark_value = ?, watermark_at = ?, metadata_json = ?, created_at = ?, updated_at = ?
        WHERE provider_id = ? AND org_link_id = ? AND signal_type = ?`,
      [provider, normalized.action1OrgId, normalized.watermarkValue, normalized.watermarkAt, normalized.metadataJson, existing.createdAt || normalized.createdAt, normalized.updatedAt, provider, normalized.orgLinkId, normalized.signalType]
    );
  } else {
    await context.db.run(
      `INSERT INTO ${SIGNAL_WATERMARKS_TABLE} (provider_id, integration_id, org_link_id, action1_org_id, signal_type, watermark_value, watermark_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [provider, INTEGRATION_ID, normalized.orgLinkId, normalized.action1OrgId, normalized.signalType, normalized.watermarkValue, normalized.watermarkAt, normalized.metadataJson, normalized.createdAt, normalized.updatedAt]
    );
  }
  return getWatermark(context, provider, normalized.orgLinkId, normalized.signalType);
}

async function deleteWatermark(context, providerId, orgLinkId, signalType) {
  const provider = assertProviderId(providerId);
  const identity = normalizeWatermarkIdentity({ orgLinkId, signalType });
  if (!identity.orgLinkId || !identity.signalType) return;
  await context.db.run(
    `DELETE FROM ${SIGNAL_WATERMARKS_TABLE} WHERE provider_id = ? AND org_link_id = ? AND signal_type = ?`,
    [provider, identity.orgLinkId, identity.signalType]
  );
}

async function getAutomationFailedWatermark(context, providerId, orgKey) {
  const row = await getWatermark(context, providerId, orgKey, AUTOMATION_FAILED_SIGNAL);
  if (!row) return null;
  return {
    lastSeenAt: asTrimmedString(row.watermarkValue),
    lastInstanceId: asTrimmedString(row.metadata?.lastInstanceId),
    action1OrgId: asTrimmedString(row.action1OrgId || row.metadata?.action1OrgId),
    orgLinkId: asTrimmedString(row.orgLinkId || row.metadata?.orgLinkId),
    updatedAt: row.updatedAt || null
  };
}

async function upsertAutomationFailedWatermark(context, providerId, orgKey, input) {
  const payload = input && typeof input === 'object' ? input : {};
  return upsertWatermark(context, providerId, {
    orgLinkId: orgKey,
    action1OrgId: payload.action1OrgId,
    signalType: AUTOMATION_FAILED_SIGNAL,
    watermarkValue: payload.lastSeenAt,
    watermarkAt: payload.lastSeenAt,
    metadata: {
      lastInstanceId: asTrimmedString(payload.lastInstanceId),
      action1OrgId: asTrimmedString(payload.action1OrgId),
      orgLinkId: asTrimmedString(payload.orgLinkId || orgKey)
    },
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt
  });
}

function createDbSignalWatermarkStore(context, providerId) {
  const provider = assertProviderId(providerId);
  return Object.freeze({
    providerId: provider,
    getWatermark: (orgLinkId, signalType) => getWatermark(context, provider, orgLinkId, signalType),
    upsertWatermark: (input) => upsertWatermark(context, provider, input),
    deleteWatermark: (orgLinkId, signalType) => deleteWatermark(context, provider, orgLinkId, signalType),
    getAutomationFailedWatermark: (orgKey) => getAutomationFailedWatermark(context, provider, orgKey),
    upsertAutomationFailedWatermark: (orgKey, input) => upsertAutomationFailedWatermark(context, provider, orgKey, input)
  });
}

module.exports = {
  AUTOMATION_FAILED_SIGNAL,
  SIGNAL_WATERMARKS_TABLE,
  createDbSignalWatermarkStore,
  deleteWatermark,
  getAutomationFailedWatermark,
  getWatermark,
  normalizeWatermarkRecord,
  normalizeWatermarkRow,
  safeJsonParse,
  upsertAutomationFailedWatermark,
  upsertWatermark
};
