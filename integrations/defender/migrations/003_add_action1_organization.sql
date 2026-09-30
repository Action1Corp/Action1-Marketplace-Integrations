ALTER TABLE defender_endpoints ADD COLUMN action1_organization_id TEXT;
ALTER TABLE defender_endpoints ADD COLUMN action1_organization_name TEXT;
ALTER TABLE defender_endpoint_cves ADD COLUMN action1_organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_defender_endpoint_cves_org_endpoint ON defender_endpoint_cves(run_id, action1_organization_id, endpoint_name);
