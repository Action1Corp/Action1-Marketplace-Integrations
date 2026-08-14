const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '..', 'migrations', '001_create_schema.sql');
const correlationMigrationPath = path.join(__dirname, '..', 'migrations', '002_create_automation_correlations.sql');
const tablesPath = path.join(__dirname, '..', 'policyTables.js');

function run() {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const tablesSource = fs.readFileSync(tablesPath, 'utf8');
  const correlationSql = fs.readFileSync(correlationMigrationPath, 'utf8');

  assert(sql.includes('CREATE TABLE IF NOT EXISTS action1_configuration_manager_policies'));
  assert(sql.includes('policy_id TEXT NOT NULL UNIQUE'));
  assert(sql.includes('policy_sequence INTEGER NOT NULL UNIQUE'));
  assert(sql.includes('CREATE TABLE IF NOT EXISTS action1_configuration_manager_policy_controls'));
  assert(sql.includes('parameters_json TEXT NOT NULL'));
  assert(sql.includes('CREATE TABLE IF NOT EXISTS action1_configuration_manager_scope_reservations'));
  assert(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_policy_controls_policy_control'));
  assert(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_scope_reservations_policy_id'));
  assert(sql.includes('CREATE INDEX IF NOT EXISTS idx_a1cm_scope_reservations_org'));
  assert(!sql.includes('client_secret'));
  assert(!sql.includes('apiSecret'));
  assert(!sql.includes('sync_history'));
  assert(tablesSource.includes("const POLICIES_TABLE = 'action1_configuration_manager_policies';"));
  assert(correlationSql.includes('CREATE TABLE IF NOT EXISTS action1_configuration_manager_automation_correlations'));
  assert(correlationSql.includes('policy_id TEXT NOT NULL'));
  assert(correlationSql.includes('action1_automation_id TEXT NOT NULL'));
  assert(correlationSql.includes('desired_definition_fingerprint TEXT NOT NULL'));
  assert(correlationSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_automation_correlations_policy_group'));
  assert(!correlationSql.includes('run_script_text'));
  assert(!correlationSql.includes('Authorization'));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
