CREATE TABLE IF NOT EXISTS action1_configuration_manager_reconciliation_state (
  policy_id TEXT PRIMARY KEY,
  last_result TEXT NOT NULL,
  last_completed_at DATETIME,
  summary TEXT NOT NULL,
  last_error TEXT,
  history_run_id TEXT
);
