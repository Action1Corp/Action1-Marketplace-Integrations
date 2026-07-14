const MAPPINGS_TABLE = 'entra_id_org_mappings';

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: row.id,
    action1OrgId: String(row.action1_org_id || ''),
    action1OrgName: String(row.action1_org_name || ''),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function validatePayload(input = {}) {
  const normalized = {
    id: input.id === undefined || input.id === null || String(input.id).trim() === '' ? null : Number(input.id),
    action1OrgId: trimValue(input.action1OrgId),
    action1OrgName: trimValue(input.action1OrgName)
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

  return normalized;
}

async function listMappings(context) {
  const rows = await context.db.all(
    `SELECT id, action1_org_id, action1_org_name, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC`
  );
  return (Array.isArray(rows) ? rows : []).map(normalizeRow).filter(Boolean);
}

async function getMappingById(context, id) {
  const row = await context.db.get(
    `SELECT id, action1_org_id, action1_org_name, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE id = ?`,
    [id]
  );
  return normalizeRow(row);
}

async function getMappingByAction1OrgId(context, action1OrgId) {
  const row = await context.db.get(
    `SELECT id, action1_org_id, action1_org_name, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE action1_org_id = ?`,
    [action1OrgId]
  );
  return normalizeRow(row);
}

async function saveMapping(context, input) {
  const next = validatePayload(input);
  const existingByOrg = await getMappingByAction1OrgId(context, next.action1OrgId);
  if (existingByOrg && existingByOrg.id !== next.id) {
    throw new Error('Action1 organization is already mapped.');
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
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [next.action1OrgId, next.action1OrgName, next.id]
    );

    return getMappingById(context, next.id);
  }

  await context.db.run(
    `INSERT INTO ${MAPPINGS_TABLE} (
       action1_org_id,
       action1_org_name
     ) VALUES (?, ?)`,
    [next.action1OrgId, next.action1OrgName]
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
  getMappingById,
  listMappings,
  normalizeRow,
  saveMapping,
  validatePayload
};
