CREATE TABLE IF NOT EXISTS entra_id_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'entra-id',
  external_id TEXT,
  name TEXT,
  status TEXT,
  raw_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entra_id_items_external_id
  ON entra_id_items(external_id);
