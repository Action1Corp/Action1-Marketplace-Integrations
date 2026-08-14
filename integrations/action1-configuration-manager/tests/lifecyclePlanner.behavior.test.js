const assert = require('assert');
const { planLifecycleDiff, summarizeLifecycleDiff } = require('../lifecyclePlanner');

const definition = (group, fingerprint) => ({ automationGroupId: group, fingerprint });
const correlation = (group, fingerprint) => ({ automationGroupId: group, desiredDefinitionFingerprint: fingerprint, active: true, action1AutomationId: `a-${group}` });

const operations = planLifecycleDiff(
  [definition('a', 'same'), definition('b', 'new'), definition('c', 'created')],
  [correlation('a', 'same'), correlation('b', 'old'), correlation('d', 'removed')]
);

assert.deepStrictEqual(operations.map((entry) => [entry.automationGroupId, entry.type]), [
  ['a', 'UNCHANGED'], ['b', 'PATCH'], ['c', 'CREATE'], ['d', 'DELETE']
]);
assert.deepStrictEqual(summarizeLifecycleDiff(operations), { unchanged: 1, patch: 1, create: 1, delete: 1 });

const noop = planLifecycleDiff([definition('a', 'same')], [correlation('a', 'same')]);
assert.strictEqual(noop.length, 1);
assert.strictEqual(noop[0].type, 'UNCHANGED');
