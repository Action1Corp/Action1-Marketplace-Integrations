# Action1 Jira Cloud Integration — User Guide

## Overview

The Action1 Jira Cloud integration creates and maintains Jira work items from Action1 security and endpoint signals. It can create work items for vulnerabilities, missing updates, offline endpoints, endpoints requiring a reboot, and failed automations.

The integration maps each Action1 organization to a Jira space/project and work/issue type. Only mapped Action1 organizations are synchronized.

> **Jira terminology:** Atlassian is transitioning from **project** to **space** and from **issue** to **work item** in Jira Cloud. The Action1 integration currently uses the Jira REST API and UI terminology **Project Mapping**, **Jira Project**, **Issue Type**, and **issue**. This guide uses those integration labels so they match what appears in Action1.

## Before You Begin

The following are required:

- Access to the Action1 Marketplace with the Jira Cloud integration installed.
- A Jira Cloud site.
- A Jira account that can access the Jira projects where Action1 should create and update issues.
- An Atlassian API token for that account.
- Action1 permissions sufficient to read the organizations, endpoints, vulnerabilities, missing updates, and automation history that will be synchronized.

### Recommended Jira account

A dedicated Jira account is recommended for the integration. Grant the account access only to the Jira projects where Action1 should manage issues.

At minimum, the account needs sufficient Jira permissions to:

- view the mapped Jira projects and their issues;
- create issues in those projects;
- edit issues created or managed by the integration;
- access the issue types selected in Project Mapping.

For company-managed Jira projects, this normally includes the equivalent of **Browse Projects**, **Create Issues**, and **Edit Issues** permissions. Jira permission schemes, project roles, issue security, and team-managed project access can further restrict what the account can see or modify.

The integration does not delete Jira issues or perform Jira workflow transitions.

## Create an Atlassian API Token

The integration authenticates to Jira Cloud using an Atlassian account email address and API token.

1. Sign in to the Atlassian account that will be used by the integration.
2. Open the Atlassian account **API tokens** page under **Security**.
3. Select **Create API token**.
4. Give the token a descriptive name, such as `Action1 Jira Integration`.
5. Select an appropriate expiration date.
6. Create the token and copy it immediately. Atlassian does not display the token again after this step.

Use the regular API token for the current Action1 Jira integration. The integration connects directly to the configured Jira site URL and does not currently use the Atlassian API gateway required for scoped API tokens.

Store the token securely. If it expires or is revoked, create a replacement and update the integration settings.

## Action1 Access

Action1 credentials are managed by Marketplace and are not entered in the Jira integration.

The integration reads Action1 data for:

- organizations;
- endpoints;
- vulnerabilities and affected endpoints;
- missing updates and affected endpoints;
- automation history and endpoint results.

Recommended Action1 permissions:

| Permission                   | Purpose                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View Endpoints               | View endpoints and their details, including missing updates, vulnerabilities, installed software, and automation history in the specified scope.                                                                      |
| View Automations and History | View automations and their history, including automation instances, in the specified scope.                                                                                                                           |
| View Vulnerabilities         | View vulnerabilities and CVE descriptions in the specified scope.                                                                                                                                                     |
| View Dashboards              | View dashboards in the specified scope. This may implicitly include permissions such as View Endpoints, View Updates, View Vulnerabilities, View Installed Software, and View Advanced Settings for the SLA category. |

The integration does not modify Action1 endpoint, vulnerability, update, or automation data.

The Action1 regional API endpoint is also supplied automatically by Marketplace. There is no Action1 API URL setting in the Jira integration. Links written to Jira automatically point back to the correct regional Action1 Console.

## 1. Configure the Jira Connection

Open the Jira integration and go to **Settings**.

Under **Jira Cloud Configuration**, enter:

| Setting | Description |
| --- | --- |
| **Jira Site URL** | The Jira Cloud site, for example `https://company.atlassian.net` |
| **Atlassian Account Email** | Email address of the Jira account used by the integration |
| **Atlassian API Token** | API token created for that Atlassian account |

Save the settings, then use **Test Connection**.

Test Connection authenticates to Jira and verifies the account using the Jira REST API. It does not create or modify any Jira issues.

If the test fails, verify the site URL, account email, API token, and that the account can access the Jira site.

## 2. Configure Project Mapping

Open **Project Mapping** after the Jira connection is configured.

Each mapping connects:

**Action1 Organization → Jira Project → Jira Issue Type**

For each Action1 organization that should create Jira issues:

1. Add a mapping.
2. Select the **Action1 Organization**.
3. Select the destination **Jira Project**.
4. Select the **Jira Issue Type** to create in that project.
5. Save the mappings.

If the Jira Project is changed, select the Issue Type again because available issue types are discovered for the selected project.

Use Refresh when the expected Action1 organization, Jira project, or issue type does not appear.

### Mapping rules

- Each Action1 organization can have one mapping.
- Multiple Action1 organizations can map to the same Jira project.
- An Action1 organization without a mapping is ignored during synchronization.
- Removing a mapping stops future synchronization for that organization; it does not delete Jira issues that were already created.

The Jira account used by the integration must have access to every project selected in Project Mapping.

## 3. Choose Action1 Signals

In **Settings**, choose which Action1 conditions should generate Jira issues.

### Vulnerabilities

By default, the integration includes **Critical** and **High** vulnerabilities.

Available severities are:

- Critical
- High
- Medium
- Low

The default remediation statuses are:

- Overdue
- Due Soon

Selecting remediation statuses restricts matching to those statuses. If all remediation statuses are cleared, the remediation-status restriction is removed.

If all vulnerability severities are cleared, vulnerability issue creation is disabled.

### Missing Updates

By default, the integration includes **Critical** and **Important** updates.

Available severities are:

- Critical
- Important
- Moderate
- Low
- Unspecified

The default remediation statuses are:

- Overdue
- Due Soon

If all remediation statuses are cleared, the remediation-status restriction is removed. If all update severities are cleared, missing-update issue creation is disabled.

### Offline Endpoints

Offline endpoint issues are enabled by default. The default threshold is **7 days**.

An endpoint qualifies when it has been offline for at least the configured number of days.

### Reboot Required

Reboot-required endpoint issues are enabled by default. The integration creates endpoint-level issues when Action1 reports that a reboot is required.

### Automation Failures

Automation failure issues are enabled by default. The integration processes recent failed automation activity and avoids repeatedly processing the same failures.

## 4. Choose the Ticket Model

Vulnerabilities, missing updates, and automation failures can use either **Grouped** or **Endpoint** mode. The default is Grouped.

### Grouped

A single Jira issue represents the same problem across multiple affected endpoints. For example, one CVE affecting 20 endpoints can be represented by one Jira issue rather than 20 separate issues.

Grouped issues are organized by Action1 organization and the relevant problem:

- vulnerability: vulnerability/CVE;
- missing update: package/version;
- automation failure: automation instance.

The default maximum number of impacted endpoints displayed in a grouped issue is **25**. This can be configured from 1 to 100. When more endpoints are affected, the issue provides a link to Action1 for the complete information.

### Endpoint

Endpoint mode creates separate Jira issues for individual affected endpoints.

Offline and reboot-required signals are always endpoint-level.

## 5. Configure Issue Handling

### Existing Open Issue Behavior

The default behavior is to **update an existing open issue** when its generated Action1 content changes.

The alternative is to skip updates to existing open issues.

If nothing relevant has changed, the integration skips the issue rather than rewriting identical content.

### Maximum Open Tickets per Organization

The default maximum is **30** connector-managed open Jira issues per Action1 organization.

When the limit is reached, additional qualifying candidates are skipped until capacity becomes available.

### Resolved or Completed Jira Issues

The integration reads the current Jira status of linked issues. A completed/resolved issue is not reopened. If the Action1 condition later qualifies again, the integration can create a new Jira issue.

The current integration does **not** automatically close or transition Jira issues when an Action1 signal clears.

## 6. Save and Run the First Sync

After the Jira connection, Project Mapping, and signal settings are configured:

1. Save **Settings**.
2. Open **Sync**.
3. Select **Run Now**.
4. Wait for the run to complete.
5. Review the result in **History** and check the destination Jira projects.

During synchronization, the integration:

1. validates Jira settings and mappings;
2. collects Action1 data for mapped organizations;
3. applies the configured signal filters;
4. groups candidates according to the selected ticket model;
5. creates new Jira issues or updates existing linked issues as required;
6. records the run result in Marketplace History.

A failure while processing one Action1 organization does not necessarily prevent other mapped organizations from being processed.

## What Appears in Jira

Created issues contain signal-specific Action1 information. Depending on the signal, this can include:

- endpoint name and platform information;
- Action1 organization;
- vulnerability/CVE, severity, CVSS, and remediation information;
- update package, version, severity, related CVEs, and deadline information;
- automation failure information;
- affected endpoints;
- links back to the relevant Action1 Console pages.

Action1 Console links automatically use the regional Action1 environment configured by Marketplace.

## Scheduling

Manual synchronization is available through **Run Now**.

Marketplace can also run Jira synchronization automatically. Available schedule options are:

- Disabled
- Every 3 hours
- Every 6 hours
- Every 12 hours
- Every 24 hours

Scheduling is disabled by default.

The scheduler uses the configured timezone. Manual and scheduled synchronization use the same integration logic and appear in the same run history.

## History

Open **History** to review recent synchronization runs.

The view shows up to 30 recent runs with information such as:

- start time;
- run status;
- issues created;
- issues updated;
- candidates skipped;
- failures.

Possible states include Running, Completed, Interrupted, Failed, and Not Started.

History is useful for confirming that a scheduled or manual sync ran and for identifying runs that require investigation.

## Diagnostic Logging

**Enable detailed diagnostic runtime logs** is disabled by default.

Enable it when additional information is required for troubleshooting. Normal Marketplace run status and History remain available without detailed diagnostic logging.

Diagnostic output is sanitized and should not contain API tokens or authorization headers. The physical log location depends on how Marketplace is deployed and should not be assumed to be a fixed customer-facing path.

## Troubleshooting

### Test Connection fails

Verify:

- Jira Site URL is correct;
- the Atlassian account email matches the account that owns the API token;
- the API token is current and has not expired or been revoked;
- the account can access the Jira site.

### A Jira project does not appear in Project Mapping

Verify that the integration account has access to that project. Project visibility in Jira is permission-dependent. Refresh Project Mapping after correcting access.

### An issue type does not appear

Issue types are discovered for the selected Jira project. Confirm that the correct project is selected and that the integration account has sufficient access to it.

### An Action1 organization does not create Jira issues

Confirm that the organization has a saved Project Mapping. Unmapped organizations are intentionally ignored.

Also verify that at least one applicable signal is enabled and that the findings satisfy the selected severity, remediation-status, or threshold filters.

### Vulnerability or update issues stop being created

Check the Severity selections. Clearing every Vulnerability Severity disables vulnerability matching; clearing every Missing Update Severity disables missing-update matching.

Clearing all Remediation Status selections has a different meaning: it removes that filter and allows findings regardless of remediation status.

### Jira issues are not automatically closed

This is expected in the current version. The integration creates and updates Jira issues but does not currently transition them when the corresponding Action1 signal clears.

### Some candidates are skipped

Check **Maximum Open Tickets per Organization** and the configured Existing Open Issue Behavior. History can also indicate whether candidates were skipped or failed.

## First-Run Checklist

- Jira integration account prepared
- API token created and stored securely
- Jira Site URL, account email, and API token saved
- Test Connection successful
- Jira account has access to the destination projects
- Action1 organizations mapped to Jira projects and issue types
- Required Action1 signals selected
- Ticket models reviewed
- Maximum open-ticket limit reviewed
- First manual sync completed
- Jira issues reviewed
- History reviewed
- Schedule enabled if required
