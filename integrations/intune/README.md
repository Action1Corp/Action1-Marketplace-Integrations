# Microsoft Intune

Create and maintain the Action1 Agent Win32 app in Microsoft Intune, assign it to devices, and report which Intune managed devices are registered in Action1.

## What This Integration Does

- Packages the Action1 Agent MSI as a Microsoft Intune Win32 app.
- Creates or updates a single Action1 Agent app in Intune when the Action1 Agent version changes.
- Assigns that app as a required install target to either all Intune devices or selected Intune device groups.
- Lists Intune device groups in the settings page so administrators can choose the assignment target.
- Validates that the Intune app assignment matches the selected target mode.
- Compares Intune managed devices with Action1 managed endpoints and reports registered and missing endpoints on the dashboard.
- Shows Intune group membership for missing endpoints when Microsoft Graph returns device group membership data.

## Microsoft Graph Permissions

Configure the Entra ID app registration used by this integration with Microsoft Graph application permissions, then grant admin consent.

Required:

- `DeviceManagementApps.ReadWrite.All` - read, create, update, upload content for, and assign the Action1 Agent Win32 app.
- `DeviceManagementManagedDevices.Read.All` - read Intune managed devices for endpoint registration comparison.
- `Group.Read.All` - list device groups, validate selected group assignments, and read device group membership.
- `Device.Read.All` - read basic device properties when expanding group membership for endpoint device group names.

Recommended:

- `Directory.Read.All` - broader directory read access that can also prevent redacted group membership results in tenants where `Device.Read.All` is not sufficient. Without a permission that can read device objects, group members may be redacted and the dashboard may show missing or limited group names.

The integration uses the Microsoft identity platform client credentials flow, so delegated user permissions are not used.

## Assignment Options

The Action1 Enrollment settings support two target modes:

- All devices - the single Action1 Agent Win32 app is assigned as a required install to Intune All devices.
- Selected device groups - the single Action1 Agent Win32 app is assigned as a required install to each selected Intune device group.

Use Load Device Groups to read available device groups from Intune, then select one or more groups. The selected group names are stored with the settings so the dashboard can show human-readable assignment targets.

Use Validate Assignments to confirm that the Action1 Agent app in Intune has the expected required assignments. Validation checks for the All devices assignment in All devices mode, or verifies that each selected group has a required assignment in Selected device groups mode.

## Endpoint Registration

During sync, the integration reads Intune managed devices and Action1 managed endpoints, normalizes device names, and counts how many Intune devices are already registered in Action1. Devices found in Intune but not in Action1 are shown in the Endpoint Registration list with operating system, primary user, last Intune sync time, and device group names when available.

Action1 API credentials must be configured in Marketplace settings for endpoint registration comparison. If Action1 credentials are missing, the app version and assignment checks can still run, but endpoint registration reporting is skipped.

## Files

- `manifest.json` - Marketplace catalog metadata.
- `display.json` - Marketplace sidebar navigation for integration-owned screens.
- ui/settingsSchema.json - Integration-owned settings schema.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace action handlers.
- Validation action - Integration-owned credential validation logic declared in `manifest.json`.
- List Device Groups action - Reads Intune device groups for the assignment selector.
- Validate Assignments action - Confirms the Intune app is associated with the configured assignment target.
- Sync action - Integration-owned job logic for collecting and writing integration data declared in `manifest.json`.

## Runtime Behavior

The Marketplace infers supported operations from this integration's files, manifest actions, and exported action handlers:

- Settings are available because this package provides `ui/settingsSchema.json` and a settings view.
- Credential validation is available because this package declares a validation action and exports the matching action handler.
- Device group loading is available because this package declares a read action and exports the matching action handler.
- Assignment validation is available because this package declares a validation action and exports the matching action handler.
- Manual runs and scheduling are available because this package declares a sync action and exports the matching action handler.
- Run history is available to integration-owned views through Marketplace APIs.

## Integration-Owned Views

- dashboard
- history
- settings

