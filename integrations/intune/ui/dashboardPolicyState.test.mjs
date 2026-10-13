import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePoliciesIntoDashboard } from './dashboardPolicyState.mjs';

test('removes a deleted profile and its cached dashboard result', () => {
  const status = {
    selectedPolicyId: 'ENR-1',
    policies: [{ policyId: 'ENR-1' }],
    policyResults: { 'ENR-1': { endpoints: ['old'] } }
  };
  const dashboard = mergePoliciesIntoDashboard(status, []);
  assert.deepEqual(dashboard.policies, []);
  assert.deepEqual(dashboard.policyResults, {});
  assert.equal(dashboard.selectedPolicyId, '');
  assert.equal(dashboard.snapshotPolicyId, 'ENR-1');
});

test('selects a remaining profile without treating the deleted profile snapshot as its data', () => {
  const status = {
    selectedPolicyId: 'ENR-1',
    policies: [{ policyId: 'ENR-1' }, { policyId: 'ENR-2' }],
    policyResults: { 'ENR-1': { endpoints: ['old'] }, 'ENR-2': { endpoints: ['current'] } }
  };
  const dashboard = mergePoliciesIntoDashboard(status, [{ policyId: 'ENR-2', enabled: true }]);
  assert.equal(dashboard.selectedPolicyId, 'ENR-2');
  assert.equal(dashboard.snapshotPolicyId, 'ENR-1');
  assert.deepEqual(dashboard.policyResults, { 'ENR-2': { endpoints: ['current'] } });
});

test('keeps the selected profile when it still exists', () => {
  const dashboard = mergePoliciesIntoDashboard(
    { selectedPolicyId: 'ENR-2', policyResults: { 'ENR-2': { status: 'checked' } } },
    [{ policyId: 'ENR-2', enabled: true }]
  );
  assert.equal(dashboard.selectedPolicyId, 'ENR-2');
  assert.deepEqual(dashboard.policyResults, { 'ENR-2': { status: 'checked' } });
});
