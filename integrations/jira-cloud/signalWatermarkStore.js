const SIGNAL_WATERMARKS_TABLE = 'jira_cloud_signal_watermarks';
const INTEGRATION_ID = 'jira-cloud';
const AUTOMATION_FAILED_SIGNAL = 'AUTOMATION_FAILED';

function asTrimmedString(value) {
  return String(value || '').trim();
}

function toOptionalString(value) {
  const out = asTrimmedString(value);
  return out ? out : null;
}

function safeJsonParse(value) {
  const raw = asTrimmedString(value);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJsonStringify(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(value);
}

function normalizeWatermarkIdentity(input = {}) {
  return {
    orgLinkId: asTrimmedString(input.orgLinkId),
    signalType: asTrimmedString(input.signalType).toUpperCase()
  };
}

function normalizeWatermarkRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: row.id ?? null,
    integrationId: asTrimmedString(row.integration_id || INTEGRATION_ID),
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
  const updatedAt = asTrimmedString(input.updatedAt) || createdAt;

  return {
    integrationId: asTrimmedString(input.integrationId || INTEGRATION_ID),
    orgLinkId: identity.orgLinkId,
    action1OrgId: asTrimmedString(input.action1OrgId),
    signalType: identity.signalType,
    watermarkValue: toOptionalString(input.watermarkValue),
    watermarkAt: toOptionalString(input.watermarkAt),
    metadataJson: toOptionalString(input.metadataJson) || safeJsonStringify(input.metadata),
    createdAt,
    updatedAt
  };
}

async function getWatermark(context, orgLinkId, signalType) {
  const identity = normalizeWatermarkIdentity({ orgLinkId, signalType });
  if (!identity.orgLinkId || !identity.signalType) {
    return null;
  }

  const row = await runStoreGet(context, {
    operation: 'getSignalWatermark',
    sql: `SELECT id, integration_id, org_link_id, action1_org_id, signal_type, watermark_value, watermark_at, metadata_json, created_at, updated_at
       FROM ${SIGNAL_WATERMARKS_TABLE}
      WHERE org_link_id = ?
        AND signal_type = ?`,
    params: [identity.orgLinkId, identity.signalType]
  });

  return normalizeWatermarkRow(row);
}

async function upsertWatermark(context, input) {
  const normalized = normalizeWatermarkRecord(input);
  const existing = await getWatermark(context, normalized.orgLinkId, normalized.signalType);

  if (existing) {
    await runStoreWrite(context, {
      operation: 'updateSignalWatermark',
      sql: `UPDATE ${SIGNAL_WATERMARKS_TABLE}
          SET integration_id = ?,
              action1_org_id = ?,
              watermark_value = ?,
              watermark_at = ?,
              metadata_json = ?,
              created_at = ?,
              updated_at = ?
        WHERE org_link_id = ?
          AND signal_type = ?`,
      params: [
        normalized.integrationId,
        normalized.action1OrgId,
        normalized.watermarkValue,
        normalized.watermarkAt,
        normalized.metadataJson,
        existing.createdAt || normalized.createdAt,
        normalized.updatedAt,
        normalized.orgLinkId,
        normalized.signalType
      ]
    });
  } else {
    await runStoreWrite(context, {
      operation: 'insertSignalWatermark',
      sql: `INSERT INTO ${SIGNAL_WATERMARKS_TABLE} (
         integration_id,
         org_link_id,
         action1_org_id,
         signal_type,
         watermark_value,
         watermark_at,
         metadata_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        normalized.integrationId,
        normalized.orgLinkId,
        normalized.action1OrgId,
        normalized.signalType,
        normalized.watermarkValue,
        normalized.watermarkAt,
        normalized.metadataJson,
        normalized.createdAt,
        normalized.updatedAt
      ]
    });
  }

  return getWatermark(context, normalized.orgLinkId, normalized.signalType);
}

async function deleteWatermark(context, orgLinkId, signalType) {
  const identity = normalizeWatermarkIdentity({ orgLinkId, signalType });
  if (!identity.orgLinkId || !identity.signalType) {
    return;
  }

  await runStoreWrite(context, {
    operation: 'deleteSignalWatermark',
    sql: `DELETE FROM ${SIGNAL_WATERMARKS_TABLE}
      WHERE org_link_id = ?
        AND signal_type = ?`,
    params: [identity.orgLinkId, identity.signalType]
  });
}

async function getAutomationFailedWatermark(context, orgKey) {
  let row;
  try {
    row = await getWatermark(context, orgKey, AUTOMATION_FAILED_SIGNAL);
  } catch (error) {
    throw annotateStoreError(error, {
      operation: 'loadAutomationFailedWatermark'
    });
  }
  if (!row) {
    return null;
  }

  return {
    lastSeenAt: asTrimmedString(row.watermarkValue),
    lastInstanceId: asTrimmedString(row.metadata?.lastInstanceId),
    action1OrgId: asTrimmedString(row.action1OrgId || row.metadata?.action1OrgId),
    orgLinkId: asTrimmedString(row.orgLinkId || row.metadata?.orgLinkId),
    updatedAt: row.updatedAt || null
  };
}

async function upsertAutomationFailedWatermark(context, orgKey, input) {
  const payload = input && typeof input === 'object' ? input : {};
  try {
    return await upsertWatermark(context, {
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
  } catch (error) {
    throw annotateStoreError(error, {
      operation: 'persistAutomationFailedWatermark'
    });
  }
}

async function runStoreGet(context, input) {
  try {
    return await context.db.get(input.sql, input.params || []);
  } catch (error) {
    throw annotateStoreError(error, { operation: input.operation });
  }
}

async function runStoreWrite(context, input) {
  try {
    return await context.db.run(input.sql, input.params || []);
  } catch (error) {
    throw annotateStoreError(error, { operation: input.operation });
  }
}

function annotateStoreError(error, extras = {}) {
  const next = error instanceof Error ? error : new Error(String(error || 'signal_watermark_store_failed'));
  const code = asTrimmedString(next.code).toUpperCase();
  const message = asTrimmedString(next.message);
  const relation = extractRelationName(next);
  const operation = asTrimmedString(extras.operation) || asTrimmedString(next.operation) || 'signalWatermarkStore';
  const isDatabaseError = code === '42P01' || /relation\s+"?([a-z0-9_]+)"?\s+does not exist/i.test(message);

  next.operation = operation;
  next.relation = relation || next.relation || SIGNAL_WATERMARKS_TABLE;
  next.safeDiagnostic = {
    reason: isDatabaseError ? 'database_error' : 'collection_failed',
    code: code || '',
    relation: relation || SIGNAL_WATERMARKS_TABLE,
    operation
  };

  return next;
}

function extractRelationName(error) {
  const direct = asTrimmedString(error?.relation || error?.table);
  if (direct) {
    return direct;
  }

  const match = asTrimmedString(error?.message).match(/relation\s+"?([a-z0-9_]+)"?\s+does not exist/i);
  return match ? asTrimmedString(match[1]) : '';
}

function createDbSignalWatermarkStore(context) {
  return {
    getWatermark: (orgLinkId, signalType) => getWatermark(context, orgLinkId, signalType),
    upsertWatermark: (input) => upsertWatermark(context, input),
    deleteWatermark: (orgLinkId, signalType) => deleteWatermark(context, orgLinkId, signalType),
    getAutomationFailedWatermark: (orgKey) => getAutomationFailedWatermark(context, orgKey),
    upsertAutomationFailedWatermark: (orgKey, input) => upsertAutomationFailedWatermark(context, orgKey, input)
  };
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
