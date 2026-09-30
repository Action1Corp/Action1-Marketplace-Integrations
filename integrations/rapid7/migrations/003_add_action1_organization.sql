ALTER TABLE rapid7_endpoints ADD COLUMN action1_organization_id TEXT;
ALTER TABLE rapid7_endpoints ADD COLUMN action1_organization_name TEXT;
ALTER TABLE rapid7_endpoint_cves ADD COLUMN action1_organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_rapid7_endpoint_cves_org_endpoint ON rapid7_endpoint_cves(run_id, action1_organization_id, endpoint_name);
