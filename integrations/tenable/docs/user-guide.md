# Tenable VM User Guide

Use this integration to compare Tenable VM findings with Action1-managed endpoints and available patch information. It provides a dashboard, endpoint inventory, vulnerability list, and sync history inside Marketplace.

## Before you begin

- Have a Tenable VM access key and secret key for an account that can read assets and vulnerability exports.
- Configure the shared Action1 API key, secret, and organization in **Marketplace > Settings**. The integration uses that organization for endpoint and vulnerability matching.
- Make sure the Marketplace server can reach Tenable Cloud and the Action1 API.

## Connect Tenable VM

1. In **Marketplace**, enable **Tenable VM**. If the package is not installed yet, install it first.
2. Open **Tenable VM > Settings**.
3. Enter the **Access Key** and **Secret Key**.
4. Select **Validate Credentials**. A successful result confirms the Tenable connection; it does not run a full sync or verify the shared Action1 settings.
5. Select **Save Settings**. Stored secrets can be left unchanged when you edit other settings.

## Run and schedule syncs

Open **Tenable VM > Dashboard** and select **Run Sync Now**. The first sync may take time while Tenable exports and vulnerability scores are processed. The dashboard refreshes while a sync is running. In **Settings**, turn on **Schedule enabled**, choose the days and time, and save to run future syncs automatically. Leave the schedule off if you only want manual runs.

The sync retrieves Tenable vulnerability and asset data, Action1 endpoints and vulnerability information, then matches devices and CVEs for reporting. It does not deploy patches. A device can appear as missing from one system when no matching record was found there.

## Review results

- **Dashboard:** Review endpoint coverage, severity counts, patchable and non-patchable CVEs, and the latest run. Use **PDF** to export a dashboard snapshot.
- **Endpoints:** Search or filter devices, inspect their vulnerability details and whether they appear in both systems, and export the list as CSV or PDF.
- **Vulnerabilities:** Filter by CVE, score, remediation status, source, or affected endpoint count. Open a CVE to see affected endpoints and vulnerable software. Export the list as CSV or PDF.
- **History:** Review run status, time, endpoints processed, and details when a run fails or is interrupted.

**Patch Available** means Action1 has a deployable software patch associated with the CVE. **Non Patchable** means this integration did not find one in the Action1 catalog; it does not prove that no other remediation exists.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Validation fails | Recheck both Tenable keys and whether the account can access Tenable VM. |
| Validation succeeds but sync fails | Check shared Action1 credentials and organization in Marketplace Settings, then read the run details in History. |
| No or few results | Confirm that Tenable has scanned assets and findings, and that device names can be matched to Action1 endpoints. |
| Results look old | Check the most recent successful run in History and the schedule in Settings. |

Keep API secrets in Marketplace settings, not in screenshots, exports, or this guide.
