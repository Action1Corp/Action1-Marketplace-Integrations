CREATE TABLE IF NOT EXISTS entra_id_org_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action1_org_id TEXT NOT NULL UNIQUE,
  action1_org_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entra_id_org_mappings_action1_org_name
  ON entra_id_org_mappings(action1_org_name);
