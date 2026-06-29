CREATE TABLE IF NOT EXISTS jira_cloud_org_project_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action1_org_id TEXT NOT NULL,
  action1_org_name TEXT NOT NULL,
  jira_project_id TEXT NOT NULL,
  jira_project_key TEXT NOT NULL,
  jira_project_name TEXT NOT NULL,
  jira_issue_type_id TEXT NOT NULL,
  jira_issue_type_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (enabled IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_action1_org_id
  ON jira_cloud_org_project_mappings(action1_org_id);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_project_id
  ON jira_cloud_org_project_mappings(jira_project_id);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_project_issue_type
  ON jira_cloud_org_project_mappings(jira_project_id, jira_issue_type_id);

CREATE INDEX IF NOT EXISTS idx_jira_cloud_org_project_mappings_enabled
  ON jira_cloud_org_project_mappings(enabled);
