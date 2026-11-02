# ETP Signing Test (preview only)

Install the packaged integration on the ETP Marketplace feature branch. Open Signing Test, enter an accessible Action1 organization ID, and generate 1–100 sample configurations (or paste an array of `{id, configuration}` objects). Prepare for Review locks the exact JSON. Sign All invokes the host signing-only SDK; the passphrase is handled exclusively by Marketplace. Results are fetched through the integration backend using getSigning.

Prerequisites: ETP mode, the current user's enrolled encrypted key in Marketplace Settings, and the preview signing helper running. This integration never submits Action1 objects and does not schedule background work. Samples are disabled schedules with a harmless output script; signing alone does not establish Action1 API acceptance or endpoint execution.

Test one object, then 24 objects; verify one prompt and one signature per object. Cancel the prompt and retry without losing the review. Try an incorrect passphrase and then the correct one. Retrieve an already signed batch again; no new passphrase should be required. Edit/start a new batch to test changed configurations. Key changes and expired requests must require preparation again. Test separate user accounts to confirm each uses their own key.

Do not publish this test harness to the production catalog. Build: `node scripts/package-integration.js integrations/signing-test`.
