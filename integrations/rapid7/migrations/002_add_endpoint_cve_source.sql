ALTER TABLE rapid7_endpoint_cves ADD COLUMN source TEXT DEFAULT 'VM Scanner';
UPDATE rapid7_endpoint_cves SET source = 'Both' WHERE status = 'Patch Available';
