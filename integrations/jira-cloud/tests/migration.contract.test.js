const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const mappingMigrationPath = path.join(__dirname, '..', 'migrations', '002_add_org_project_mappings.sql');
  const mappingSql = fs.readFileSync(mappingMigrationPath, 'utf8');
  const lifecycleMigrationPath = path.join(__dirname, '..', 'migrations', '003_add_lifecycle_state_tables.sql');
  const lifecycleSql = fs.readFileSync(lifecycleMigrationPath, 'utf8');
  const watermarkMigrationPath = path.join(__dirname, '..', 'migrations', '004_add_signal_watermarks.sql');
  const watermarkSql = fs.readFileSync(watermarkMigrationPath, 'utf8');

  assert(mappingSql.includes('CREATE TABLE IF NOT EXISTS jira_cloud_org_project_mappings'), 'mapping migration should create jira_cloud_org_project_mappings');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(mappingSql), 'mapping migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(mappingSql), 'mapping migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(mappingSql), 'mapping migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(mappingSql), 'mapping migration must not alter Marketplace framework tables');
  assert(mappingSql.includes('action1_org_id TEXT NOT NULL'), 'mapping migration should require action1_org_id');
  assert(mappingSql.includes('jira_project_id TEXT NOT NULL'), 'mapping migration should require jira_project_id');
  assert(mappingSql.includes('jira_project_key TEXT NOT NULL'), 'mapping migration should require jira_project_key');
  assert(mappingSql.includes('jira_project_name TEXT NOT NULL'), 'mapping migration should require jira_project_name');
  assert(mappingSql.includes('jira_issue_type_id TEXT NOT NULL'), 'mapping migration should require jira_issue_type_id');
  assert(mappingSql.includes('jira_issue_type_name TEXT NOT NULL'), 'mapping migration should require jira_issue_type_name');
  assert(mappingSql.includes('enabled INTEGER NOT NULL DEFAULT 1'), 'mapping migration should include enabled flag');
  assert(mappingSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_action1_org_id'), 'mapping migration should enforce unique Action1 org mapping');
  assert(!mappingSql.includes('UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_project_id'), 'mapping migration should not enforce unique Jira project mapping');
  assert(mappingSql.includes('CREATE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_project_id'), 'mapping migration should index Jira project id');
  assert(mappingSql.includes('CREATE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_project_issue_type'), 'mapping migration should index Jira project plus issue type');
  assert(mappingSql.includes('CREATE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_enabled'), 'mapping migration should index enabled state');

  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS jira_cloud_endpoint_correlations'), 'lifecycle migration should create endpoint correlation table');
  assert(lifecycleSql.includes('CREATE TABLE IF NOT EXISTS jira_cloud_grouped_correlations'), 'lifecycle migration should create grouped correlation table');
  assert(lifecycleSql.includes('jira_issue_id TEXT NOT NULL'), 'lifecycle migration should store Jira issue ids');
  assert(lifecycleSql.includes('jira_issue_key TEXT NOT NULL'), 'lifecycle migration should store Jira issue keys');
  assert(lifecycleSql.includes('jira_issue_url TEXT'), 'lifecycle migration should store Jira issue URLs');
  assert(lifecycleSql.includes('payload_hash TEXT'), 'lifecycle migration should store payload hashes');
  assert(lifecycleSql.includes('linked_issue_status TEXT'), 'lifecycle migration should store linked issue status');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(lifecycleSql), 'lifecycle migration must not alter Marketplace framework tables');

  assert(watermarkSql.includes('CREATE TABLE IF NOT EXISTS jira_cloud_signal_watermarks'), 'watermark migration should create jira_cloud_signal_watermarks');
  assert(watermarkSql.includes('watermark_value TEXT'), 'watermark migration should include watermark_value');
  assert(watermarkSql.includes('metadata_json TEXT'), 'watermark migration should include metadata_json');
  assert(watermarkSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_signal_watermarks_org_signal'), 'watermark migration should have unique org/signal index');
  assert(!/CREATE TABLE IF NOT EXISTS settings\b/i.test(watermarkSql), 'watermark migration must not alter Marketplace settings table');
  assert(!/CREATE TABLE IF NOT EXISTS sync_history\b/i.test(watermarkSql), 'watermark migration must not alter Marketplace sync_history table');
  assert(!/ALTER TABLE\s+settings\b/i.test(watermarkSql), 'watermark migration must not alter Marketplace framework tables');
  assert(!/ALTER TABLE\s+sync_history\b/i.test(watermarkSql), 'watermark migration must not alter Marketplace framework tables');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
