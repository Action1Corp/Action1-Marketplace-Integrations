const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const mappingMigrationPath = path.join(__dirname, '..', 'migrations', '002_add_org_client_mappings.sql');
  const lifecycleStateMigrationPath = path.join(__dirname, '..', 'migrations', '003_add_lifecycle_state_tables.sql');
  const mappingSql = fs.readFileSync(mappingMigrationPath, 'utf8');
  const lifecycleSql = fs.readFileSync(lifecycleStateMigrationPath, 'utf8');

  assert(mappingSql.includes('CREATE TABLE IF NOT EXISTS action1_ticketing_org_client_mappings'), 'mapping migration should create action1_ticketing_org_client_mappings');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(mappingSql), 'mapping migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(mappingSql), 'mapping migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(mappingSql), 'mapping migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(mappingSql), 'mapping migration must not alter Marketplace framework tables');
  assert(mappingSql.includes('provider_id TEXT NOT NULL'), 'mapping migration should require provider ownership');
  assert(mappingSql.includes('action1_org_id TEXT NOT NULL'), 'mapping migration should require action1_org_id');
  assert(mappingSql.includes('destination_id TEXT NOT NULL'), 'mapping migration should use neutral destination identity');
  assert(mappingSql.includes('enabled INTEGER NOT NULL DEFAULT 1'), 'mapping migration should include enabled flag');
  assert(mappingSql.includes('action1_ticketing_org_client_mappings(provider_id, action1_org_id)'), 'mapping uniqueness should be scoped by provider');
  assert(mappingSql.includes('action1_ticketing_org_client_mappings(provider_id, enabled)'), 'mapping enabled lookup should be scoped by provider');
  assert(!mappingSql.includes('halo_client_id'), 'new mapping schema should not persist Halo-specific destination columns');

  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS action1_ticketing_endpoint_correlations'), 'lifecycle migration should create action1_ticketing_endpoint_correlations');
  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS action1_ticketing_grouped_correlations'), 'lifecycle migration should create action1_ticketing_grouped_correlations');
  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS action1_ticketing_signal_watermarks'), 'lifecycle migration should create action1_ticketing_signal_watermarks');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace framework tables');
  assert(lifecycleSql.includes('identity_key TEXT NOT NULL'), 'correlation tables should require identity_key');
  assert.strictEqual((lifecycleSql.match(/provider_id TEXT NOT NULL/g) || []).length, 3, 'each state table should require provider ownership');
  assert.strictEqual((lifecycleSql.match(/external_ticket_id TEXT NOT NULL/g) || []).length, 2, 'both correlation tables should require a neutral external ticket ID');
  assert.strictEqual((lifecycleSql.match(/external_display_id TEXT/g) || []).length, 2, 'correlations should retain optional external display IDs');
  assert.strictEqual((lifecycleSql.match(/external_url TEXT/g) || []).length, 2, 'correlations should retain optional external URLs');
  assert.strictEqual((lifecycleSql.match(/provider_metadata_json TEXT/g) || []).length, 2, 'correlations should retain bounded provider metadata');
  assert.strictEqual((lifecycleSql.match(/comparison_version TEXT/g) || []).length, 2, 'correlations should version comparison values');
  assert.strictEqual((lifecycleSql.match(/observed_status_id TEXT/g) || []).length, 2, 'correlations should retain observed status IDs');
  assert.strictEqual((lifecycleSql.match(/observed_status_name TEXT/g) || []).length, 2, 'correlations should retain observed status names');
  assert(lifecycleSql.includes('signal_type TEXT NOT NULL'), 'lifecycle tables should require signal_type');
  assert(lifecycleSql.includes('watermark_value TEXT'), 'watermark table should include watermark_value');
  assert(lifecycleSql.includes('metadata_json TEXT'), 'watermark table should include metadata_json');
  assert(lifecycleSql.includes('(provider_id, identity_key)'), 'endpoint and grouped identity uniqueness should include provider ownership');
  assert(lifecycleSql.includes('(provider_id, org_link_id, endpoint_id, signal_type)'), 'endpoint identity fields should include provider ownership');
  assert(lifecycleSql.includes('(provider_id, org_link_id, signal_type, issue_key)'), 'grouped identity fields should include provider ownership');
  assert(lifecycleSql.includes('(provider_id, org_link_id, signal_type)'), 'watermark uniqueness should include provider ownership');
  assert(!/\bFOREIGN\s+KEY\b|\bREFERENCES\b|ON\s+DELETE\s+CASCADE/i.test(`${mappingSql}\n${lifecycleSql}`), 'mapping deletion must retain tracking rows without foreign-key restrictions or cascades');
  assert(!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:settings|sync_history)\b/i.test(`${mappingSql}\n${lifecycleSql}`), 'migrations must not create Marketplace framework tables');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
