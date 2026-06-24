const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const mappingMigrationPath = path.join(__dirname, '..', 'migrations', '002_add_org_client_mappings.sql');
  const lifecycleStateMigrationPath = path.join(__dirname, '..', 'migrations', '003_add_lifecycle_state_tables.sql');
  const mappingSql = fs.readFileSync(mappingMigrationPath, 'utf8');
  const lifecycleSql = fs.readFileSync(lifecycleStateMigrationPath, 'utf8');

  assert(mappingSql.includes('CREATE TABLE IF NOT EXISTS halo_psa_org_client_mappings'), 'mapping migration should create halo_psa_org_client_mappings');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(mappingSql), 'mapping migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(mappingSql), 'mapping migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(mappingSql), 'mapping migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(mappingSql), 'mapping migration must not alter Marketplace framework tables');
  assert(mappingSql.includes('action1_org_id TEXT NOT NULL'), 'mapping migration should require action1_org_id');
  assert(mappingSql.includes('halo_client_id TEXT NOT NULL'), 'mapping migration should require halo_client_id');
  assert(mappingSql.includes('enabled INTEGER NOT NULL DEFAULT 1'), 'mapping migration should include enabled flag');
  assert(mappingSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_action1_org_id'), 'mapping migration should enforce unique Action1 org mapping');
  assert(mappingSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_halo_client_id'), 'mapping migration should enforce unique Halo client mapping');
  assert(mappingSql.includes('CREATE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_enabled'), 'mapping migration should index enabled state');

  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS halo_psa_endpoint_correlations'), 'lifecycle migration should create halo_psa_endpoint_correlations');
  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS halo_psa_grouped_correlations'), 'lifecycle migration should create halo_psa_grouped_correlations');
  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS halo_psa_signal_watermarks'), 'lifecycle migration should create halo_psa_signal_watermarks');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace framework tables');
  assert(lifecycleSql.includes('identity_key TEXT NOT NULL'), 'correlation tables should require identity_key');
  assert(lifecycleSql.includes('linked_ticket_id TEXT NOT NULL'), 'correlation tables should require linked_ticket_id');
  assert(lifecycleSql.includes('signal_type TEXT NOT NULL'), 'lifecycle tables should require signal_type');
  assert(lifecycleSql.includes('watermark_value TEXT'), 'watermark table should include watermark_value');
  assert(lifecycleSql.includes('metadata_json TEXT'), 'watermark table should include metadata_json');
  assert(lifecycleSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_endpoint_correlations_identity_key'), 'endpoint correlations should have unique identity key index');
  assert(lifecycleSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_endpoint_correlations_identity_fields'), 'endpoint correlations should have unique identity fields index');
  assert(lifecycleSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_grouped_correlations_identity_key'), 'grouped correlations should have unique identity key index');
  assert(lifecycleSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_grouped_correlations_identity_fields'), 'grouped correlations should have unique identity fields index');
  assert(lifecycleSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_signal_watermarks_org_signal'), 'signal watermarks should have unique org/signal index');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
