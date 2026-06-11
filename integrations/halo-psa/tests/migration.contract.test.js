const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const migrationPath = path.join(__dirname, '..', 'migrations', '002_add_org_client_mappings.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert(sql.includes('CREATE TABLE IF NOT EXISTS halo_psa_org_client_mappings'), 'mapping migration should create halo_psa_org_client_mappings');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(sql), 'mapping migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(sql), 'mapping migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(sql), 'mapping migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(sql), 'mapping migration must not alter Marketplace framework tables');
  assert(sql.includes('action1_org_id TEXT NOT NULL'), 'mapping migration should require action1_org_id');
  assert(sql.includes('halo_client_id TEXT NOT NULL'), 'mapping migration should require halo_client_id');
  assert(sql.includes('enabled INTEGER NOT NULL DEFAULT 1'), 'mapping migration should include enabled flag');
  assert(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_action1_org_id'), 'mapping migration should enforce unique Action1 org mapping');
  assert(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_halo_client_id'), 'mapping migration should enforce unique Halo client mapping');
  assert(sql.includes('CREATE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_enabled'), 'mapping migration should index enabled state');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
