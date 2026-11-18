CREATE TABLE IF NOT EXISTS action1_ticketing_endpoint_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'action1-ticketing',
  provider_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  endpoint_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  external_ticket_id TEXT NOT NULL,
  external_display_id TEXT,
  external_url TEXT,
  provider_metadata_json TEXT,
  comparison_value TEXT,
  comparison_version TEXT,
  observed_status_id TEXT,
  observed_status_name TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS action1_ticketing_idx_endpoint_correlations_provider_identity
  ON action1_ticketing_endpoint_correlations(provider_id, identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS action1_ticketing_idx_endpoint_correlations_provider_fields
  ON action1_ticketing_endpoint_correlations(provider_id, org_link_id, endpoint_id, signal_type);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_endpoint_correlations_provider_mapping
  ON action1_ticketing_endpoint_correlations(provider_id, org_link_id);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_endpoint_correlations_provider_signal
  ON action1_ticketing_endpoint_correlations(provider_id, signal_type);

CREATE TABLE IF NOT EXISTS action1_ticketing_grouped_correlations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'action1-ticketing',
  provider_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  signal_type TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  external_ticket_id TEXT NOT NULL,
  external_display_id TEXT,
  external_url TEXT,
  provider_metadata_json TEXT,
  comparison_value TEXT,
  comparison_version TEXT,
  observed_status_id TEXT,
  observed_status_name TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS action1_ticketing_idx_grouped_correlations_provider_identity
  ON action1_ticketing_grouped_correlations(provider_id, identity_key);

CREATE UNIQUE INDEX IF NOT EXISTS action1_ticketing_idx_grouped_correlations_provider_fields
  ON action1_ticketing_grouped_correlations(provider_id, org_link_id, signal_type, issue_key);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_grouped_correlations_provider_mapping
  ON action1_ticketing_grouped_correlations(provider_id, org_link_id);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_grouped_correlations_provider_signal
  ON action1_ticketing_grouped_correlations(provider_id, signal_type);

CREATE TABLE IF NOT EXISTS action1_ticketing_signal_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL DEFAULT 'action1-ticketing',
  provider_id TEXT NOT NULL,
  org_link_id TEXT NOT NULL,
  action1_org_id TEXT,
  signal_type TEXT NOT NULL,
  watermark_value TEXT,
  watermark_at TEXT,
  metadata_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS action1_ticketing_idx_signal_watermarks_provider_mapping_signal
  ON action1_ticketing_signal_watermarks(provider_id, org_link_id, signal_type);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_signal_watermarks_provider_signal
  ON action1_ticketing_signal_watermarks(provider_id, signal_type);
