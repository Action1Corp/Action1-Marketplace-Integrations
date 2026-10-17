# Action1 Entra ID Integration --- User Guide

The Action1 Entra ID integration synchronizes Microsoft Entra device
information to Action1 managed endpoints. It brings Entra group
membership and device ownership information into Action1 custom
attributes, where that information can be used for endpoint filtering,
grouping, reporting, and automation.

The integration reads data from Microsoft Entra ID through Microsoft
Graph and updates matching endpoints in Action1. It does **not** make
changes to Microsoft Entra ID.

## How the integration works

During synchronization, the integration:

1.  Reads devices from Microsoft Entra ID.
2.  Reads each device's direct Entra group memberships.
3.  Reads managed endpoints from the mapped Action1 Organizations.
4.  Matches Entra devices to Action1 endpoints by device name.
5.  Updates the configured Action1 custom attributes on uniquely matched
    endpoints.

By default, the integration populates:

-   **Entra Groups** --- a comma-separated list of the device's direct
    Entra group memberships.
-   **Entra Device Ownership** --- the Entra `deviceOwnership` value,
    such as `company` or `personal`.

Action1 credentials and the Action1 regional API endpoint are managed by
Marketplace. No Action1 API URL, API key, or API secret is entered in
this integration.

------------------------------------------------------------------------

# Before you begin

The following are required:

-   A Microsoft Entra tenant.
-   A Microsoft Entra application registration for the integration.
-   The Entra Directory (tenant) ID.
-   The application (client) ID.
-   A client secret.
-   The required Microsoft Graph **Application permissions**.
-   Marketplace Action1 credentials that can discover Organizations,
    read managed endpoints, and update endpoint attributes.
-   The required custom attributes in every Action1 Organization that
    will be synchronized.
-   At least one Action1 Organization mapping.

Using a dedicated Microsoft Entra application registration for the
Action1 integration is recommended.

## Microsoft Graph permissions

The integration uses the OAuth 2.0 client credentials flow. It runs as
an application rather than as a signed-in Microsoft user, so permissions
must be configured as **Application permissions**, not Delegated
permissions.

Configure:

  -----------------------------------------------------------------------
  Permission                          Purpose
  ----------------------------------- -----------------------------------
  `Device.Read.All`                   Read devices and device properties
                                      from Microsoft Entra ID

  `GroupMember.Read.All`              Read group memberships and the
                                      basic group information needed for
                                      synchronized group names
  -----------------------------------------------------------------------

Both require administrator consent when used as Microsoft Graph
application permissions. The integration is read-only on the Microsoft
side and does not require Graph write permissions.

Microsoft documentation:

-   [Register an application with Microsoft Entra
    ID](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
-   [Microsoft Graph --- List
    devices](https://learn.microsoft.com/en-us/graph/api/device-list?view=graph-rest-1.0)
-   [Microsoft Graph --- List device
    memberships](https://learn.microsoft.com/en-us/graph/api/device-list-memberof?view=graph-rest-1.0)
-   [Microsoft Graph permissions
    reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
-   [Grant tenant-wide admin
    consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent)

> **Note:** The earlier standalone connector documentation used the
> broader `Directory.Read.All` permission. The Marketplace integration
> uses the more targeted permissions above for its current Microsoft
> Graph operations.

------------------------------------------------------------------------

# Step 1 --- Create the Microsoft Entra application

Sign in to the [Microsoft Entra admin
center](https://entra.microsoft.com/) with an account that can register
applications and grant the required permissions.

1.  Open **Entra ID** and go to **App registrations**.
2.  Select **New registration**.
3.  Enter a descriptive name, such as `Action1 Integration`.
4.  For a normal single-tenant deployment, select the account type
    appropriate for the organization's tenant.
5.  Select **Register**.

On the application's **Overview** page, copy:

-   **Application (client) ID**
-   **Directory (tenant) ID**

## Add Microsoft Graph permissions

In the application registration:

1.  Open **API permissions**.
2.  Select **Add a permission**.
3.  Select **Microsoft Graph**.
4.  Select **Application permissions**.
5.  Add `Device.Read.All`.
6.  Add `GroupMember.Read.All`.
7.  Select **Grant admin consent** for the organization.

Verify that the permissions show as granted before continuing.

## Create a client secret

1.  Open **Certificates & secrets**.
2.  Select **New client secret**.
3.  Enter a description such as `Action1 Marketplace`.
4.  Select an expiration period that follows the organization's
    credential-rotation policy.
5.  Create the secret.
6.  Copy the **secret Value** immediately and store it securely.

Use the secret **Value**, not the secret ID, in Action1 Marketplace.
When the secret expires, create a replacement and update the integration
settings.

------------------------------------------------------------------------

# Step 2 --- Prepare Action1

## Action1 access

Action1 API credentials are managed by Marketplace and are not entered
again in the Entra ID integration.

The Marketplace credentials must be able to:

-   discover Action1 Organizations;
-   read managed endpoints;
-   update managed endpoint attributes.

The integration only writes the configured custom attributes. It does
not change endpoint names, endpoint status, or other standard Action1
endpoint properties.

Marketplace also supplies the correct regional Action1 API endpoint
automatically. There is no Action1 region or API URL setting to
configure.

## Create the custom attributes

Before the first synchronization, create the destination custom
attributes in **every Action1 Organization that will be mapped**.

The default names are:

-   `Entra Groups`
-   `Entra Device Ownership`

The names configured in Marketplace must match the Action1 custom
attribute names exactly.

The integration does not create missing custom attributes automatically.
If an attribute is missing in a mapped Organization, updates to affected
endpoints can fail.

The names can be changed in Settings. Changing an attribute name later
does not migrate or clear data previously written to the old attribute.

------------------------------------------------------------------------

# Step 3 --- Configure the integration

Open the Entra ID integration in Action1 Marketplace and go to
**Settings**.

## Entra Configuration

  -----------------------------------------------------------------------
  Setting                             Value
  ----------------------------------- -----------------------------------
  **Entra Directory ID**              Directory (tenant) ID from the
                                      Entra application

  **Entra Application Client ID**     Application (client) ID

  **Entra Client Secret**             Client secret Value
  -----------------------------------------------------------------------

Save the connection settings. The client secret is stored as a secret
setting and is masked after saving.

## Action1 Custom Attributes

Confirm the destination attribute names:

  -----------------------------------------------------------------------
  Setting                             Default
  ----------------------------------- -----------------------------------
  **Entra Groups custom attribute     `Entra Groups`
  name**                              

  **Entra Device Ownership custom     `Entra Device Ownership`
  attribute name**                    
  -----------------------------------------------------------------------

If different Action1 custom attribute names are used, enter those exact
names and save the attribute settings.

------------------------------------------------------------------------

# Step 4 --- Test the Entra connection

Select **Test Connection**.

The test authenticates to Microsoft Entra, obtains a Microsoft Graph
access token, and performs a basic Graph device read.

A successful test confirms that the integration can authenticate and
perform its basic Microsoft Graph read operation.

Test Connection does **not** validate Action1 credentials, Action1
Organization mappings, Action1 endpoint permissions, custom-attribute
existence, or a complete synchronization.

------------------------------------------------------------------------

# Step 5 --- Map Action1 Organizations

Open **Organization Mapping**.

The configured Entra tenant is the source. Mapping determines which
Action1 Organizations receive synchronized Entra data.

1.  Refresh the Action1 Organization list if necessary.
2.  Add each Action1 Organization that should receive Entra data.
3.  Save the mappings.

Multiple Action1 Organizations can be mapped to the configured Entra
tenant. Each Action1 Organization can appear only once. Unmapped
Organizations are ignored.

Mapping controls synchronization scope; it does not change
device-matching rules.

------------------------------------------------------------------------

# Step 6 --- Run the first synchronization

Open **Sync** and select **Run Sync**.

A run:

1.  Validates the Entra configuration, Marketplace Action1 connection,
    regional Action1 endpoint, and Organization mappings.
2.  Authenticates to Action1 and Microsoft Graph.
3.  Reads Entra devices and direct group memberships.
4.  Reads managed endpoints from each mapped Action1 Organization.
5.  Matches Entra devices to endpoints.
6.  Builds custom-attribute updates.
7.  Updates uniquely matched Action1 endpoints.
8.  Records the result in Marketplace History.

Mapped Organizations are processed independently. A failure in one
Organization does not automatically prevent other mapped Organizations
from being processed.

The current integration applies safety limits of up to **50 endpoint
updates per Organization job** and **200 endpoint updates per
synchronization run**.

------------------------------------------------------------------------

# How devices are matched

Matching is based on device names:

-   Microsoft Entra `displayName`
-   Action1 `device_name`, with Action1 `name` as a fallback

Names are trimmed and compared case-insensitively.

``` text
Entra:   LAPTOP-01
Action1: laptop-01
Result:  Match
```

A short-name fallback also allows a fully qualified name to match its
short hostname:

``` text
Entra:   LAPTOP-01.example.com
Action1: LAPTOP-01
Result:  Match
```

The integration does **not** use Entra device ID, serial number, MAC
address, owner, enrollment profile, or compliance state for matching.

## Duplicate and ambiguous matches

If multiple Action1 endpoints match the same normalized name, the match
is ambiguous and is skipped.

If multiple Entra devices resolve to the same Action1 endpoint,
endpoint-reuse protection also prevents that endpoint from being
updated.

Unmatched Entra devices are skipped. Unmatched Action1 endpoints remain
unchanged.

------------------------------------------------------------------------

# Entra group synchronization

For each Entra device, the integration reads its **direct** group
memberships. Nested or transitive memberships are not expanded.

Group display names are written as a comma-separated value:

``` text
Finance, Remote Workers, Autopilot Devices
```

If a group display name is unavailable, the group ID is used. The
integration preserves the order returned by Microsoft Graph and does not
explicitly sort the list.

## When a device has no groups

Empty values are not sent to Action1.

If an endpoint already contains an `Entra Groups` value and the Entra
device later has no direct groups, the existing Action1 value is **not
automatically cleared**.

------------------------------------------------------------------------

# Device ownership synchronization

The integration synchronizes the Microsoft Entra device
`deviceOwnership` property.

For example:

``` text
Entra Device Ownership = company
```

This is the Entra device ownership property. It is **not** the name or
email address of a registered owner or primary user. The integration
does not query registered owners or primary users.

If Entra returns no ownership value, the field is omitted from the
Action1 update and an existing Action1 value is not automatically
cleared.

------------------------------------------------------------------------

# Example

Microsoft Entra:

``` text
Device: WIN-LAPTOP-01

Direct groups:
Finance
Remote Workers
Autopilot Devices

Device ownership:
company
```

Action1 managed endpoint:

``` text
WIN-LAPTOP-01
```

With the default custom attribute names, synchronization writes:

``` text
Entra Groups:
Finance, Remote Workers, Autopilot Devices

Entra Device Ownership:
company
```

The update occurs only when a unique device-name match is established.

------------------------------------------------------------------------

# Update behavior

For a uniquely matched endpoint, the integration sends non-empty Entra
values to the configured Action1 custom attributes.

It does not first compare the new value with the current Action1 value,
so unchanged non-empty values may be written again on later runs.

If a source value becomes empty, that field is omitted rather than
cleared in Action1.

Endpoint-specific update failures are recorded while processing
continues where possible.

------------------------------------------------------------------------

# Scheduling

Scheduling is managed by Action1 Marketplace and is **disabled by
default**.

Available intervals:

-   Every 12 hours
-   Every 24 hours

Manual and scheduled runs use the same synchronization process. The Sync
page prevents a new manual run from being started while another tracked
synchronization is already running.

------------------------------------------------------------------------

# Sync status and History

The **Sync** page shows the current synchronization state, mapped
Organization count, scheduler status, latest completed run, and result
counters.

-   **Synced** --- Action1 endpoints successfully updated.
-   **Skipped** --- devices not updated, including unmatched, ambiguous,
    or endpoint-reuse cases.
-   **Failed** --- matched endpoints whose update failed.

The **History** page displays up to the latest **30 runs**, including
start time, result, synchronized count, skipped count, failed update
count, and available run details.

Manual and scheduled runs use the same Marketplace History mechanism.

------------------------------------------------------------------------

# Troubleshooting

## Test Connection fails with invalid credentials

Verify the **Entra Directory ID**, **Entra Application Client ID**, and
**Entra Client Secret**. Make sure the client secret **Value** was used
rather than the secret ID, and verify that it has not expired.

## Test Connection reports insufficient permissions

Verify that `Device.Read.All` and `GroupMember.Read.All` were added as
Microsoft Graph **Application permissions** and that administrator
consent was granted.

## Synchronization reports that no Organization is mapped

Open **Organization Mapping**, add at least one Action1 Organization,
and save.

## Devices are skipped

Check device names in Microsoft Entra and Action1. Matching uses Entra
`displayName` and the Action1 endpoint name. Case differences do not
matter and short-name/FQDN matching is supported. Duplicate or ambiguous
matches are intentionally skipped.

## Custom attribute updates fail

Verify that both configured custom attributes exist in every mapped
Action1 Organization and that their names match Settings. Also verify
that the Marketplace Action1 credentials can update endpoint attributes.

## Group information is missing

The integration synchronizes **direct** device group memberships only.
Nested memberships are not expanded. Also verify the Graph application
permissions and admin consent.

## An old group or ownership value remains in Action1

This can be expected. Empty Entra values are omitted from updates; the
integration does not currently clear previously synchronized values.

## One Organization fails but others continue

Mapped Organizations are processed independently. Review **History** for
details about the affected run.

------------------------------------------------------------------------

# Setup checklist

Before enabling scheduled synchronization, verify:

-   The Microsoft Entra application is registered.
-   The Directory (tenant) ID and Application (client) ID have been
    recorded.
-   A valid client secret has been created.
-   `Device.Read.All` is configured as a Microsoft Graph Application
    permission.
-   `GroupMember.Read.All` is configured as a Microsoft Graph
    Application permission.
-   Administrator consent has been granted.
-   Marketplace Action1 credentials can discover Organizations, read
    managed endpoints, and update endpoint attributes.
-   `Entra Groups` and `Entra Device Ownership`, or the configured
    alternatives, exist in every mapped Action1 Organization.
-   Entra connection settings are saved.
-   **Test Connection** succeeds.
-   Required Action1 Organizations are mapped.
-   A manual synchronization has completed.
-   Custom attribute values have been verified on at least one matched
    endpoint.
-   History has been reviewed for skipped or failed devices.
-   Scheduled synchronization is enabled if required.
