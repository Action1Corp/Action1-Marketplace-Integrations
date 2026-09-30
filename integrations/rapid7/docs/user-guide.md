# Rapid7 InsightVM User Guide

Use this integration to compare Rapid7 InsightVM assets and vulnerabilities with Action1-managed endpoints and patch information. Marketplace provides a dashboard, endpoint and vulnerability lists, and sync history.

## Before you begin

- Have a Rapid7 Insight API key with access to InsightVM assets and vulnerability details.
- Know the Insight region where your data resides. The region setting controls the API host used by this integration.
- Configure the shared Action1 API key, secret, and organization in **Marketplace > Settings**.
- Make sure the Marketplace server can reach the Rapid7 regional API and Action1 API.

## Connect Rapid7 InsightVM

1. In **Marketplace**, enable **Rapid7 InsightVM**. If the package is not installed yet, install it first.
2. Open **Rapid7 InsightVM > Settings**.
3. Enter the **Insight API Key** and select the **Insight Region**.
4. Select **Validate Credentials**. Validation requests a small asset sample. If the selected region has no assets, validation reports that even if the key is otherwise valid; confirm the region and available data.
5. Select **Save Settings**. A stored key can be left unchanged when editing the region or schedule.

## Run and schedule syncs

Open **Rapid7 InsightVM > Dashboard** and select **Run Sync Now**. The integration reads InsightVM assets and their vulnerability mappings, then compares them with Action1 endpoints and vulnerability information. It does not deploy patches. The dashboard refreshes as the run progresses.

For automatic runs, open **Settings**, turn on **Schedule enabled**, choose the days and time, and save. Leave the schedule off for manual-only operation.

## Review results

- **Dashboard:** Review endpoint coverage, severity counts, patchable and non-patchable CVEs, and the latest run. Use **PDF** for a snapshot.
- **Endpoints:** Search or filter devices, inspect vulnerability details, and see which assets matched Action1. Export CSV or PDF.
- **Vulnerabilities:** Filter CVEs by score, remediation status, source, or affected endpoint count. Open a CVE to see affected endpoints and vulnerable software. Export CSV or PDF.
- **History:** Review run status, time, endpoints processed, and error details.

**Patch Available** means the integration found an Action1 deployable software patch for a CVE. **Non Patchable** means it did not find one in Action1; other remediation may still exist.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Validation reports no assets | Check that the selected region contains your InsightVM data and that the key can read assets. |
| Validation passes but sync fails | Check shared Action1 settings and the run details in History; the full sync reads more than the validation sample. |
| Fewer assets than expected | Confirm the API key's asset access and review name matching with Action1. |
| Results look old | Check the most recent successful run and saved schedule. |

Keep the Insight API key in Marketplace settings, not in documentation or exports.
