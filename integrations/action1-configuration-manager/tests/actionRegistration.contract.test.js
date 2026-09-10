const assert = require('assert');
const path = require('path');

function run() {
  const integrationDir = path.join(__dirname, '..');
  const manifest = require(path.join(integrationDir, 'manifest.json'));
  const entrypoint = require(path.join(integrationDir, manifest.entry || 'index.js'));
  const declaredActionIds = manifest.actions.map((action) => action.id).sort();
  const exportedActionIds = Object.keys(entrypoint.actions || {}).sort();

  assert.deepStrictEqual(
    exportedActionIds,
    declaredActionIds,
    'the Marketplace entrypoint must export every manifest-declared action and no stale action set'
  );
assert.strictEqual(typeof entrypoint.actions['discover-policy-organizations'], 'function');
assert.strictEqual(typeof entrypoint.actions['get-control-pack'], 'function');
  assert.strictEqual(typeof entrypoint.actions['discover-policy-endpoint-groups'], 'function');
}

try {
  run();
  console.log('Configuration Manager action registration contract passed.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
