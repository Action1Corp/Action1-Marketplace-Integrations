CREATE TABLE IF NOT EXISTS jira_cloud_signal_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'jira-cloud',
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  signal_type TEXT NOT NULL,
  watermark_value TEXT,
  watermark_at TEXT,
  metadata_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_signal_watermarks_org_signal
  ON jira_cloud_signal_watermarks(org_link_id, signal_type);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_signal_watermarks_signal_type
  ON jira_cloud_signal_watermarks(signal_type);
