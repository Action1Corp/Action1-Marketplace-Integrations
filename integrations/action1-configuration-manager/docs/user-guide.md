# Action1 Configuration Manager — User Guide
Action1 Configuration Manager enables centralized management of the desired configuration of Windows endpoints.

Individual configuration requirements are represented as Controls, which are combined into Policies and assigned to an organization or endpoint group.

Configuration Manager supports two operating modes: Assess only, which evaluates the current endpoint configuration, and Assess and remediate, which evaluates and enforces supported settings when the current configuration does not match the desired state.

This guide covers Policy creation and lifecycle management, configuration status monitoring, reporting, and troubleshooting.

**---**

## Get started
Configuration Manager uses Policies to define which Windows settings should be assessed or enforced across selected endpoints.

Before creating the first Policy, reporting must be set up once for the Action1 organization.

### First-time setup
1. Open ****Settings → Reporting**** and select ****Set up reporting****.

2. Wait until both ****Data source**** and ****Reports**** show ****Configured****.

3. Open ****Policies**** and create the first Policy.

4. After the Policy runs and results become available, open ****Dashboard**** to review configuration status and compliance.

Configuration Manager automatically creates the Action1 Custom Reports required for the Dashboard and detailed reporting. These reports are also available directly under ****Custom Reports**** in the ****Action1 Console****.

Configuration Manager has four main areas:

| Area | Use it to |
| --- | --- |
| ****Dashboard**** | Review coverage, compliance, and items that need attention |
| ****Policies**** | Create and manage configuration Policies |
| ****History**** | Review Policy management and setup operations |
| ****Settings**** | Configure reconciliation, reporting, and debug logging |

**---**

## Create a Policy
Go to ****Policies → Create Policy****.

The wizard has four steps:

1. ****Details & Target**** — Name the Policy and choose where it applies.

2. ****Mode**** — Choose whether to assess only or assess and remediate, and configure the schedule.

3. ****Controls**** — Select individual Controls or start from a baseline.

4. ****Review**** — Check the final configuration and select ****Save and apply****.

The wizard can return to an earlier step at any time. Nothing is created until ****Save and apply**** is confirmed.

### 1. Details & Target
Enter a ****Policy name**** and, if useful, a ****Description****.

Then choose the ****Organization**** and where the Policy should apply:

- ****All endpoints****

- ****Endpoint group****

A Policy can target one organization and either all endpoints in that organization or one endpoint group.

A target can be used by only one Policy at a time:

- An ****All endpoints**** Policy reserves the whole organization.

- A group Policy reserves that endpoint group.

- Reserved groups remain visible but are marked ****Used by another Policy****.

- Disabled Policies keep their reservations.

> ****Choose the target carefully:**** the Organization and Target cannot be changed after the Policy is created. A new Policy is required to apply the configuration to a different target.

### 2. Mode

Choose how the Policy should behave.

| Mode | Behavior |
| --- | --- |
| **Assess only** | Checks the selected settings and reports their current state without changing the endpoint |
| **Assess and remediate** | Checks the selected settings and attempts to apply the desired configuration when remediation is supported |

### Schedule
Expand ****Advanced settings**** on the Mode step to change the default schedule.

| Setting | What it controls |
| --- | --- |
| ****Run every**** | How often the Policy runs, in whole hours |
| ****Start date / Start time**** | When the schedule begins |
| ****Current Timezone**** | The timezone used when the schedule is created |
| ****Automation completion deadline**** | How long offline endpoints can keep retrying |

The default recurrence is every 24 hours. The minimum recurrence is 1 hour.

### 3. Controls
Controls are organized by ****Category → Control Family → Control****.

Browse the catalog or use ****Search controls****, then select the Controls to include. Some Controls also include parameters that can be configured before saving.

At least one Control is required.

The Controls step also provides the following options:

- ****Select all**** — select every Control in the current family

- ****Clear**** — clear the current family

- ****Selected only**** — show only the current selections

- ****Clear all**** — remove all selected Controls

### Start from a baseline
A baseline provides a predefined set of Controls and recommended values.

Choose a baseline under ****Start from a baseline****, then select ****Apply****.

Applying a baseline:

- adds the baseline Controls to the Policy;

- applies the baseline's recommended values;

- keeps Controls selected outside the baseline;

- replaces custom values for Controls that are part of the baseline.

The ****In baseline only**** option filters the catalog without changing the current selections.

### 4. Review
The Review step summarizes the Policy before it is created.

Check the:

- Policy name

- Organization

- Target

- Mode

- Schedule

- Baseline

- Selected Controls

- Control Families

- Number of Action1 automations

Use the inline ****Edit**** links to make changes before the Policy is created.

When everything looks correct, select ****Save and apply****, then confirm.

Configuration Manager creates the Policy and provisions the required scheduled Action1 automations. The Policy becomes enabled after provisioning succeeds.

```text
Create Policy
     │
     ▼
Save and apply
     │
     ▼
Provision scheduled automations
     │
     ▼
Policy enabled
     │
     ▼
Scheduled assessment / remediation
     │
     ▼
Reporting → Dashboard
```

**---**

## Understand Policies, Controls, and automations

A **Policy** defines the Windows configuration that Configuration Manager should assess or enforce for a specific set of endpoints.

```text
Policy
├── Target       → Where the Policy applies
├── Mode         → Assess only or Assess and remediate
├── Schedule     → When and how often the Policy runs
└── Controls     → Which Windows settings are managed
```

| Policy element | What it defines |
| --- | --- |
| **Target** | The Action1 organization or endpoint group where the Policy applies |
| **Mode** | Whether Configuration Manager only assesses settings or also attempts to remediate supported settings |
| **Schedule** | How often the Policy runs and when scheduled execution begins |
| **Controls** | The Windows settings that the Policy assesses and, when supported, remediates |

### Controls and automations

A **Control** represents an individual Windows setting that Configuration Manager can assess and, when supported, remediate.

Controls are grouped into **Control Families**. Configuration Manager creates one scheduled Action1 automation for each selected Control Family that contains selected Controls.

```text
Policy
│
├── Control Family A → Scheduled Action1 automation
│   ├── Control
│   └── Control
│
└── Control Family B → Scheduled Action1 automation
    ├── Control
    └── Control
```

For example, a Policy containing Controls from four Control Families creates four scheduled automations.

These automations normally do not require direct management. They can be opened in the Action1 Console from Policy Details.

---

## Manage Policies
Open ****Policies**** to view existing Policies.

The list shows each Policy's:

- Status

- Target

- Mode

- Schedule

A Policy is either ****Enabled**** or ****Disabled****.

Select the Policy name, or choose ****Open details****, to open ****Policy Details****.

### Edit a Policy
Choose ****Edit**** from the Policies list or Policy Details.

The following settings can be changed:

- Policy name and description;

- Mode;

- Schedule;

- Controls;

- Control parameters.

The ****Organization**** and ****Target**** cannot be changed after the Policy is created.

For an enabled Policy, saving changes updates its scheduled automations as needed.

For a disabled Policy, saving changes updates the Policy definition without recreating its normal scheduled automations.

### Disable a Policy
Choose ****Disable****, review the confirmation, then select ****Disable Policy****.

Disabling a Policy:

- removes its scheduled automations;

- keeps the Policy;

- keeps its target reservation;

- keeps its saved Configuration Manager endpoint state.

Select ****Enable**** to resume the Policy. Configuration Manager recreates the required scheduled automations from the saved Policy definition.

### Delete a Policy
Choose ****Delete****, review the confirmation, then select ****Delete Policy****.

Configuration Manager removes the Policy's scheduled automations, starts cleanup of its saved endpoint state, removes the Policy, and releases the target after cleanup is accepted.

> ****Deleting a Policy does not undo Windows settings that were already applied to endpoints.****

A successful delete does not mean cleanup has already finished on every endpoint. Offline endpoints may complete cleanup later during the configured retry window.

If Delete reports an error, review ****History**** and the related Action1 operations before trying again. A partially completed delete may already have removed some scheduled automations.

**---**

## Understand the Dashboard
Open ****Dashboard**** to see the current state of enabled Policies and their assigned Windows endpoints.

The four headline metrics are:

| Metric | What it means |
| --- | --- |
| ****Active Policies**** | Number of enabled Policies |
| ****Need Attention**** | Fully evaluated Policy/endpoint assignments with at least one non-compliant Control |
| ****Overall Compliance**** | Compliant assignments as a percentage of fully evaluated assignments |
| ****Evaluation Coverage**** | Fully evaluated assignments as a percentage of all assigned assignments |

> ****Important:**** Compliance and Coverage answer different questions. A Policy can show ****100% Compliance**** while Coverage is below 100% if some endpoints have not produced a complete result yet.

### Result states
| Result state | What it means |
| --- | --- |
| ****No Data**** | No matching Control results are currently available |
| ****Partial**** | Some results are available, but not enough to cover all selected Controls |
| ****Compliant**** | All expected results are present and none are non-compliant |
| ****Need Attention**** | All expected results are present and at least one Control is non-compliant |

Offline endpoints remain part of the assigned endpoint population while they are present in Action1 inventory.

The Dashboard also shows ****Top controls needing attention****, which highlights Control/Policy combinations affecting the most endpoints according to the non-compliance report.

### Refresh Dashboard data
Select ****Refresh**** to request updated Dashboard report data.

Refresh does ****not**** execute a Policy or trigger remediation. It requeries reporting data and briefly waits for updated results.

If an endpoint is offline, its previous report data may remain visible until newer data becomes available.

**---**

## Set up and use Action1 reports
Reporting is configured once from ****Settings → Reporting**** by selecting ****Set up reporting****.

Configuration Manager creates the ****Configuration Management - Control Status**** data source and a set of Action1 Custom Reports. Some reports provide data for the Configuration Manager Dashboard, while others support detailed investigation and analysis.

Wait until both ****Data source**** and ****Reports**** show ****Configured****. Reporting setup takes effect immediately and does not require ****Save settings****.

The reports are available directly under ****Custom Reports**** in the ****Action1 Console****:

| Report | Use it to |
| --- | --- |
| ****Configuration Management - Details**** | Inspect individual endpoint and Control results |
| ****Configuration Management - by Endpoint**** | Review results by device |
| ****Configuration Management - by Control**** | Review results by Control |
| ****Configuration Management - by Policy**** | Review results by Policy |
| ****Configuration Management - by Status**** | Find results by reported status |
| ****Configuration Management - Dashboard Endpoints**** | Provide endpoint coverage data for the Dashboard |
| ****Configuration Management - Dashboard Non-Compliant Endpoints**** | Provide endpoint-level non-compliance data |
| ****Configuration Management - Dashboard Non-Compliant Controls**** | Provide Control-level non-compliance data |

These Custom Reports can be opened and used independently of the Configuration Manager Dashboard.

Detailed report data can include:

- configuration status;

- ****Last Checked At****;

- ****Remediation Attempted****;

- ****Last Remediated At****;

- ****Message****.

Report timestamps are shown in UTC.

**---**

## Use History
Open ****History**** to review Configuration Manager management operations.

History records Policy lifecycle operations, including creation, updates, enabling, disabling, and deletion. It also records reconciliation and reporting setup operations.

Operation results are shown as ****Success****, ****Failed****, or ****Running****.

Select ****Details**** on a row for more information about the operation.

> ****History is not endpoint execution history.**** To see when scheduled automations ran or what an individual endpoint reported, use the corresponding Action1 automation and reports.

Use ****Refresh**** to reload History. This does not refresh Dashboard reporting data.

**---**

## Configure Settings
### Policy reconciliation
Under ****Settings → Policy reconciliation****, choose how often Configuration Manager should check enabled Policies for missing scheduled automations.

Available intervals are:

- Every 3 hours

- Every 6 hours

- Every 12 hours

- Every 24 hours

The default is every 6 hours.

Select ****Save settings**** after changing the interval.

Reconciliation recreates scheduled automations that are missing for enabled Policies. It does not run endpoint assessments, check compliance, or repair arbitrary edits to existing automations.

Select ****Reconcile now**** to run reconciliation immediately.

### Reporting
Use ****Set up reporting**** when the Configuration Manager reporting resources have not yet been configured.

This action starts immediately and does not depend on ****Save settings****.

### Advanced settings
Expand ****Advanced settings**** to find ****Enable debug logging****.

Debug logging is disabled by default. Enable it when additional diagnostic information is required in Configuration Manager runtime logs, then select ****Save settings****.

Configuration Manager does not provide a built-in log viewer. Follow the organization's support process when runtime logs need to be collected.

**---**

## Troubleshooting

The following checks cover the most common Configuration Manager issues.

### Policy created, but no results are available

Check the following:

1. The Policy status is **Enabled**.
2. The Organization and Target are correct.
3. The scheduled Action1 automations exist.
4. Reporting shows **Configured**.

Allow time for the scheduled automations to run and for report data to become available. Then select **Refresh** on the Dashboard to request updated reporting data.

### Endpoint shows No Data or Partial

| Status | Meaning |
| --- | --- |
| **No Data** | No matching results are currently available for the Policy and endpoint assignment |
| **Partial** | Some expected Control results are available, but the evaluation is not complete |

Check the relevant Action1 report and automation status. Offline endpoints can remain assigned without producing new results.

If an endpoint was recently renamed, inventory and report data may temporarily use different names until both sides catch up.

### Compliance is high, but Coverage is low

This can occur because **Overall Compliance** includes only fully evaluated assignments.

Use **Evaluation Coverage** and the **Partial / No data** column to determine how much of the assigned endpoint population has a complete result.

### Organization or endpoint group cannot be selected

Another Policy may already reserve the target.

Reserved groups remain visible as **Used by another Policy**. Disabled Policies keep their reservations, while successful deletion releases them.

### Remediation did not make an endpoint compliant

**Assess and remediate** attempts remediation only when the selected Control supports it.

A remediation can fail, be blocked, require a restart, or still result in a non-compliant state. Review the detailed Action1 report, especially the status and **Message**, and inspect the corresponding automation if needed.

### Policy action failed

Open **History** and inspect the failed operation.

Some steps may already have completed before the failure. For example, a failed Delete may already have removed some scheduled automations while keeping the Policy and its target reservation.

Review the current state before repeating a destructive action.

### Existing Policy cannot be saved after a Control Pack update

The installed Control Pack defines the currently available Controls and parameter contracts.

Existing Policies keep their saved Control selections and versions. Replacing the Control Pack does not automatically migrate them.

If a saved Control or Control Family is no longer compatible with the installed release, the Policy may need to be reviewed before it can be saved or enabled again.

---

## Control Pack
The Control Pack contains the Controls and baselines available in Configuration Manager.

The Controls step shows the version of the currently loaded Control Pack.

Detailed documentation for individual Controls, baseline contents, prerequisites, and Control Pack changes is published separately from this User Guide.

**---**
