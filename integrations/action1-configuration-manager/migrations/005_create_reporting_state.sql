CREATE TABLE IF NOT EXISTS action1_configuration_manager_reporting (
  singleton_id INTEGER PRIMARY KEY,
  data_source_id TEXT,
  report_by_endpoint TEXT,
  report_details TEXT,
  report_by_control TEXT,
  report_by_policy TEXT,
  report_by_status TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
