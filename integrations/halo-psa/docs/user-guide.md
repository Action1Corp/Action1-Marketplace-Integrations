# HaloPSA Integration for Action1 Marketplace

The HaloPSA integration connects Action1 with HaloPSA so that selected Action1 endpoint conditions can create and maintain HaloPSA tickets.

The integration can monitor vulnerabilities, missing updates, failed automations, offline endpoints, and reboot-required endpoints. Action1 organizations are mapped to HaloPSA clients, allowing tickets to be routed to the appropriate customer.

## Before You Start

The integration uses the Action1 API credentials configured for Action1 Marketplace. Action1 credentials and the Action1 regional API URL do **not** need to be entered again in the HaloPSA integration.

The Marketplace credentials must have access to the Action1 organizations that will be synchronized and sufficient read permissions for the data used by the integration.

Recommended Action1 permissions are:

| Permission | Purpose |
| --- | --- |
| View Endpoints | Read managed endpoints and endpoint details used by the integration. |
| View Automations and History | Read automation instances, history, and endpoint results. |
| View Vulnerabilities | Read vulnerabilities and affected endpoints. |
| View Dashboards | Provides access to dashboard-related data and may include additional read permissions required for endpoint, update, vulnerability, installed software, and SLA information. |

The integration makes read-only requests to Action1. It does not modify Action1 endpoints, vulnerabilities, updates, or automations.

## Configure HaloPSA API Access

### 1. Create a HaloPSA application

In HaloPSA, open:

`Configuration > Integrations > HaloPSA API`

Take note of the **Resource Server** and **Authorisation Server** values.

Under **Applications**, select **View Applications**, then create a new application.

A suggested application name is:

`Action1 HaloPSA Connector`

Configure the application as follows:

- **Active:** Enabled
- **Authorization Method:** Client ID and Secret (Services)
- **Login Type:** Agent

Copy the generated **Client ID** and **Client Secret**. Keep the Client Secret securely because it may not be displayed again.

### 2. Select the HaloPSA agent

For initial setup and validation, using a HaloPSA administrator account as the **Agent to log in as** is recommended. This helps verify connection, discovery, ticket creation, ticket updates, and lifecycle behavior without permission-related restrictions.

For production, a dedicated integration agent can be used instead.

If a dedicated agent is used, its Agent Role should include at least:

| Feature Access | Value |
| --- | --- |
| Tickets Access Level | Read and Modify |
| Customers Access Level | Read Only |

The following ticket permissions are recommended:

- Can add new Tickets
- Can edit closed Tickets
- Can view Unassigned Tickets
- Can view Tickets that are assigned to other Agents
- Can change a Ticket's Ticket Type
- Can Re-assign Tickets
- Can Edit Advanced Ticket Details
- Can Edit All Actions
- Can Assign To Agents In Teams The Agent Is Not A Member Of
- Can Edit Tickets Which Are Not Assigned To Them
- Can Override Maximum Priority Escalation At Ticket Type Level
- Can Override Ticket Review Processing
- Can Export Tickets

If setup works with an administrator account but fails with a dedicated integration agent, review the Agent Role permissions.

### 3. Configure application permissions

On the HaloPSA application's **Permissions** tab, either select **All** or enable the required permissions including:

- `read:tickets`
- `edit:tickets`
- `read:customers`
- `admin`

Save the HaloPSA application.

The integration reads HaloPSA teams, ticket types, statuses, categories, clients, ticket type details, and existing tickets. It also creates and updates tickets and changes ticket status as part of ticket lifecycle processing.

## Configure the Integration

Open **HaloPSA > Settings** in Action1 Marketplace.

### HaloPSA API Configuration

Enter:

- **HaloPSA Resource Server**
- **HaloPSA Authorisation Server**
- **Client ID**
- **Client Secret**

Use complete URLs, including `https://`.

Select **Save Settings**, then **Test Connection**. The connection test authenticates to HaloPSA and performs a read-only request; it does not create a ticket.

There is no separate Action1 API configuration in this integration. Action1 Marketplace supplies the Action1 credentials and the correct regional API endpoint automatically.

### Ticket Routing & Lifecycle

Configure how Action1-created tickets should appear in HaloPSA:

- **Team** — team that should own newly created tickets. If not selected, the HaloPSA default is used.
- **Ticket Type** — ticket type used for integration-created tickets.
- **New PSA Ticket Status** — initial status for new tickets. If not selected, the HaloPSA default is used.
- **Category** — ticket category. If not selected, the HaloPSA default is used.
- **Complete / Closed Statuses** — HaloPSA statuses that the integration should treat as completed or closed.
- **Existing Open Ticket Behavior** — update matching open tickets when their content changes, or leave existing open tickets unchanged.

Some HaloPSA ticket types can require additional mandatory fields. If HaloPSA rejects ticket creation, verify the selected Ticket Type and its required fields, as well as Team, Status, and Category.

## Configure Action1 Signals

The integration supports five Action1 signals.

### Vulnerabilities

Creates tickets for vulnerabilities that match the selected filters.

Available severity filters:

- Critical
- High
- Medium
- Low

Default: **Critical, High**

Available remediation-status filters:

- Overdue
- Due Soon

Default: **Overdue, Due Soon**

### Missing Updates

Creates tickets for missing updates that match the selected filters.

Available severity filters:

- Critical
- Important
- Moderate
- Low
- Unspecified

Default: **Critical, Important**

Available remediation-status filters:

- Overdue
- Due Soon

Default: **Overdue, Due Soon**

### Failed Automations

Creates tickets for qualifying failed Action1 automation runs.

This signal is enabled by default.

### Offline Endpoints

Creates a ticket when an endpoint has remained offline for at least the configured number of days.

Default: **Enabled, 7 days**

### Reboot Required

Creates tickets for endpoints that require a reboot.

Default: **Enabled**

An optional last-boot threshold can also be enabled. Its default threshold is **30 days**.

## Choose the Ticket Creation Mode

The integration supports two ticket creation modes.

### Create tickets per issue

This is the default mode.

Vulnerabilities, missing updates, and failed automations are grouped by issue, with affected endpoints included in the ticket. This reduces ticket volume when the same issue affects multiple endpoints.

Offline and reboot-required signals remain endpoint-based.

### Create tickets per endpoint

Creates separate tickets for affected endpoints instead of grouping supported signals by issue.

The integration can display up to **25 endpoints** in each grouped ticket by default. This value can be configured from 1 to 100.

The default maximum number of open integration-managed tickets per mapped Action1 organization is **30**. When the limit is reached, additional new ticket candidates can be skipped until capacity becomes available.

## Map Action1 Organizations to HaloPSA Clients

Open **Client Mapping**.

The integration discovers Action1 organizations and HaloPSA clients. For each customer that should be synchronized:

1. Select the Action1 organization.
2. Select the corresponding HaloPSA client.
3. Add the mapping.
4. Select **Save Mappings**.

Only mapped Action1 organizations are processed during synchronization.

The integration prevents duplicate organization and client mappings.

> **Important:** Configure and verify mappings before the first production sync. Ticket correlation uses the organization-to-client mapping. Changing an existing mapping after tickets have already been created can affect how those existing tickets are correlated with future sync results.

## Run the First Sync

Open **Sync** and select **Run now**.

During a sync, the integration:

1. Loads the current settings and client mappings.
2. Collects Action1 data for mapped organizations.
3. Applies the configured signal filters.
4. Determines which HaloPSA tickets should be created, updated, skipped, or closed.
5. Updates ticket correlation state.
6. Reports the run result to Marketplace History.

After the first run, verify the Created, Updated, Skipped, and Failed totals and review the resulting tickets in HaloPSA.

Action1 links included in HaloPSA tickets use the same Action1 region as the Marketplace connection, so links return to the appropriate regional Action1 Console.

## Scheduler

Automatic synchronization is disabled by default.

After a successful manual sync, the scheduler can be enabled from **Sync**.

Available intervals are:

- Every 3 hours
- Every 6 hours
- Every 12 hours
- Every 24 hours

For a new deployment, running and validating at least one manual sync before enabling the scheduler is recommended.

## History

The **History** page shows the latest tracked synchronization runs, including:

- Start time
- Result
- Created tickets
- Updated tickets
- Skipped tickets
- Failed tickets

Run states can include **Running**, **Completed**, **Interrupted**, and **Failed**.

Use History together with the Sync summary and HaloPSA tickets to validate integration behavior.

## Diagnostic Logging

Detailed diagnostic logging is disabled by default and should normally be enabled only while troubleshooting.

It can be enabled using **Enable detailed diagnostic runtime logs** in Settings.

When enabled, the integration writes:

`halo-psa-runtime.log`

The log directory is selected in this order:

1. An explicitly supplied log directory
2. `HALO_PSA_LOG_DIR`
3. `DATA_DIR/halo-psa-logs`
4. The integration-local `.runtime-logs` directory

In a normal Marketplace container deployment, diagnostic logs use `DATA_DIR/halo-psa-logs` when `DATA_DIR` is provided by the environment. `HALO_PSA_LOG_DIR` can be used to override that location.

For local development without either variable, logs fall back to:

`.runtime-logs/halo-psa-runtime.log`

Diagnostic logging can also be enabled through the `HALO_PSA_DIAGNOSTIC_LOGS` environment variable.

If diagnostic logging is disabled, no diagnostic log file is expected.

## Troubleshooting

### Test Connection fails

Verify:

- Resource Server and Authorisation Server URLs
- Client ID and Client Secret
- HaloPSA application permissions
- Agent permissions
- Network connectivity

### Action1 organizations are missing from Client Mapping

Verify that the Action1 credentials configured for Marketplace have access to the required organizations and the required Action1 read permissions.

Action1 credentials are managed by Marketplace and are not configured separately in HaloPSA Settings.

### HaloPSA tickets are not created

Verify:

- At least one organization-to-client mapping exists
- The required signal is enabled
- Severity and remediation filters include the expected issue
- Ticket Type is valid
- Required HaloPSA ticket fields are satisfied
- Team, Status, and Category are valid
- The maximum open ticket limit has not been reached
- The HaloPSA integration agent has sufficient permissions

Review **History** for the run result. If additional troubleshooting is required, temporarily enable detailed diagnostic runtime logging and run the sync again.

### Existing tickets are not updated

Verify **Existing Open Ticket Behavior** in Settings. The default behavior is to update matching open tickets when their generated content changes.

Tickets that HaloPSA reports in a configured Complete / Closed status are treated as closed for lifecycle purposes.

## Recommended First-Run Checklist

1. Confirm that Marketplace Action1 credentials have access to the required organizations and read APIs.
2. Create and configure the HaloPSA API application.
3. Configure the HaloPSA application permissions and Agent.
4. Enter the Resource Server, Authorisation Server, Client ID, and Client Secret in **Settings**.
5. Save the settings and run **Test Connection**.
6. Configure Ticket Type and Complete / Closed Statuses.
7. Configure Team, new-ticket Status, and Category as required.
8. Review the Action1 signal filters and ticket creation mode.
9. Map Action1 organizations to HaloPSA clients and save the mappings.
10. Run the first synchronization manually with **Run now**.
11. Review Sync totals, **History**, and the resulting HaloPSA tickets.
12. Enable the scheduler after the integration has been validated.
