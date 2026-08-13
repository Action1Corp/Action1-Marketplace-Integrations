CREATE TABLE IF NOT EXISTS action1_configuration_manager_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_sequence INTEGER NOT NULL UNIQUE,
  policy_id TEXT NOT NULL UNIQUE,
  base_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  organization_id TEXT NOT NULL,
  organization_name_snapshot TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  endpoint_group_id TEXT,
  endpoint_group_name_snapshot TEXT,
  policy_mode TEXT NOT NULL,
  run_every_hours INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  completion_deadline_minutes INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  control_pack_id TEXT NOT NULL,
  control_pack_version TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action1_configuration_manager_policy_controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL,
  control_id TEXT NOT NULL,
  control_version TEXT NOT NULL,
  automation_group_id TEXT NOT NULL,
  automation_group_version TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action1_configuration_manager_scope_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  endpoint_group_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_policy_controls_policy_control
  ON action1_configuration_manager_policy_controls (policy_id, control_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_a1cm_scope_reservations_policy_id
  ON action1_configuration_manager_scope_reservations (policy_id);

CREATE INDEX IF NOT EXISTS idx_a1cm_scope_reservations_org
  ON action1_configuration_manager_scope_reservations (organization_id, scope_type, endpoint_group_id);
