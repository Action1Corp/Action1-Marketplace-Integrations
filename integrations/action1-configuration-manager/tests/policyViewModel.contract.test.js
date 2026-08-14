const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function buildCatalog() {
  const { loadReleasedControlCatalog } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'catalog', 'controlPackCatalog.js')).href
  );
  return loadReleasedControlCatalog();
}

async function run() {
  const {
    formatPolicyListRow,
    getPolicyRowActions,
    formatPolicyDetails,
    buildCompactControlFamilyGroups
  } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyViewModel.js')).href);
  const catalog = await buildCatalog();

  const enabledPolicy = {
    policyId: 'POL-000001',
    displayName: 'Workstation Security \u2014 Finance Workstations',
    enabled: true,
    organizationNameSnapshot: 'Acme Corp',
    scopeType: 'ENDPOINT_GROUP',
    endpointGroupNameSnapshot: 'Finance Workstations',
    policyMode: 'ASSESS_AND_REMEDIATE',
    runSchedule: {
      runEveryHours: 6,
      startDate: '2026-08-01',
      startTime: '09:30',
      timezone: 'America/Los_Angeles'
    },
    completionDeadlineMinutes: 360,
    selectedControls: [
      {
        controlId: 'identity.password.minimum-length',
        automationGroupId: 'identity.password-policy',
        parameters: { minimumLength: 14 }
      },
      {
        controlId: 'identity.password.maximum-age',
        automationGroupId: 'identity.password-policy',
        parameters: { maximumAgeDays: 90 }
      }
    ],
    selectedFamilyCount: 1,
    expectedAutomationCount: 1,
    action1Automations: [
      {
        automationId: 'auto-001',
        controlFamilyName: 'Password Policy',
        automationName: 'A1CM \u2014 Workstation Security \u2014 Finance Workstations \u2014 Password Policy',
        action1ConsoleUrl: 'https://regional.action1.example.test/console/automations?filter=encoded'
      }
    ]
  };

  assert.deepStrictEqual(
    formatPolicyListRow(enabledPolicy),
    {
      policyName: 'Workstation Security \u2014 Finance Workstations',
      status: 'Enabled',
      targetPrimary: 'Acme Corp',
      targetSecondary: 'Finance Workstations',
      modeLabel: 'Assess and remediate',
      scheduleLabel: 'Every 6 h'
    },
    'list rows should format Policy, Status, Target, Mode, and Schedule values for the Blueprint table'
  );

  assert.deepStrictEqual(
    getPolicyRowActions(enabledPolicy),
    ['openDetails', 'edit', 'disable', 'delete'],
    'enabled demo policies should expose Open details, Edit, Disable, and Delete'
  );

  assert.deepStrictEqual(
    getPolicyRowActions({
      ...enabledPolicy,
      enabled: false,
      action1Automations: []
    }),
    ['openDetails', 'edit', 'enable', 'delete'],
    'disabled demo policies should expose Enable instead of Disable'
  );

  const details = formatPolicyDetails(enabledPolicy, catalog);
  assert.strictEqual(details.statusLabel, 'Enabled', 'details data should expose a compact read-only status');
  assert.strictEqual(details.scopeLabel, 'Finance Workstations', 'details data should expose the saved scope label');
  assert.strictEqual(details.policyModeLabel, 'Assess and remediate', 'details data should expose the saved policy mode');
  assert.strictEqual(details.scheduleLabel, 'Every 6 h', 'details data should expose the compact run-schedule label');
  assert.strictEqual(
    details.policyName,
    'Workstation Security \u2014 Finance Workstations',
    'details data should preserve an encoding-safe em dash in the Policy display name'
  );
  assert.strictEqual(
    details.automationRows[0].action1Url,
    'https://regional.action1.example.test/console/automations?filter=encoded',
    'details data should preserve deterministic Action1 automation links'
  );
  assert.strictEqual(
    Array.isArray(details.controlFamilyGroups),
    true,
    'details data should group Controls and Action1 automations by Control Family'
  );
  assert.strictEqual(details.controlFamilyGroups.length, 1, 'details data should group the sample Policy under one Control Family');
  assert.strictEqual(details.controlFamilyGroups[0].familyName, 'Password Policy', 'details groups should use the human-readable Control Family name');
  assert.strictEqual(
    details.controlFamilyGroups[0].automationLink.action1Url,
    'https://regional.action1.example.test/console/automations?filter=encoded',
    'details groups should retain the trusted demo automation link'
  );

  const hydratedDetails = formatPolicyDetails({
    ...enabledPolicy,
    action1Automations: [{
      action1AutomationId: 'auto-002',
      action1OrganizationId: 'org',
      controlFamilyNameSnapshot: 'Password Policy',
      action1AutomationName: 'A1CM — Workstation Security — Password Policy',
      action1AutomationSelf: 'https://app.action1.com/api/3.0/automations/schedules/org/auto-002'
    }]
  }, catalog);
  assert(hydratedDetails.automationRows[0].action1Url.includes('/console/automations'));
  assert(!hydratedDetails.automationRows[0].action1Url.includes('/api/3.0/'));
  assert.strictEqual(hydratedDetails.controlFamilyGroups[0].automationLink.action1Url, hydratedDetails.automationRows[0].action1Url);
  assert.strictEqual(
    details.controlFamilyGroups[0].controls[0].controlName,
    'Minimum password length',
    'details groups should use the released catalog Control name instead of the raw control id'
  );
  assert.deepStrictEqual(
    details.controlFamilyGroups[0].controls[0].chips,
    [{ label: 'Minimum length', value: '14 characters' }],
    'details groups should expose the same compact control/value chip data used by the wizard Review step'
  );
  assert.strictEqual(
    details.controlFamilyGroups[0].controls[1].chips[0].label,
    'Maximum age',
    'details groups should use released catalog parameter labels in the shared compact chip data'
  );
  assert.strictEqual(
    details.controlFamilyGroups[0].controls[1].chips[0].value,
    '90 days',
    'details groups should format parameter values for customer-facing display in the shared compact chip data'
  );
  assert.strictEqual(
    JSON.stringify(details).includes('identity.password.minimum-length'),
    false,
    'details data must not expose raw control ids to the customer-facing Details view'
  );
  assert.strictEqual(
    JSON.stringify(details).includes('{"maximumAgeDays":90}'),
    false,
    'details data must not expose raw parameter JSON in the customer-facing Details view'
  );
  assert.strictEqual(
    JSON.stringify(details).includes('Automation Group'),
    false,
    'view-model helpers must not return customer-facing Automation Group terminology'
  );

  const compactGroups = buildCompactControlFamilyGroups({
    selectedControls: enabledPolicy.selectedControls,
    action1Automations: enabledPolicy.action1Automations,
    catalog
  });
  assert.deepStrictEqual(
    compactGroups,
    details.controlFamilyGroups,
    'Policy Details should reuse the shared compact Control summary grouping used by the wizard Review data model'
  );
}

try {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
