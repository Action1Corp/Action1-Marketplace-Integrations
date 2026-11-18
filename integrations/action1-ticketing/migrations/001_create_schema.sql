CREATE TABLE IF NOT EXISTS action1_ticketing_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'action1-ticketing',
  external_id TEXT,
  name TEXT,
  status TEXT,
  raw_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS action1_ticketing_idx_items_external_id
  ON action1_ticketing_items(external_id);
