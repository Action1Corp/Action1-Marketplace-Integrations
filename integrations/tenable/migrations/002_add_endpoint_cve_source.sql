ALTER TABLE tenable_endpoint_cves ADD COLUMN source TEXT DEFAULT 'VM Scanner';
UPDATE tenable_endpoint_cves SET source = 'Both' WHERE status = 'Patch Available';
