# Qualys VMDR User Guide

Use this integration to compare Qualys VMDR detections with Action1-managed endpoints and patch information. Results appear in Marketplace dashboards, endpoint and vulnerability lists, and run history.

## Before you begin

- Have a Qualys API username and password that can read hosts, active vulnerability detections, and vulnerability knowledge-base details.
- Know your Qualys API base URL. The prefilled URL is an example for one Qualys platform; replace it if your subscription uses a different platform.
- Configure the shared Action1 API key, secret, and organization in **Marketplace > Settings**. The integration reads that organization's endpoints and vulnerabilities.
- Make sure the Marketplace server can reach the Qualys API and Action1 API.

## Connect Qualys VMDR

1. In **Marketplace**, enable **Qualys VMDR**. If the package is not installed yet, install it first.
2. Open **Qualys VMDR > Settings**.
3. Enter **Qualys Username**, **Qualys Password**, and the **Qualys API Base URL** for your platform.
4. Select **Validate Credentials**. This checks Qualys host API access, not the full detection export or Action1 connection.
5. Select **Save Settings**. Leave the stored secret unchanged when editing other fields.

## Run and schedule syncs

Open **Qualys VMDR > Dashboard** and select **Run Sync Now**. The sync reads active or reopened host detections and vulnerability details from Qualys, then compares them with Action1 endpoints and vulnerabilities. It does not deploy patches. The first run may take longer while CVEs and host records are processed.

For automatic runs, open **Settings**, turn on **Schedule enabled**, choose the days and time, and select **Save Settings**. Leave it off for manual-only operation.

## Review results

- **Dashboard:** Check endpoint coverage, severity totals, patchable and non-patchable CVEs, and the latest run. Export a dashboard snapshot with **PDF**.
- **Endpoints:** Search or filter devices, open a device for its vulnerability details, and see whether it was matched across Qualys and Action1. Export CSV or PDF.
- **Vulnerabilities:** Filter by CVE, score, remediation status, source, or endpoint count. Open a CVE for affected endpoints and vulnerable software. Export CSV or PDF.
- **History:** Check the status and details of recent manual and scheduled syncs.

**Patch Available** means Action1 has a deployable software patch associated with a CVE. **Non Patchable** means no such Action1 catalog match was found by this integration, not that no remediation is possible.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Validation fails | Verify the API base URL belongs to your Qualys platform and the account can list hosts. |
| Validation passes but sync fails | Confirm the account can read VM detections and knowledge-base details; also verify shared Action1 settings. Read History for the failing stage. |
| No detections appear | Confirm Qualys has active or reopened host detections for the assets you expect. |
| Devices show as missing | Check device names in Qualys and Action1; unmatched devices remain visible for comparison. |

Keep the Qualys password in Marketplace settings rather than documentation or exports.
