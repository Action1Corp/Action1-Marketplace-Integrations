CREATE TABLE IF NOT EXISTS halo_psa_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'halo-psa',
  external_id TEXT,
  name TEXT,
  status TEXT,
  raw_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_halo_psa_items_external_id
  ON halo_psa_items(external_id);
