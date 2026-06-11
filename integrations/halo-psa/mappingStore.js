const MAPPINGS_TABLE = 'halo_psa_org_client_mappings';

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toEnabledFlag(value) {
  return value === false || value === 'false' || value === '0' ? 0 : 1;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: row.id,
    action1OrgId: String(row.action1_org_id || ''),
    action1OrgName: String(row.action1_org_name || ''),
    haloClientId: String(row.halo_client_id || ''),
    haloClientName: String(row.halo_client_name || ''),
    enabled: Number(row.enabled) === 1,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function validatePayload(input = {}) {
  const normalized = {
    id: input.id === undefined || input.id === null || String(input.id).trim() === '' ? null : Number(input.id),
    action1OrgId: trimValue(input.action1OrgId),
    action1OrgName: trimValue(input.action1OrgName),
    haloClientId: trimValue(input.haloClientId),
    haloClientName: trimValue(input.haloClientName),
    enabled: toEnabledFlag(input.enabled)
  };

  if (normalized.id !== null && !Number.isInteger(normalized.id)) {
    throw new Error('Mapping id must be an integer when provided.');
  }
  if (!normalized.action1OrgId) {
    throw new Error('Action1 organization ID is required.');
  }
  if (!normalized.action1OrgName) {
    throw new Error('Action1 organization name is required.');
  }
  if (!normalized.haloClientId) {
    throw new Error('Halo client ID is required.');
  }
  if (!normalized.haloClientName) {
    throw new Error('Halo client name is required.');
  }

  return normalized;
}

async function listMappings(context) {
  const rows = await context.db.all(
    `SELECT id, action1_org_id, action1_org_name, halo_client_id, halo_client_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      ORDER BY action1_org_name COLLATE NOCASE ASC, id ASC`
  );
  return (Array.isArray(rows) ? rows : []).map(normalizeRow).filter(Boolean);
}

async function getMappingById(context, id) {
  const row = await context.db.get(
    `SELECT id, action1_org_id, action1_org_name, halo_client_id, halo_client_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE id = ?`,
    [id]
  );
  return normalizeRow(row);
}

async function getMappingByAction1OrgId(context, action1OrgId) {
  const row = await context.db.get(
    `SELECT id, action1_org_id, action1_org_name, halo_client_id, halo_client_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE action1_org_id = ?`,
    [action1OrgId]
  );
  return normalizeRow(row);
}

async function getMappingByHaloClientId(context, haloClientId) {
  const row = await context.db.get(
    `SELECT id, action1_org_id, action1_org_name, halo_client_id, halo_client_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE halo_client_id = ?`,
    [haloClientId]
  );
  return normalizeRow(row);
}

async function saveMapping(context, input) {
  const next = validatePayload(input);
  const existingByOrg = await getMappingByAction1OrgId(context, next.action1OrgId);
  if (existingByOrg && existingByOrg.id !== next.id) {
    throw new Error('Action1 organization is already mapped to a Halo client.');
  }

  const existingByClient = await getMappingByHaloClientId(context, next.haloClientId);
  if (existingByClient && existingByClient.id !== next.id) {
    throw new Error('Halo client is already mapped to a different Action1 organization.');
  }

  if (next.id !== null) {
    const existing = await getMappingById(context, next.id);
    if (!existing) {
      throw new Error('Mapping row was not found.');
    }

    await context.db.run(
      `UPDATE ${MAPPINGS_TABLE}
          SET action1_org_id = ?,
              action1_org_name = ?,
              halo_client_id = ?,
              halo_client_name = ?,
              enabled = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [next.action1OrgId, next.action1OrgName, next.haloClientId, next.haloClientName, next.enabled, next.id]
    );

    return getMappingById(context, next.id);
  }

  await context.db.run(
    `INSERT INTO ${MAPPINGS_TABLE} (
       action1_org_id,
       action1_org_name,
       halo_client_id,
       halo_client_name,
       enabled
     ) VALUES (?, ?, ?, ?, ?)`,
    [next.action1OrgId, next.action1OrgName, next.haloClientId, next.haloClientName, next.enabled]
  );

  return getMappingByAction1OrgId(context, next.action1OrgId);
}

async function deleteMapping(context, id) {
  const mappingId = Number(id);
  if (!Number.isInteger(mappingId)) {
    throw new Error('Mapping id is required.');
  }

  const existing = await getMappingById(context, mappingId);
  if (!existing) {
    return { deleted: false, mapping: null };
  }

  await context.db.run(`DELETE FROM ${MAPPINGS_TABLE} WHERE id = ?`, [mappingId]);
  return { deleted: true, mapping: existing };
}

module.exports = {
  MAPPINGS_TABLE,
  deleteMapping,
  getMappingByAction1OrgId,
  getMappingByHaloClientId,
  getMappingById,
  listMappings,
  normalizeRow,
  saveMapping
};
