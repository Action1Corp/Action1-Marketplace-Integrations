CREATE TABLE IF NOT EXISTS hello_integration_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  name TEXT,
  raw_json TEXT,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hello_integration_items_external_id
  ON hello_integration_items(external_id);
