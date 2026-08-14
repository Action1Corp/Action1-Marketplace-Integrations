CREATE TABLE IF NOT EXISTS action1_configuration_manager_automation_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL,
  automation_group_id TEXT NOT NULL,
  automation_group_version TEXT NOT NULL,
  control_family_name_snapshot TEXT NOT NULL,
  action1_organization_id TEXT NOT NULL,
  action1_automation_id TEXT NOT NULL,
  action1_automation_name TEXT NOT NULL,
  action1_automation_self TEXT NOT NULL,
  desired_definition_fingerprint TEXT NOT NULL,
  last_applied_at DATETIME NOT NULL,
  last_error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_automation_correlations_policy_group
  ON action1_configuration_manager_automation_correlations (policy_id, automation_group_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_automation_correlations_action1_id
  ON action1_configuration_manager_automation_correlations (action1_organization_id, action1_automation_id);

CREATE INDEX IF NOT EXISTS idx_a1cm_automation_correlations_policy
  ON action1_configuration_manager_automation_correlations (policy_id);
