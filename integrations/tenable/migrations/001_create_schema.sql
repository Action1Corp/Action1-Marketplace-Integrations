CREATE TABLE IF NOT EXISTS tenable_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'tenable',
  run_id INTEGER,
  endpoint_name TEXT,
  ipv4 TEXT,
  mac TEXT,
  os TEXT,
  action1_id TEXT,
  tenable_has_agent BOOLEAN,
  missing_from_tenable BOOLEAN,
  missing_from_action1 BOOLEAN,
  defender_total_vulns INTEGER DEFAULT 0,
  critical_vulns INTEGER DEFAULT 0,
  high_vulns INTEGER DEFAULT 0,
  medium_vulns INTEGER DEFAULT 0,
  low_vulns INTEGER DEFAULT 0,
  action1_critical_vulns INTEGER DEFAULT 0,
  action1_high_vulns INTEGER DEFAULT 0,
  action1_medium_vulns INTEGER DEFAULT 0,
  action1_low_vulns INTEGER DEFAULT 0,
  patchable_vulns INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenable_endpoint_cves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'tenable',
  run_id INTEGER,
  endpoint_name TEXT,
  cve TEXT,
  severity TEXT,
  status TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenable_endpoints_run ON tenable_endpoints(run_id);
CREATE INDEX IF NOT EXISTS idx_tenable_endpoint_cves_run ON tenable_endpoint_cves(run_id);
CREATE INDEX IF NOT EXISTS idx_tenable_endpoint_cves_endpoint ON tenable_endpoint_cves(endpoint_name);
CREATE INDEX IF NOT EXISTS idx_tenable_endpoint_cves_cve ON tenable_endpoint_cves(cve);
