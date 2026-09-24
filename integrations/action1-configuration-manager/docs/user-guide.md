# Action1 Configuration Manager — User Guide

Action1 Configuration Manager helps you define, apply, and monitor Windows configuration policies across your endpoints. Instead of configuring devices one at a time, you can combine settings into a policy, assign it to an organization or endpoint group, and use Action1 reports to see the results.

You can **assess** settings without changing them, or choose to **assess and remediate** settings where the selected Controls support remediation. A policy can contain individual Controls or start from a predefined security baseline.

This guide follows the current Configuration Manager screens: **Dashboard**, **Policies**, **History**, and **Settings**.

### Find your way around

```text
Configuration Management
|
+-- Dashboard   Review coverage and compliance
+-- Policies    Create, edit, enable, disable, or delete Policies
+-- History     Review Policy management and setup operations
+-- Settings    Configure reconciliation, reporting, and logging
```

Action1 reports open in the **Action1 Console**, not in a separate Configuration Manager Reports screen.

> **Important:** A policy defines the configuration you want and provisions Action1 scheduled automations. Creating or enabling a policy does not mean that every endpoint has already run it or is compliant. Use reporting to review observed results.

## 1. Get started

Open **Configuration Management** in your Action1 Marketplace. Configuration Manager uses the Action1 connection already provided by Marketplace; there is no separate credential-entry screen in this integration.

A straightforward first-time workflow is:

```text
Set up reporting
       |
       v
Create a Policy --> Choose target, mode, and Controls
       |
       v
Save and apply --> Action1 scheduled automations are provisioned
       |
       v
Endpoints execute --> Results become available in reports
       |
       v
Review Dashboard --> Open Action1 reports for details
```

The arrows show the normal sequence, not an immediate or guaranteed endpoint execution after saving.

1. Open **Settings → Reporting** and select **Set up reporting** if reporting has not yet been configured. Wait until **Data source** and **Reports** show **Configured**.
2. Open **Policies** and select **Create Policy**.
3. Choose an organization and target, decide whether to assess only or also remediate, and select at least one Control.
4. Review the policy and select **Save and apply**. Confirm the action when prompted.
5. After endpoints run the scheduled automations and report data is available, use **Dashboard** to review coverage and compliance. Open Action1 reports for detailed results.

You need appropriate Marketplace access to manage policies, and the selected organization and endpoint group must be available through Action1. Exact roles, licensing, and supported Windows versions depend on your deployment; this guide does not specify permissions or platform support beyond those exposed in the product.

## 2. Understand policies, Controls, and baselines

A **Policy** combines a set of Windows configuration Controls with a target, an operating mode, and a schedule. Its target is one Action1 organization with either **All endpoints** or **one endpoint group**. A Policy cannot target a custom list of individual endpoints or multiple groups.

A **Control** represents a setting to check, and, when supported, remediate. Controls are organized as **Category → Control Family → Control**. One scheduled Action1 automation is created for each selected, non-empty Control Family; that automation runs the family’s selected Controls according to the Policy schedule.

A **Baseline** provides a starting collection of Controls and recommended values. Applying a baseline fills your current draft; it is not an ongoing subscription that automatically adds future Controls to an existing Policy. You can adjust its values and add other Controls before saving.

The Controls step identifies the version of the currently loaded **Control Pack**. Available Controls and baselines come from that installed release. See the [Control Pack Reference](control-pack/README.md) for the separate catalog and release notes when those documents are available.

## 3. Create your first Policy

Go to **Policies → Create Policy**. The wizard has four steps.

```text
1. Details & Target --> 2. Mode --> 3. Controls --> 4. Review
      name             assess       individual      inspect
      organization     or remediate Controls        confirm
      target           schedule     or baseline     Save and apply
```

You can go **Back** to revise earlier steps without creating a Policy. Nothing is saved until the final confirmation.

### Step 1 — Details & Target

Enter a **Policy name** and, if useful, a **Description**. The wizard also shows the generated **Policy display name**.

Choose the **Organization** that owns the target devices. Under **Apply Policy to**, select either **All endpoints** or **Endpoint group**; select the group if applicable. Then select **Next**.

A target can be reserved by only one Policy according to these rules:

- An **All endpoints** Policy reserves the entire organization. You cannot create another Policy for that organization while it holds this reservation.
- A group-scoped Policy reserves its group. While any group is reserved, **All endpoints** is unavailable for that organization.
- Reserved groups remain in the list but are disabled and identified as **Used by another Policy**.

Disabled Policies retain their reservations. Different groups may still contain some of the same physical devices; reservations apply to group identity rather than checking every group member.

**Choose the target carefully:** you cannot change a Policy’s organization or target after creation. To use a different target, create a new Policy.

### Step 2 — Mode

Choose one of the two modes:

- **Assess only** checks the selected settings and writes reporting results without changing the endpoint configuration.
- **Assess and remediate** checks settings, attempts supported remediation when needed, and verifies again during that execution. Remediation is not guaranteed to succeed; a result may remain non-compliant or be blocked.

Choosing **Assess and remediate** opens **Confirm remediation**. Review the choice and select **Confirm** to proceed, or **Cancel** to go back.

Expand **Advanced settings** on this step if you need to adjust the schedule:

| Setting | What it does |
| --- | --- |
| **Run every** | Scheduled recurrence in whole hours; minimum 1, default 24. |
| **Start date** and **Start time** | Required starting date and time, initially based on your browser’s current date and time. |
| **Current Timezone** | Read-only timezone/UTC-offset information used for the schedule. |
| **Automation completion deadline** | The number of hours that offline endpoints can keep retrying. It initially follows **Run every** and resets when that interval changes. |

Configuration Manager uses hourly recurrence and converts the start time to UTC for Action1. The wizard does not offer endpoint-local-time scheduling.

Select **Next** when ready.

### Step 3 — Controls

Browse by **Category** and **Control Family**, or use **Search controls** to find a setting. Select the Controls you want, then configure any parameters displayed for them. You must select at least one Control.

Within a family, **Select all** selects its Controls and **Clear** clears that family. **Selected only** shows just your selections; **Clear all** removes all selected Controls.

#### Start from a baseline

Under **Start from a baseline**, choose a baseline and select **Apply**. Selecting its name alone does not apply it.

Applying a baseline adds its Controls and sets their recommended parameter values. If you had already selected one of those Controls and changed its values, **Apply** replaces those values with the baseline’s recommended values. Controls outside the baseline remain selected and unchanged. The editor also turns on **Selected only** to help you review the resulting selection.

The **In baseline only** option filters the catalog view; it does not select or remove Controls. Likewise, choosing **None — select controls manually** does not undo a baseline you already applied. Use **Clear all** or edit individual selections if you want to start over.

Review your selected Controls and parameter values, then select **Next**.

### Step 4 — Review

Check the **Summary** and grouped Control list. The summary shows **Policy**, **Organization**, **Target**, **Mode**, **Run schedule**, **Baseline**, **Controls**, **Control Families**, and **Action1 automations**. It is a summary, not a display of every advanced scheduling field.

Use the inline **Edit** links to return to a section if you need to change something. When ready, select **Save and apply** and confirm in the **Save and apply Policy** dialog.

Configuration Manager saves the Policy and provisions its scheduled Action1 automations. Once provisioning succeeds, the Policy is enabled. The wizard returns you to the Policies list. Endpoints produce assessment and remediation results when their automations execute; policy creation alone is not proof of endpoint execution.

## 4. Manage existing Policies

The **Policies** list displays each Policy’s **Status**, **Target**, **Mode**, and **Schedule**, with an **Actions** menu. Status is **Enabled** or **Disabled**.

Select the Policy name, or choose **Open details**, to open **Policy Details**. The details view includes **Overview**, **Run schedule**, and **Controls and Action1 automations**. Use **Open automation in Action1** to open the corresponding automation search in the Action1 Console.

### Edit a Policy

Choose **Edit** from the Policies list or Policy Details. The existing wizard opens with the saved values and **Selected only** enabled. You can change the name, description, mode, schedule, Controls, and their parameters. **Organization and Target cannot be changed.** Review the changes, select **Save and apply**, and confirm. On success, the editor returns to Policy Details.

Editing an enabled Policy updates, creates, or removes its scheduled automations as needed. Editing a disabled Policy does not provision its regular scheduled automations. Removing a Control from either type of Policy submits cleanup for that Control’s saved Configuration Manager state files.

### Policy lifecycle at a glance

```text
Create + provision
       |
       v
    Enabled <------------------- Enable
       |                           ^
       | Disable                   |
       v                           |
    Disabled ----------------------+
       |
       | Delete (also available while Enabled)
       v
    Deleted
```

**Disabled** keeps the Policy, target reservation, and existing endpoint-state files; **Delete** releases the reservation after the required cleanup request is accepted. Neither operation reverses configuration changes already applied to Windows. The diagram summarizes the normal successful paths, not recovery from partial failures.

### Disable or enable a Policy

Choose **Disable**, review **Disable Policy?**, and confirm **Disable Policy**. Disabling removes the Policy’s owned scheduled automations but keeps the Policy, its endpoint-state files, and its target reservation.

To resume it, choose **Enable**, review **Enable Policy?**, and confirm **Enable Policy**. Configuration Manager provisions scheduled automations from the saved Policy definition and then enables it.

### Delete a Policy

Choose **Delete** from the Actions menu, review **Delete Policy?**, and confirm **Delete Policy**. Configuration Manager removes owned scheduled automations, submits a cleanup job for the Policy’s endpoint-state directory, and, once cleanup submission is accepted, deletes local Policy records and releases its target reservation.

**Deletion does not undo Windows settings previously applied on endpoints.** A successful delete means the cleanup job was accepted, not that it has already finished on every device. Offline endpoints may complete cleanup later within the configured seven-day retry window.

If deletion reports an error, review **History** and the relevant Action1 operations before trying again. A partially completed operation may already have removed some scheduled automations while retaining the Policy and its reservation.

## 5. Understand the Dashboard

Open **Dashboard** for an overview of enabled Policies. It reports results for Windows endpoints currently assigned to their targets. Offline endpoints still count as assigned if they remain in Action1’s inventory.


The four headline metrics are:

```text
Assigned Policy/endpoint pairs
              |
      Observed results?
       /           \
     None          Some
      |             |
   No Data    Enough results for every selected Control?
                     /                      \
                    No                      Yes
                    |                        |
                 Partial             Any non-compliant result?
                                           /         \
                                          No         Yes
                                          |           |
                                      Compliant   Need Attention
```

This is a simplified view of the count-based classification. Contradictory or excess counts can be classified internally as inconsistent data rather than appearing in the visible categories.

| Metric | Meaning |
| --- | --- |
| **Active Policies** | Number of enabled Policies; supporting text shows their assigned Windows endpoints. |
| **Need Attention** | Fully evaluated Policy/endpoint assignments with one or more reported non-compliant Controls. |
| **Overall Compliance** | Compliant assignments divided by fully evaluated assignments. |
| **Evaluation Coverage** | Fully evaluated assignments divided by all assigned assignments. |

**Compliance and Coverage answer different questions.** Compliance describes results among assignments considered fully evaluated. Coverage indicates how much of the assigned population has a complete reported result. For example, 100% Compliance can coexist with lower Coverage if some endpoints have not produced enough reported results.

The **Policies** table includes **Assigned**, **Evaluated**, **Compliant**, **Need attention**, **Partial / No data**, **Coverage**, and **Compliance**. A dash (**—**) is displayed when a percentage has no valid denominator.

The main result categories are:

| Category | Meaning |
| --- | --- |
| **No Data** | No matching reported result, or an observed Control count of zero. |
| **Partial** | Some results are available, but fewer than the number of selected Controls. |
| **Compliant** | The observed count matches the selected-Control count and no reported Control is non-compliant. |
| **Need Attention** | The observed count matches the selected-Control count and at least one reported Control is non-compliant. |

Dashboard completeness is based on reported result counts. It does not independently verify every Control ID, parameter value, result age, or version. An inconsistent count may also be excluded from the visible result categories, so totals will not always reconcile perfectly. Results correlate by organization, Policy ID, and endpoint name; endpoint renames or duplicate names can affect matching until reporting and inventory agree.

**Top controls needing attention** highlights up to five Policy/Control combinations affecting the most endpoints according to a separate non-compliance report. These counts can differ from the Dashboard’s fully evaluated **Need Attention** metric. Select a report link to investigate in the Action1 Console; links open organization-scoped reports and are not automatically filtered to the clicked Control or Policy.

### Refresh Dashboard data

Opening Dashboard reads available report snapshots. Select **Refresh** to request requery of the three Dashboard reports and briefly poll for updated results. Refreshing reports **does not execute Policy assessments or remediation**, and it does not guarantee every endpoint has produced a fresh result. If Refresh fails, the previous Dashboard may remain visible with an error.

## 6. Set up and use Action1 reports

Go to **Settings → Reporting** and select **Set up reporting** if setup is available. Setup creates the **Configuration Management - Control Status** data source and eight Action1 reports, each with the **Configuration Management -** prefix:

```text
Settings > Reporting > Set up reporting
                    |
                    v
       Data source + eight reports
                    |
                    v
           Wait for Configured
                    |
                    v
       View results in Action1 Console
                    |
                    v
       Dashboard Refresh (report requery)
```

Dashboard **Refresh** requests updated reporting data; it does not trigger a Policy run or remediation.

| Report | Typical use |
| --- | --- |
| **Details** | Inspect individual endpoint/Control results. |
| **by Endpoint** | Review results by device. |
| **by Control** | See results grouped by Control. |
| **by Policy** | Review results grouped by Policy. |
| **by Status** | Find results by reported status. |
| **Dashboard Endpoints** | Supply the Dashboard’s assignment/result counts. |
| **Dashboard Non-Compliant Endpoints** | Supply endpoint-level non-compliance counts. |
| **Dashboard Non-Compliant Controls** | Supply Control-level non-compliance counts and top Controls. |

Wait until **Data source** and **Reports** both show **Configured**. Setup takes effect immediately; it does not require **Save settings**. If existing saved resources are available, setup reuses them rather than recreating everything. It is not a general-purpose repair or upgrade of existing report definitions.

Open reports using Dashboard links or the Action1 Console. Report data includes configuration status, **Last Checked At**, **Remediation Attempted**, **Last Remediated At**, and **Message**. Report timestamps are formatted in UTC.

The Dashboard shows available reporting snapshots and requests a bounded requery only when you select **Refresh**. A report can retain older results for an offline endpoint; Configuration Manager does not apply an automatic age cutoff to Dashboard results.

## 7. Use History

Open **History** to review Configuration Manager management operations, such as **Policy created**, **Policy updated**, **Policy enabled**, **Policy disabled**, **Policy deleted**, **Reconciliation**, and **Reporting setup**.

Use **Refresh** to reload the list, and **Rows** to choose 50, 100, or 200 entries. Select **Details** on a row to inspect its **History details**, **Counts**, **Control Family changes**, and **Issues**, where present. Operation results are **Success**, **Failed**, or **Running**. Times display in your browser’s local time.

**History is not endpoint execution history.** To investigate when scheduled automations ran or what individual endpoints reported, use the relevant Action1 automation and reports. Refreshing History does not refresh Dashboard reports.

## 8. Configure Settings

### Policy reconciliation

Under **Settings → Policy reconciliation**, choose a **Reconciliation interval**: **Every 3 hours**, **Every 6 hours**, **Every 12 hours**, or **Every 24 hours** (default: every six hours). Select **Save settings** to save your choice.

Reconciliation checks enabled Policies and recreates missing expected scheduled automations. It leaves existing scheduled automations unchanged. It does **not** evaluate endpoint compliance, trigger endpoint assessments, repair arbitrary edits to existing automations, or clean up disabled Policies.

```text
Enabled Policies --> Check expected scheduled automations
                               |
                        Missing automation?
                          /          \
                        Yes           No
                         |             |
                      Recreate      Leave as is
```

Reconciliation maintains missing scheduled automations; it is not a compliance assessment or an endpoint execution.

Select **Reconcile now** to run reconciliation immediately. It does not save pending changes to Settings.

### Reporting

Select **Set up reporting** when the reporting resources have not yet been configured. This action starts immediately; it does not depend on **Save settings**.

### Advanced settings

Expand **Advanced settings** to find **Enable debug logging**. Debug logging is disabled by default. When enabled and saved, it includes detailed diagnostics in Configuration Manager runtime logs; normal operation logs remain available when it is disabled.

Select **Save settings** after changing the checkbox. The integration does not provide a built-in log viewer or download action. If troubleshooting requires logs, follow your deployment’s support procedure to retrieve the Configuration Manager runtime log.

## 9. Troubleshooting

### A Policy was created, but no results appear

Confirm that the Policy is **Enabled**, its organization and target are correct, and its scheduled Action1 automations exist. Allow time for those automations to run and for report data to become available. Check **Settings → Reporting** for configured resources, then use Dashboard **Refresh** to request updated reporting data. Refreshing Dashboard does not itself run a Policy.

### An endpoint appears as No Data or Partial

**No Data** means no matching results are currently available for that Policy/endpoint assignment. **Partial** means only some of the expected Control results have been observed. Check the relevant Action1 report and automation status. Offline devices can remain assigned without producing new results. If an endpoint was renamed, inventory and report data may temporarily show different names and therefore fail to correlate.

### Compliance looks high, but Coverage is low

Compliance excludes assignments without a full observed result count. Review **Evaluation Coverage** and the **Partial / No data** column before interpreting the compliance percentage.

### I cannot select an organization or endpoint group

Another Policy may already reserve the **All endpoints** target or the group you want. Unavailable groups remain visible with **Used by another Policy**. Disabled Policies keep their reservations; successful deletion releases them. Organization and target cannot be changed on an existing Policy.

### A remediation result remains non-compliant

**Assess and remediate** attempts remediation only where the selected Control supports it. Remediation can fail or be blocked. Use the detailed report’s status and **Message** and investigate the corresponding Action1 automation before adjusting the Policy.

### A Policy action failed partway through

Open **History** and inspect the failed operation. Some lifecycle steps may already have succeeded; for example, a failed delete can retain the Policy and target reservation even if scheduled automations were removed. Avoid blindly repeating an ambiguous destructive operation. Escalate using your organization’s support procedure if its state is unclear.

### I replaced the Control Pack and an existing Policy cannot be saved or enabled

The installed Control Pack determines the currently available Controls and their parameter contracts. Existing Policies keep their saved selections and versions; replacing the installed release does not automatically migrate them. A Control or Control Family that is missing or incompatible in the new release can block later Policy changes or automation provisioning. Review the new release’s Control Pack reference and your organization’s approved upgrade procedure before modifying the affected Policy.

## 10. Control Pack documentation

This guide explains how to use Controls and baselines in Configuration Manager. Individual Control behavior, technical prerequisites, baseline contents, and Control Pack release changes belong in the separate [Control Pack Reference](control-pack/README.md). That reference is reserved for a later documentation update and should not be treated as a complete Control catalog yet.
