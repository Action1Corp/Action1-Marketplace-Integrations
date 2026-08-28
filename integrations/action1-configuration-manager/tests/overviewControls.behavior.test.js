const assert = require('assert');
const { buildOverviewViewModel, normalizeDashboardControlRow, selectTopControlsNeedingAttention } = require('../overviewService');

function policy(policyId, organizationId = 'org-1', enabled = true) {
  return { policyId, baseName: `Policy ${policyId}`, organizationId, enabled, scopeType: 'ALL_ENDPOINTS', selectedControls: [{ controlId: 'a' }] };
}

(async () => {
  assert.deepStrictEqual(normalizeDashboardControlRow({ fields: { 'Policy ID': 'POL-1', 'Policy Name': 'Policy One', 'Control Name': 'Minimum password length', Details: '42' } }, 'org-1'), {
    policyId: 'POL-1', policyName: 'Policy One', organizationId: 'org-1', controlName: 'Minimum password length', affectedEndpointCount: 42
  });
  assert.strictEqual(normalizeDashboardControlRow({ fields: { 'Policy ID': 'POL-1', 'Control Name': 'Bad', Details: 'not-a-number' } }, 'org-1'), null);

  const rows = [
    { policyId: 'POL-1', policyName: 'Policy One', organizationId: 'org-1', controlName: 'Same control', affectedEndpointCount: 42 },
    { policyId: 'POL-2', policyName: 'Policy Two', organizationId: 'org-1', controlName: 'Same control', affectedEndpointCount: 42 },
    { policyId: 'POL-3', policyName: 'Policy Three', organizationId: 'org-1', controlName: 'Largest', affectedEndpointCount: 50 },
    { policyId: 'POL-4', policyName: 'Disabled', organizationId: 'org-1', controlName: 'Ignored', affectedEndpointCount: 100 }
  ];
  assert.deepStrictEqual(selectTopControlsNeedingAttention(rows, [policy('POL-1'), policy('POL-2'), policy('POL-3'), policy('POL-4', 'org-1', false)]).map(row => row.controlName), ['Largest', 'Same control', 'Same control']);
  assert.strictEqual(selectTopControlsNeedingAttention(Array.from({ length: 8 }, (_, i) => ({ ...rows[0], controlName: `C${i}`, affectedEndpointCount: i })), [policy('POL-1')]).length, 5);
  assert.deepStrictEqual(selectTopControlsNeedingAttention([{ ...rows[0], policyId: 'POL-9' }], [policy('POL-1')]), []);

  const result = buildOverviewViewModel({ policies: [policy('POL-1'), policy('POL-2'), policy('POL-3')], assignedEndpointsByPolicy: { 'POL-1': [], 'POL-2': [], 'POL-3': [] }, dashboardControlRows: rows });
  assert.deepStrictEqual(result.topControlsNeedingAttention.map((row) => row.controlName), ['Largest', 'Same control', 'Same control']);
})().catch(error => { console.error(error); process.exit(1); });
