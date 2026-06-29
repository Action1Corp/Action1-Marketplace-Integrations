CREATE TABLE IF NOT EXISTS jira_cloud_endpoint_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'jira-cloud',
  identity_key TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  endpoint_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  jira_issue_id TEXT NOT NULL,
  jira_issue_key TEXT NOT NULL,
  jira_issue_url TEXT,
  payload_hash TEXT,
  linked_issue_status TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_endpoint_correlations_identity_key
  ON jira_cloud_endpoint_correlations(identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_endpoint_correlations_identity_fields
  ON jira_cloud_endpoint_correlations(org_link_id, endpoint_id, signal_type);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_endpoint_correlations_org_link_id
  ON jira_cloud_endpoint_correlations(org_link_id);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_endpoint_correlations_signal_type
  ON jira_cloud_endpoint_correlations(signal_type);

CREATE TABLE IF NOT EXISTS jira_cloud_grouped_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'jira-cloud',
  identity_key TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  signal_type TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  jira_issue_id TEXT NOT NULL,
  jira_issue_key TEXT NOT NULL,
  jira_issue_url TEXT,
  payload_hash TEXT,
  linked_issue_status TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_grouped_correlations_identity_key
  ON jira_cloud_grouped_correlations(identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_grouped_correlations_identity_fields
  ON jira_cloud_grouped_correlations(org_link_id, signal_type, issue_key);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_grouped_correlations_org_link_id
  ON jira_cloud_grouped_correlations(org_link_id);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_grouped_correlations_signal_type
  ON jira_cloud_grouped_correlations(signal_type);
