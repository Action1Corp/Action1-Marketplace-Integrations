# Enrollment and Provisioning

Deploy Action1 agents through Microsoft Intune and report which managed devices are registered in Action1.

## What This Integration Does

- Packages the Action1 Agent MSI as a Microsoft Intune Win32 app.
- Uploads the Action1 macOS PKG as an Intune macOS app (PKG), with version detection ignored because the agent self-updates.
- Creates an Intune Linux Bash-script policy. Linux devices download and install the Action1 DEB or RPM appropriate to their package manager; Intune does not accept DEB/RPM files as apps.
- Reuses one deployment per Action1 organization and selected platform across profiles, updating it when needed.
- Assigns Windows and macOS apps as required installs and targets the Linux script policy to all applicable devices or selected Intune device groups.
- Lets administrators select platforms and Intune groups in each profile's Enrollment Groups step.
- Supports multiple profiles for an Action1 organization; an Action1 provisioning endpoint group can belong to only one profile.
- Compares Intune managed devices with Action1 managed endpoints and reports registered and missing endpoints on the dashboard.
- Shows profile, provisioning status, operating system, and Intune group membership for endpoints when Microsoft Graph returns that data.

## Microsoft Graph Permissions

Configure the Entra ID app registration used by this integration with Microsoft Graph application permissions, then grant admin consent.

Required:

- `DeviceManagementApps.ReadWrite.All` - create, upload, and assign Windows and macOS agent apps.
- `DeviceManagementConfiguration.ReadWrite.All` - create and assign the Linux script policy when Linux is selected.
- `DeviceManagementManagedDevices.Read.All` - read Intune managed devices for endpoint registration comparison.
- `Group.Read.All` - list device groups, validate selected group assignments, and read device group membership.
- `Device.Read.All` - read basic device properties when expanding group membership for endpoint device group names.

Recommended:

- `Directory.Read.All` - broader directory read access that can also prevent redacted group membership results in tenants where `Device.Read.All` is not sufficient. Without a permission that can read device objects, group members may be redacted and the dashboard may show missing or limited group names.

The integration uses the Microsoft identity platform client credentials flow, so delegated user permissions are not used.

The Linux script policy contains organization-specific Action1 agent download URLs. Restrict access to that policy and its exports as you would to the installers themselves. The policy requires Linux devices already enrolled in Intune and able to reach the Action1 download host.

## Assignment Options

Each profile selects Windows, macOS, Linux, or a combination. Existing profiles remain Windows-only until edited. The selected Intune target applies to each chosen platform:

- All devices - required app assignments and the Linux policy target all applicable Intune devices.
- Selected device groups - assignments target the selected Intune device groups.

Create or edit a profile under Profiles to load Intune device groups and select one or more targets. A sync reconciles assignments for the organization's selected platforms and refreshes endpoint and provisioning status on the dashboard.

## Endpoint Registration

During sync, the integration reads Intune managed devices and Action1 managed endpoints, normalizes device names, and counts how many Intune devices are already registered in Action1. Devices found in Intune but not in Action1 are shown in the Endpoint Registration list with operating system, primary user, last Intune sync time, and device group names when available.

Action1 API credentials must be configured in Marketplace settings for endpoint registration comparison and organization-specific installer discovery.

## Files

- `manifest.json` - Marketplace catalog metadata.
- `display.json` - Marketplace sidebar navigation for integration-owned screens.
- ui/settingsSchema.json - Integration-owned settings schema.
- `migrations/` - Integration-owned database schema.
- `index.js` - Small entrypoint that exports Marketplace action handlers.
- Validation action - Integration-owned credential validation logic declared in `manifest.json`.
- List Device Groups action - Reads Intune device groups for the assignment selector.
- Validate Assignments action - Confirms the configured Intune assignments for the selected deployment.
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
- profiles
- history
- settings

