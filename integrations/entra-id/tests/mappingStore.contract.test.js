const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '..', 'migrations', '002_add_org_mappings.sql');
const storePath = path.join(__dirname, '..', 'mappingStore.js');

function run() {
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  assert(migrationSource.includes('CREATE TABLE IF NOT EXISTS entra_id_org_mappings'), 'mapping migration should create the entra_id_org_mappings table');
  assert(migrationSource.includes('action1_org_id TEXT NOT NULL UNIQUE'), 'mapping migration should enforce unique Action1 organization ids');
  assert(migrationSource.includes('action1_org_name TEXT NOT NULL'), 'mapping migration should persist the Action1 organization display name');
  assert(migrationSource.includes('created_at DATETIME DEFAULT CURRENT_TIMESTAMP'), 'mapping migration should create timestamps');
  assert(migrationSource.includes('updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'), 'mapping migration should create updated timestamps');
  assert(!migrationSource.includes('tenant_id'), 'mapping migration should not add tenant_id columns');
  assert(!migrationSource.includes('tenant_key'), 'mapping migration should not add tenant_key columns');
  assert(!migrationSource.includes('enabled'), 'mapping migration should not add enabled columns for MVP delete-only behavior');
  assert(!migrationSource.includes('client_secret'), 'mapping migration should not persist secrets');
  assert(!migrationSource.includes('apiSecret'), 'mapping migration should not persist secrets');

  assert(storeSource.includes("const MAPPINGS_TABLE = 'entra_id_org_mappings';"), 'mapping store should use the Entra mapping table');
  assert(storeSource.includes('Action1 organization ID is required.'), 'mapping store should validate Action1 organization IDs');
  assert(storeSource.includes('Action1 organization name is required.'), 'mapping store should validate Action1 organization names');
  assert(storeSource.includes('already mapped'), 'mapping store should fail duplicate Action1 organizations safely');
  assert(storeSource.includes('async function deleteMapping'), 'mapping store should support delete-only removal');
  assert(storeSource.includes('DELETE FROM ${MAPPINGS_TABLE}'), 'mapping store should delete rows from the mapping table');
  assert(!storeSource.includes('tenant_id'), 'mapping store should not model tenant columns');
  assert(!storeSource.includes('tenant_key'), 'mapping store should not model tenant columns');
  assert(!storeSource.includes('enabled'), 'mapping store should not model enabled state');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
