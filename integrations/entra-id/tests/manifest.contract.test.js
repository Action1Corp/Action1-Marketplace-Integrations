const assert = require('assert');
const manifest = require('../manifest.json');

function run() {
  const validateAction = manifest.actions.find((action) => action.id === 'validate-configuration');
  assert.strictEqual(validateAction, undefined, 'this settings-validation slice should not expose a premature validate/test action before real Entra API/client wiring exists');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
