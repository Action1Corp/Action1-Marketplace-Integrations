CREATE TABLE IF NOT EXISTS action1_ticketing_org_client_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  action1_org_id TEXT NOT NULL,
  action1_org_name TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (enabled IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS action1_ticketing_idx_mappings_provider_action1_org
  ON action1_ticketing_org_client_mappings(provider_id, action1_org_id);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_mappings_provider_enabled
  ON action1_ticketing_org_client_mappings(provider_id, enabled);
