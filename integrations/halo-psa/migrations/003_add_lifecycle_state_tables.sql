CREATE TABLE IF NOT EXISTS halo_psa_endpoint_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'halo-psa',
  identity_key TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  endpoint_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  linked_ticket_id TEXT NOT NULL,
  payload_hash TEXT,
  linked_ticket_status TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_endpoint_correlations_identity_key
  ON halo_psa_endpoint_correlations(identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_endpoint_correlations_identity_fields
  ON halo_psa_endpoint_correlations(org_link_id, endpoint_id, signal_type);

CREATE INDEX IF NOT EXISTS idx_halo_psa_endpoint_correlations_org_link_id
  ON halo_psa_endpoint_correlations(org_link_id);

CREATE INDEX IF NOT EXISTS idx_halo_psa_endpoint_correlations_signal_type
  ON halo_psa_endpoint_correlations(signal_type);

CREATE TABLE IF NOT EXISTS halo_psa_grouped_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'halo-psa',
  identity_key TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  signal_type TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  linked_ticket_id TEXT NOT NULL,
  payload_hash TEXT,
  linked_ticket_status TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_grouped_correlations_identity_key
  ON halo_psa_grouped_correlations(identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_grouped_correlations_identity_fields
  ON halo_psa_grouped_correlations(org_link_id, signal_type, issue_key);

CREATE INDEX IF NOT EXISTS idx_halo_psa_grouped_correlations_org_link_id
  ON halo_psa_grouped_correlations(org_link_id);

CREATE INDEX IF NOT EXISTS idx_halo_psa_grouped_correlations_signal_type
  ON halo_psa_grouped_correlations(signal_type);

CREATE TABLE IF NOT EXISTS halo_psa_signal_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'halo-psa',
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  signal_type TEXT NOT NULL,
  watermark_value TEXT,
  watermark_at TEXT,
  metadata_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_halo_psa_signal_watermarks_org_signal
  ON halo_psa_signal_watermarks(org_link_id, signal_type);

CREATE INDEX IF NOT EXISTS idx_halo_psa_signal_watermarks_signal_type
  ON halo_psa_signal_watermarks(signal_type);
