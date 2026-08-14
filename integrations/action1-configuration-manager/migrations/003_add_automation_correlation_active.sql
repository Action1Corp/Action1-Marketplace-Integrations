ALTER TABLE action1_configuration_manager_automation_correlations
  ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_a1cm_automation_correlations_active
  ON action1_configuration_manager_automation_correlations (policy_id, active);
