const assert = require('assert');
const manifest = require('../manifest.json');

function run() {
  const validateAction = manifest.actions.find((action) => action.id === 'validate-configuration');
  assert(validateAction, 'manifest should expose the Entra validate-configuration action');
  assert.strictEqual(validateAction.kind, 'validate');
  assert.strictEqual(validateAction.placement, 'settings');
  assert.strictEqual(validateAction.history, false);
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
