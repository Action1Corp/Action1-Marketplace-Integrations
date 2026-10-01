# Microsoft Defender User Guide

Use this integration to compare Microsoft Defender machine vulnerabilities with Action1-managed endpoints and available patch information.

## Before you begin

- Have a Microsoft Entra application with a tenant ID, client ID, and client secret. The application must be able to read Defender machine and vulnerability data.
- Configure the shared Action1 server, API key, and secret in **Marketplace > Settings**. The integration discovers every accessible Action1 organization automatically.
- Make sure the Marketplace server can reach Microsoft sign-in, the Defender API, and the Action1 API.

## Connect Microsoft Defender

1. In **Marketplace**, enable **Microsoft Defender**. If the package is not installed yet, install it first.
2. Open **Microsoft Defender > Settings**.
3. Enter the **Tenant ID**, **Client ID (App ID)**, and **Client Secret**.
4. Check **Defender API Base URL**. Keep the default unless your environment requires another Defender API endpoint.
5. Select **Validate Credentials**, then **Save Settings**. Validation confirms that a token can be acquired; only a sync confirms permission to read machines and vulnerabilities.

## Run and schedule syncs

Open **Microsoft Defender > Dashboard** and select **Run Sync Now**. The integration reads Defender machines and machine vulnerabilities, then compares them with Action1 endpoints and vulnerability information. It does not deploy patches. The dashboard refreshes while the sync runs.

For recurring runs, open **Settings**, turn on **Schedule enabled**, select the days and time, and save. Leave it off to run manually.

## Review results

- **Dashboard:** Review endpoint coverage, severity counts, patchable and non-patchable CVEs, and the latest run. Export a snapshot with **PDF**.
- **Endpoints:** Search or filter devices, inspect vulnerability details, and see whether each device matched Action1. Export CSV or PDF.
- **Vulnerabilities:** Filter by CVE, score, remediation status, source, or affected endpoint count. Open a CVE to see affected endpoints and vulnerable software. Export CSV or PDF.
- **History:** Review status, time, endpoints processed, and detailed errors for each run.

**Patch Available** means Action1 has a deployable software patch associated with the CVE. **Non Patchable** means this integration found no such Action1 catalog match; it does not rule out other remediation.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Validation fails | Recheck tenant ID, app ID, secret, and the app registration. |
| Validation succeeds but sync fails | Verify the application's access to Defender machines and vulnerabilities, then check shared Action1 settings and History details. |
| No machines or findings appear | Confirm data exists in Defender and the API endpoint is correct for your environment. |
| Devices show as unmatched | Compare device names in Defender and Action1; unmatched devices remain visible. |

Keep the client secret in Marketplace settings, not in documentation or exports.
