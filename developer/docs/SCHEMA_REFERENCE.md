# Schema Reference

Integrations own their database schema. The Marketplace applies integration migrations at startup and records which migration files have run.

## Migration Rules

- Store migration files under `migrations/`.
- Use stable ordered names such as `001_create_schema.sql`.
- Keep migrations additive after release. Do not rewrite an already-released migration.
- Prefix integration-owned tables with the integration ID converted to snake_case.
- Do not create or alter Marketplace framework tables.

The Marketplace supports local Postgres and Supabase Postgres. Existing migrations use a portable SQL subset that the Marketplace normalizes for Postgres.

## Standard Vulnerability Tables

If the integration uses the standard dashboard, endpoints, or vulnerabilities renderers, create:

```text
<integration_id>_endpoints
<integration_id>_endpoint_cves
```

Example for `acme-vm`:

```text
acme_vm_endpoints
acme_vm_endpoint_cves
```

At runtime, use:

```js
const { endpoints, endpointCves } = context.db.tables;
```

Do not hard-code table names in sync logic unless there is no alternative.

## `<integration_id>_endpoints`

Recommended baseline:

```sql
CREATE TABLE IF NOT EXISTS acme_vm_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'acme-vm',
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
```

Key columns:

- `integration_id`: integration ID.
- `run_id`: `sync_history.id` for the run that produced the row.
- `endpoint_name`: primary display name.
- `ipv4`, `mac`, `os`: optional endpoint inventory fields.
- `action1_id`: Action1 endpoint ID when mapped.
- `missing_from_tenable`: true when the asset exists in Action1 but not the vendor tool. The historical column name is retained for renderer compatibility.
- `missing_from_action1`: true when the vendor asset does not map to Action1.
- `critical_vulns`, `high_vulns`, `medium_vulns`, `low_vulns`: vendor vulnerability counts after deduplication.
- `action1_critical_vulns`, `action1_high_vulns`, `action1_medium_vulns`, `action1_low_vulns`: Action1 vulnerability counts.
- `patchable_vulns`: vendor CVEs with an available Action1 patch.

The renderer also computes:

- `integration_total_vulns`
- `action1_total_vulns`

from severity columns when needed.

## `<integration_id>_endpoint_cves`

Recommended baseline:

```sql
CREATE TABLE IF NOT EXISTS acme_vm_endpoint_cves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT DEFAULT 'acme-vm',
  run_id INTEGER,
  endpoint_name TEXT,
  cve TEXT,
  severity TEXT,
  status TEXT
);
```

Key columns:

- `integration_id`: integration ID.
- `run_id`: sync run ID.
- `endpoint_name`: endpoint this CVE was observed on.
- `cve`: CVE ID.
- `severity`: `Critical`, `High`, `Medium`, `Low`, or vendor-equivalent value.
- `status`: patchability or remediation status. Current standard values include `Patch Available`, `No Patch Available`, and `Not Recognized`.

The vulnerabilities view joins `cve_details` for plugin name, description, and solution when available.

## Indexes

Add indexes for common filters:

```sql
CREATE INDEX IF NOT EXISTS idx_acme_vm_endpoints_run
  ON acme_vm_endpoints(run_id);

CREATE INDEX IF NOT EXISTS idx_acme_vm_endpoint_cves_run
  ON acme_vm_endpoint_cves(run_id);

CREATE INDEX IF NOT EXISTS idx_acme_vm_endpoint_cves_endpoint
  ON acme_vm_endpoint_cves(endpoint_name);

CREATE INDEX IF NOT EXISTS idx_acme_vm_endpoint_cves_cve
  ON acme_vm_endpoint_cves(cve);
```

## Integrations Without Endpoint Data

Not every integration needs endpoint or vulnerability tables.

For settings-only, validation-only, or status-only integrations:

- omit standard endpoint/CVE display sections
- omit endpoint/CVE tables
- keep only the vendor-specific schema needed by the integration

Example: an Intune-style integration may only need settings and run history.

## Shared Marketplace Tables

The Marketplace owns:

- settings and encrypted secrets
- authentication and organization membership
- sync history
- schedules
- CVE metadata/cache
- migration tracking

Integrations may write sync history through `sdk` helpers and may update shared CVE metadata where useful. They must not alter Marketplace-owned table structure.

