ALTER TABLE qualys_endpoint_cves ADD COLUMN source TEXT DEFAULT 'VM Scanner';
UPDATE qualys_endpoint_cves SET source = 'Both' WHERE status = 'Patch Available';
