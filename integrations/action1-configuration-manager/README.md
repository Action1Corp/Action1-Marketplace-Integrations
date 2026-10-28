# Action1 Configuration Manager

## Cross-integration Policy links and Delete

Other Marketplace integrations can link to the existing Policy views:

| View | URL |
| --- | --- |
| Details | `/apps/action1-configuration-manager/policies?policyId=<POLICY_ID>` |
| Edit | `/apps/action1-configuration-manager/policies?policyId=<POLICY_ID>&mode=edit` |
| Create | `/apps/action1-configuration-manager/policies?mode=create` |
| Create with suggested name | `/apps/action1-configuration-manager/policies?mode=create&policyName=<URL_ENCODED_NAME>` |

Use `URLSearchParams` to encode query values. For example, `?mode=create&policyName=Remote%20Workforce` opens the normal Create wizard at its first step with Policy Name set to `Remote Workforce`. The name is an initial suggestion only: user edits are retained during the wizard, and normal name trimming and validation still apply. `policyName` is ignored outside Create. No additional name-length rule applies to the prefill.

Visiting a URL never creates or saves a Policy. The user must complete Organization, Target, Policy mode, Controls/Baseline, Review, and the normal final confirmation. Headless Create is not part of this cross-integration contract.

Refresh reopens the requested view, using persisted Policy data for Edit or the original suggested name for Create; unsaved edits are not restored. Browser Back/Forward follows the requested views. Edit Cancel and successful Edit return to Details; Create Cancel and successful Create return to the Policies list. Closing an editor replaces its history entry so Back does not immediately reopen that dismissed wizard. Unsupported navigation modes fall back to Details when a Policy ID is present, or the list otherwise. Edit requires a Policy ID; unknown Policies show the normal not-found state. Create ignores a stray Policy ID.

An integration frontend can delete a Policy through the authenticated Marketplace session:

```http
POST /api/integrations/action1-configuration-manager/actions/delete-policy
Content-Type: application/json
```

```json
{
  "payload": {
    "policyId": "POL-000064"
  }
}
```

The `payload` wrapper is required. `policyId` must be a nonempty string after trimming. Send only this identifier; Configuration Manager loads the stored Policy and its owned Automation information. Caller-supplied organization, scope, Automation identifiers, or cleanup settings cannot override that state.

Delete uses the same lifecycle as Configuration Manager's Delete button: owned scheduled Automations are removed, transient endpoint-state cleanup is accepted, and the Policy, Controls, correlations, and scope reservation are removed. Cleanup acceptance does not mean every endpoint has completed cleanup. Failed or ambiguous cleanup keeps the Policy and reservation; do not blindly retry an ambiguous request.

Callers should check HTTP status, `result.ok`, and `result.deleted`:

| Outcome | Result |
| --- | --- |
| Deleted | `ok: true`, `deleted: true`, `message: "Policy deleted."`, `policy: <deleted Policy snapshot>`, `details: <History information>` |
| Valid but unknown/already deleted ID | `ok: true`, `deleted: false`, `message: "Policy was not found."`, `policy: null`, `details: <History information>` |
| Invalid ID or lifecycle failure | `ok: false`, `message: <safe error>`, `details: <History information>` |

An HTTP-success response can still contain `ok: false`. Do not parse message text or `details` to determine the outcome. Delete remains History-tracked and subject to Marketplace authentication and write-access permissions; use the normal action request above without disabling History. Backend-to-backend integration invocation is not supported by this contract.

Action1 Configuration Manager helps you define, deploy, monitor, and maintain Windows configuration policies through Action1.

Policies are built from a versioned Configuration Manager Control Pack. Each policy targets an Action1 organization and either all Windows endpoints in that organization or a specific endpoint group.

Configuration Manager uses Action1 Automations to evaluate configuration controls, apply remediation where supported, and collect configuration state from managed endpoints.

---

## What You Can Do

With Configuration Manager, you can:

- Create Windows configuration policies from predefined controls.
- Apply a policy to all Windows endpoints in an Action1 organization or to a specific endpoint group.
- Configure control-specific values when a control requires parameters.
- Enable, disable, edit, and delete policies.
- Monitor policy evaluation and compliance from the Dashboard.
- Review endpoint and control-level configuration results through Action1 Reports.
- Review policy execution activity from History.
- Refresh Dashboard reporting data on demand.

---

## Dashboard

The Dashboard provides a current view of configuration policy coverage and compliance.

### Active Policies

The number of enabled Configuration Manager policies currently included in Dashboard calculations.

The secondary value shows the number of Windows endpoints assigned to those policies.

### Need Attention

The number of fully evaluated endpoints where one or more selected controls are non-compliant.

An endpoint is included here only after Configuration Manager has a complete result set for the controls currently selected in its policy.

### Overall Compliance

The percentage of fully evaluated endpoints where every selected control is compliant.

Calculation:

`Compliant endpoints / Fully evaluated endpoints`

Endpoints with partial results or no current evaluation data are excluded from this percentage.

If no endpoints have been fully evaluated yet, Overall Compliance is shown as `—`.

### Evaluation Coverage

The percentage of assigned endpoints for which Configuration Manager currently has a complete result for every selected control.

Calculation:

`Fully evaluated endpoints / Assigned endpoints`

Evaluation Coverage represents the latest available reporting snapshot. It may temporarily decrease after a policy is changed, when new controls are added, or while updated endpoint results are still being collected.

---

## Policy Metrics

The Policies table provides policy-level details.

### Assigned

Windows endpoints currently included in the policy target.

Offline or temporarily unavailable endpoints remain assigned to the policy.

### Evaluated

Assigned endpoints with a complete current result for every control selected in the policy.

### Compliant

Fully evaluated endpoints where every selected control is compliant.

### Need Attention

Fully evaluated endpoints where at least one selected control is non-compliant.

### Partial / No Data

Endpoints for which Configuration Manager does not yet have a complete current result set.

**Partial** means some control results are available, but the complete expected set has not yet been received.

**No Data** means the endpoint is assigned to the policy but no current configuration result is available.

### Coverage

The percentage of assigned endpoints that are fully evaluated.

### Compliance

The percentage of fully evaluated endpoints that are compliant.

---

## Top Controls Needing Attention

The **Top controls needing attention** section highlights controls currently affecting the largest number of endpoints.

Each entry represents a specific control within a specific policy.

Use the report link below the table to open the corresponding Action1 report and review affected endpoints in more detail.

---

## Creating a Policy

Open **Policies** and select **Create Policy**.

The policy wizard guides you through four steps.

### 1. Policy

Enter the policy name and select the Action1 organization.

### 2. Target

Choose the Windows endpoint scope for the policy:

- **All Endpoints**
- A specific Action1 endpoint group

Each policy owns its selected scope.

An endpoint group that is already assigned to another Configuration Manager policy in the same organization cannot be selected again.

An **All Endpoints** policy is exclusive for that organization.

Disabled policies continue to reserve their scope until they are deleted.

### 3. Controls

Select the configuration controls that should be included in the policy.

Controls are organized by configuration family.

Some controls require additional values. Required values must be completed before the policy can be saved.

### 4. Schedule

Configure when Action1 should run the policy.

Configuration Manager currently supports hourly recurrence.

The schedule includes:

- Run every
- Start date
- Start time
- Time zone
- Completion deadline

After the policy is created, Configuration Manager provisions the required Action1 Automations.

---

## Policy Names

Configuration Manager displays policies using the policy name and target scope.

Example:

`Windows 11 Security Baseline - Remote Workforce`

This makes policies with similar purposes easier to distinguish when they target different groups.

---

## Action1 Automations

Configuration Manager creates and manages the Action1 Automations required by each enabled policy.

Automation names use the following format:

`A1CM - <Policy ID> - <Policy Name> - <Control Family>`

Example:

`A1CM - POL-000055 - Windows 11 Security Baseline - Removable Storage`

Links from Policy Details can be used to open the corresponding Automation in the Action1 console.

Configuration Manager tracks Automations by their Action1 IDs. The Automation name is intended for identification and readability in the Action1 console.

---

## Editing a Policy

Open the policy from the Policies page and select **Edit**.

You can update:

- Policy name
- Selected controls
- Control values
- Schedule

The organization and target scope cannot currently be changed after the policy is created.

If a control is removed from a policy, Configuration Manager also schedules cleanup of that control's stored configuration state on affected endpoints.

After adding a new control, Dashboard Evaluation Coverage may temporarily decrease until endpoints have produced results for the newly selected control.

---

## Enabling and Disabling Policies

### Disable

Disabling a policy removes its scheduled Action1 Automations.

The policy remains stored in Configuration Manager and continues to reserve its selected target scope.

### Enable

Enabling the policy recreates the required scheduled Action1 Automations using the current policy definition.

---

## Deleting a Policy

Deleting a policy:

- Removes its managed scheduled Action1 Automations.
- Releases its target reservation.
- Schedules cleanup of Configuration Manager state stored for that policy on affected endpoints.
- Removes the policy from Configuration Manager.

Deletion does not modify unrelated Configuration Manager policies or their endpoint state.

---

## Policy Details

Select a policy name from the Policies page to open **Policy Details**.

Policy Details shows:

- Policy status
- Organization
- Target scope
- Selected controls
- Control values
- Schedule
- Associated Action1 Automations

Available actions include:

- Edit
- Enable or Disable
- Delete

---

## History

The **History** page provides execution history for Configuration Manager policies.

Use History to review recent policy runs and their aggregated results.

Depending on the execution, results may include:

- Succeeded
- Skipped
- Failed

History reflects execution activity that has already occurred and is not rewritten when a policy name or display format changes later.

---

## Reports

Configuration Manager provisions Action1 Reports that provide detailed configuration data.

The reporting package includes views for:

- Configuration details
- Results by endpoint
- Results by control
- Results by policy
- Results by status
- Dashboard endpoint coverage
- Dashboard non-compliant endpoints
- Dashboard non-compliant controls

Dashboard links can be used to open the relevant Action1 report for deeper investigation.

---

## Refreshing Dashboard Data

The Dashboard initially displays the latest available report data.

Select **Refresh** to request updated Configuration Manager report data from Action1.

A refresh may take several seconds while Action1 requests current data from endpoints and updates the corresponding reports.

Endpoints that are offline or unavailable may continue to show partial results or no current data.

---

## Reporting Setup

If Configuration Manager reporting has not yet been provisioned, use the reporting setup action available in Configuration Manager Settings.

Setup creates the reports required by the integration.

The operation is additive and can be run again if some Configuration Manager reports are missing.

Existing Configuration Manager reports are reused rather than intentionally duplicated.

---

## Control Pack

Configuration Manager controls are supplied through the versioned **Windows Endpoint Configuration Control Pack**.

Each released Control Pack version is immutable. A released version is not modified in place; changes are delivered as a new version.

For example:

- `0.5.0`
- `0.6.0`
- `0.7.0`

The repository currently contains Control Pack release `0.5.0`.

Configuration Manager currently discovers exactly one installed release directory automatically. There is no version selector and no automatic semver selection.

To update the Control Pack, replace the installed release directory, restart the Marketplace backend, and refresh the frontend.

---

## Endpoint Configuration State

Configuration Manager stores the latest state for each evaluated control on the Windows endpoint under:

`C:\Windows\Action1\ConfigurationManager\<PolicyId>\<ControlId>.json`

Each selected control maintains its own state file.

This state is used by Configuration Manager reporting and is cleaned up when controls or policies are removed through supported Configuration Manager operations.

---

## Credentials and Action1 Access

Configuration Manager does not maintain a separate set of Action1 credentials.

It uses the Action1 connection provided by the Marketplace environment.

Users therefore do not need to configure separate API credentials specifically for Configuration Manager.

---

## Important Behavior

### Dashboard data is a current snapshot

Dashboard Coverage and Compliance represent the latest available configuration results.

They are not historical trend metrics.

### Policy changes can temporarily reduce Coverage

If a policy previously contained 10 controls and an additional control is added, an endpoint with results for only the original 10 controls is temporarily considered **Partial** until the new result is available.

### Offline endpoints remain assigned

An endpoint does not stop being part of a policy simply because it is offline.

It remains in the Assigned count and may appear as Partial or No Data until current results are available.

### Disabled policies retain their target

Disabling a policy stops its scheduled Automations but does not release its organization or endpoint-group reservation.

Delete the policy to release that target.

---

## Current Limitations

The current version has several intentional limitations:

- A policy targets one Action1 organization and either All Endpoints or one endpoint group.
- The organization and target cannot currently be changed after policy creation.
- Scheduling currently supports hourly recurrence.
- Exactly one Control Pack release must be installed under the Control Pack directory.
- The installed release is discovered automatically after a backend restart.
- Historical Dashboard trends are not currently stored.
- Configuration Manager does not provide its own Action1 credential configuration.

These limitations may be expanded in future versions.
