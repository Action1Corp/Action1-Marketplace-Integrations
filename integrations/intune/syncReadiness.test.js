const assert = require('node:assert/strict');
const test = require('node:test');
const integration = require('./index');

function context(values = {}) {
  return { settings: { get: async key => values[key] } };
}

test('scheduled sync waits for an enabled profile and reflects profile deletion', async () => {
  const values = {};
  const runtime = context(values);
  assert.equal(await integration.canRunScheduledSync(runtime), false);
  values.IntuneEnrollmentPolicies = '[]';
  assert.equal(await integration.canRunScheduledSync(runtime), false);
  values.IntuneEnrollmentPolicies = JSON.stringify([{ policyId: 'ENR-000001', name: 'Disabled', enabled: false }]);
  assert.equal(await integration.canRunScheduledSync(runtime), false);
  values.IntuneEnrollmentPolicies = JSON.stringify([{ policyId: 'ENR-000001', name: 'Enabled' }]);
  assert.equal(await integration.canRunScheduledSync(runtime), true);
  values.IntuneEnrollmentPolicies = '[]';
  assert.equal(await integration.canRunScheduledSync(runtime), false);
});

test('legacy enrollment profiles remain eligible for scheduled sync', async () => {
  assert.equal(await integration.canRunScheduledSync(context({ IntuneAction1OrgId: 'org-1' })), true);
});

test('manual sync without profiles fails before runtime side effects with a non-retryable status', async () => {
  await assert.rejects(integration.actions.sync(context()), error => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /Create at least one Enrollment and Provisioning profile/);
    return true;
  });
});
