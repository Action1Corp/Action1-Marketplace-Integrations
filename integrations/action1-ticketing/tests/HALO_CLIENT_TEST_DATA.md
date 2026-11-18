# Halo Client Test Data Utility

This manual utility is for **non-production Action1 Ticketing tenants only**.

It helps validate that the Marketplace Action1 Ticketing `Client Mapping` discovery path can load clients beyond the first 50 results.

## Files

- Utility: `integrations/action1-ticketing/tests/haloClientTestData.manual.js`
- Contract tests: `integrations/action1-ticketing/tests/haloClientTestData.contract.test.js`

## Required Halo Permissions

- Create test clients: `AgentCustomers Modify`
- Delete test clients: `AdminCustomers Modify`

Cleanup uses the confirmed Halo API contract:

- `DELETE /Client/{id}`
- Halo deletes the client **and related objects** for that exact client ID

## Configuration

The utility reads the same Halo connection keys used by the Marketplace package from environment variables:

- `TicketingResourceServer`
- `TicketingAuthorisationServer`
- `TicketingClientId`
- `TicketingClientSecret`

Do not paste secrets into command arguments.

PowerShell example:

```powershell
$env:TicketingResourceServer='https://halo.example.com/api'
$env:TicketingAuthorisationServer='https://halo.example.com/auth'
$env:TicketingClientId='halo-client-id'
$env:TicketingClientSecret='stored-secret-value'
```

## Naming Format

Generated clients use a clearly temporary prefix plus a unique UTC run ID and zero-padded sequence:

```text
A1 Pagination Test 20260722-123456 001
A1 Pagination Test 20260722-123456 002
...
```

Defaults and limits:

- Default count: `120`
- Hard maximum: `500`

## Minimal Create Payload

The utility sends the smallest payload supported by the current local evidence:

```json
[
  {
    "name": "A1 Pagination Test 20260722-123456 001"
  }
]
```

Evidence used:

- the confirmed task contract states `POST /Client` accepts an array of client objects and creates a client when `id` is omitted
- the local Marketplace repository does not contain evidence that additional client fields are required
- the utility does **not** auto-probe live writes during implementation; the first operator-approved `create` run is the explicit non-production validation step

## Manifest Location

Successful and partial create runs write an incremental manifest under:

```text
integrations/action1-ticketing/.runtime-logs/manual-client-test-data/<run-id>.json
```

The package `.runtime-logs` directory is already Git-ignored.

The manifest stores only safe metadata:

- schema version
- sanitized Halo resource server identifier
- run ID
- create timestamp
- requested count
- created Halo client IDs and generated names
- sanitized failure summaries
- cleanup progress for exact manifest IDs

The manifest does **not** store:

- client secrets
- bearer tokens
- authorization headers
- full API payloads
- unrelated customer data

## Commands

### Plan

Show exactly what would be created without live writes:

```powershell
node integrations/action1-ticketing/tests/haloClientTestData.manual.js plan --count 120
```

### Create

Create temporary clients sequentially, one `POST /Client` request per client:

```powershell
node integrations/action1-ticketing/tests/haloClientTestData.manual.js create --count 120 --confirm --ack-non-production
```

Safety rules:

- both `--confirm` and `--ack-non-production` are required
- without both flags, the utility prints the planned operation and performs **no** live writes

### Verify

Verify the exact manifest IDs against the current paginated Halo `/Client` catalog:

```powershell
node integrations/action1-ticketing/tests/haloClientTestData.manual.js verify --manifest integrations/action1-ticketing/.runtime-logs/manual-client-test-data/<run-id>.json
```

The verify operation:

- reuses the Marketplace package’s paginated Halo client discovery seam
- compares exact manifest IDs
- reports:
  - expected generated count
  - found count
  - missing IDs
  - name mismatches
  - total Halo client count

### Cleanup Dry Run

List the exact recorded client IDs that would be deleted:

```powershell
node integrations/action1-ticketing/tests/haloClientTestData.manual.js cleanup --manifest integrations/action1-ticketing/.runtime-logs/manual-client-test-data/<run-id>.json --dry-run
```

`--dry-run` performs no `DELETE` requests.

### Live Cleanup

Delete only the exact client IDs stored in the selected manifest:

```powershell
node integrations/action1-ticketing/tests/haloClientTestData.manual.js cleanup --manifest integrations/action1-ticketing/.runtime-logs/manual-client-test-data/<run-id>.json --confirm --ack-non-production
```

Cleanup rules:

- both `--confirm` and `--ack-non-production` are required
- only exact manifest IDs are eligible
- the utility never selects cleanup targets by name prefix
- invalid or missing manifest IDs are rejected before any HTTP request
- deletes run sequentially, one `DELETE /Client/{id}` request at a time
- successful deletions are persisted incrementally in the manifest
- reruns skip entries already marked as successfully deleted

## Recovery After Partial Create

If create partially fails:

1. keep the manifest file
2. use `verify` to check which exact generated IDs currently exist
3. use `cleanup --dry-run` to inspect exact cleanup targets
4. use live `cleanup` only after confirming the manifest and tenant are correct

## Marketplace Validation Steps

After a successful create run:

1. Open the Marketplace Action1 Ticketing `Client Mapping` page.
2. Click `Refresh Discovery`.
3. Confirm generated clients beyond the first 50 are visible.
4. Compare the visible/found count with the manifest and `verify` output.

## Safety Summary

- Non-production tenants only
- No secrets should be committed or pasted into command arguments
- Do not run create or cleanup without explicit confirmation flags
- Review the manifest before cleanup
- Cleanup deletes the Halo client and related objects for the exact manifest ID
