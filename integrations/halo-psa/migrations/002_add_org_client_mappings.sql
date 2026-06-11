CREATE TABLE IF NOT EXISTS halo_psa_org_client_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action1_org_id TEXT NOT NULL,
  action1_org_name TEXT NOT NULL,
  halo_client_id TEXT NOT NULL,
  halo_client_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (enabled IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_action1_org_id
  ON halo_psa_org_client_mappings(action1_org_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_halo_client_id
  ON halo_psa_org_client_mappings(halo_client_id);

CREATE INDEX IF NOT EXISTS idx_halo_psa_org_client_mappings_enabled
  ON halo_psa_org_client_mappings(enabled);
