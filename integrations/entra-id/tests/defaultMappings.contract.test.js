const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'core', 'config', 'defaultMappings.mjs')).href;
  const resolverUrl = pathToFileURL(path.join(__dirname, '..', 'settingsResolver.mjs')).href;
  const { DEFAULT_MAPPINGS } = await import(moduleUrl);
  const { getAttributeDefaultMappings } = await import(resolverUrl);
  const settingsSchema = require('../ui/settingsSchema.json');

  assert.deepStrictEqual(
    DEFAULT_MAPPINGS,
    [
      {
        entraProperty: 'memberOf',
        action1CustomAttribute: 'Entra Groups'
      },
      {
        entraProperty: 'deviceOwnership',
        action1CustomAttribute: 'Entra Device Ownership'
      }
    ],
    'default mappings should preserve the standalone Entra custom-attribute defaults exactly'
  );
  assert.deepStrictEqual(
    DEFAULT_MAPPINGS,
    getAttributeDefaultMappings(settingsSchema),
    'default mappings should derive from the shared settings resolver defaults'
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
