const MAPPINGS_TABLE = 'action1_ticketing_org_client_mappings';
const { assertProviderId } = require('./providerAdapterContract');

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toEnabledFlag(value) {
  return value === false || value === 'false' || value === '0' ? 0 : 1;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const destinationId = String(row.destination_id ?? row.halo_client_id ?? '');
  const destinationName = String(row.destination_name ?? row.halo_client_name ?? '');
  return {
    id: row.id,
    providerId: String(row.provider_id || ''),
    action1OrgId: String(row.action1_org_id || ''),
    action1OrgName: String(row.action1_org_name || ''),
    destinationId,
    destinationName,
    // Retain the copied runtime/UI shape until later slices adapt those consumers.
    haloClientId: destinationId,
    haloClientName: destinationName,
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
    destinationId: trimValue(input.destinationId ?? input.haloClientId),
    destinationName: trimValue(input.destinationName ?? input.haloClientName),
    enabled: toEnabledFlag(input.enabled)
  };

  if (normalized.id !== null && !Number.isInteger(normalized.id)) throw new Error('Mapping id must be an integer when provided.');
  if (!normalized.action1OrgId) throw new Error('Action1 organization ID is required.');
  if (!normalized.action1OrgName) throw new Error('Action1 organization name is required.');
  if (!normalized.destinationId) throw new Error('Destination ID is required.');
  if (!normalized.destinationName) throw new Error('Destination name is required.');
  return normalized;
}

function requiredProviderId(providerId) {
  return assertProviderId(providerId);
}

async function listMappings(context, providerId) {
  const provider = requiredProviderId(providerId);
  const rows = await context.db.all(
    `SELECT id, provider_id, action1_org_id, action1_org_name, destination_id, destination_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE provider_id = ?
      ORDER BY LOWER(action1_org_name) ASC, action1_org_name ASC, id ASC`,
    [provider]
  );
  return (Array.isArray(rows) ? rows : []).map(normalizeRow).filter(Boolean);
}

async function getMappingById(context, providerId, id) {
  const provider = requiredProviderId(providerId);
  const row = await context.db.get(
    `SELECT id, provider_id, action1_org_id, action1_org_name, destination_id, destination_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE provider_id = ? AND id = ?`,
    [provider, id]
  );
  return normalizeRow(row);
}

async function getMappingByAction1OrgId(context, providerId, action1OrgId) {
  const provider = requiredProviderId(providerId);
  const row = await context.db.get(
    `SELECT id, provider_id, action1_org_id, action1_org_name, destination_id, destination_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE provider_id = ? AND action1_org_id = ?`,
    [provider, action1OrgId]
  );
  return normalizeRow(row);
}

async function getMappingByDestinationId(context, providerId, destinationId) {
  const provider = requiredProviderId(providerId);
  const row = await context.db.get(
    `SELECT id, provider_id, action1_org_id, action1_org_name, destination_id, destination_name, enabled, created_at, updated_at
       FROM ${MAPPINGS_TABLE}
      WHERE provider_id = ? AND destination_id = ?`,
    [provider, destinationId]
  );
  return normalizeRow(row);
}

async function saveMapping(context, providerId, input) {
  const provider = requiredProviderId(providerId);
  const next = validatePayload(input);
  const existingById = next.id === null ? null : await getMappingById(context, provider, next.id);
  if (next.id !== null && !existingById) throw new Error('Mapping row was not found.');
  if (existingById && (
    existingById.action1OrgId !== next.action1OrgId ||
    existingById.destinationId !== next.destinationId
  )) {
    throw new Error('Mapping relationship identity cannot be changed in place. Remove and create a new mapping.');
  }

  const existingByOrg = await getMappingByAction1OrgId(context, provider, next.action1OrgId);
  if (existingByOrg && existingByOrg.id !== next.id) throw new Error('Action1 organization is already mapped to a destination.');

  const existingByDestination = await getMappingByDestinationId(context, provider, next.destinationId);
  if (existingByDestination && existingByDestination.id !== next.id) throw new Error('Destination is already mapped to a different Action1 organization.');

  if (next.id !== null) {
    await context.db.run(
      `UPDATE ${MAPPINGS_TABLE}
          SET action1_org_id = ?,
              action1_org_name = ?,
              destination_id = ?,
              destination_name = ?,
              enabled = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE provider_id = ? AND id = ?`,
      [next.action1OrgId, next.action1OrgName, next.destinationId, next.destinationName, next.enabled, provider, next.id]
    );
    return getMappingById(context, provider, next.id);
  }

  await context.db.run(
    `INSERT INTO ${MAPPINGS_TABLE} (
       provider_id,
       action1_org_id,
       action1_org_name,
       destination_id,
       destination_name,
       enabled
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [provider, next.action1OrgId, next.action1OrgName, next.destinationId, next.destinationName, next.enabled]
  );
  return getMappingByAction1OrgId(context, provider, next.action1OrgId);
}

async function deleteMapping(context, providerId, id) {
  const provider = requiredProviderId(providerId);
  const mappingId = Number(id);
  if (!Number.isInteger(mappingId)) throw new Error('Mapping id is required.');
  const existing = await getMappingById(context, provider, mappingId);
  if (!existing) return { deleted: false, mapping: null };
  await context.db.run(`DELETE FROM ${MAPPINGS_TABLE} WHERE provider_id = ? AND id = ?`, [provider, mappingId]);
  return { deleted: true, mapping: existing };
}

function createDbMappingStore(context, providerId) {
  const provider = requiredProviderId(providerId);
  return Object.freeze({
    list: () => listMappings(context, provider),
    getById: (id) => getMappingById(context, provider, id),
    getByAction1OrgId: (id) => getMappingByAction1OrgId(context, provider, id),
    getByDestinationId: (id) => getMappingByDestinationId(context, provider, id),
    save: (input) => saveMapping(context, provider, input),
    delete: (id) => deleteMapping(context, provider, id)
  });
}

module.exports = {
  MAPPINGS_TABLE,
  createDbMappingStore,
  deleteMapping,
  getMappingByAction1OrgId,
  getMappingByDestinationId,
  getMappingById,
  listMappings,
  normalizeRow,
  saveMapping,
  validatePayload
};
