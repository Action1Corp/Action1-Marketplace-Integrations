ALTER TABLE defender_endpoint_cves ADD COLUMN source TEXT DEFAULT 'VM Scanner';
UPDATE defender_endpoint_cves SET source = 'Both' WHERE status = 'Patch Available';
