const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const settingsSchema = require('../ui/settingsSchema.json');

async function importResolver() {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'settingsResolver.mjs')).href;
  return import(moduleUrl);
}

function buildCleanHostSettings() {
  return Object.fromEntries(settingsSchema.map((setting) => [setting.key, '']));
}

function getSetting(key) {
  const setting = settingsSchema.find((row) => row.key === key);
  assert(setting, `expected Entra setting ${key} to exist in schema`);
  return setting;
}

async function run() {
  const resolver = await importResolver();
  const cleanSettings = buildCleanHostSettings();

  const effectiveSettings = resolver.resolveEffectiveSettings(settingsSchema, cleanSettings, {
    storedSecrets: {},
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(
    effectiveSettings.EntraGroupsCustomAttributeName,
    'Entra Groups',
    'clean host empty strings should hydrate the Entra Groups custom attribute default'
  );
  assert.strictEqual(
    effectiveSettings.EntraDeviceOwnershipCustomAttributeName,
    'Entra Device Ownership',
    'clean host empty strings should hydrate the Entra Device Ownership custom attribute default'
  );

  assert.strictEqual(
    effectiveSettings.EntraTenantId,
    '',
    'required Entra tenant settings without schema defaults should remain blank on a clean host payload'
  );
  assert.strictEqual(
    effectiveSettings.EntraClientId,
    '',
    'required Entra client settings without schema defaults should remain blank on a clean host payload'
  );

  const loadedState = resolver.buildLoadedSettingsState(settingsSchema, cleanSettings, {
    storedSecrets: {},
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(
    loadedState.attributeSettings.EntraGroupsCustomAttributeName,
    'Entra Groups',
    'buildLoadedSettingsState should surface the Entra Groups default when the host returns empty strings'
  );
  assert.strictEqual(
    loadedState.attributeSettings.EntraDeviceOwnershipCustomAttributeName,
    'Entra Device Ownership',
    'buildLoadedSettingsState should surface the Entra Device Ownership default when the host returns empty strings'
  );
  assert.strictEqual(
    loadedState.connectionEditing,
    true,
    'clean host empty-string settings should still render the Entra connection in expanded edit mode'
  );

  const serializedCleanSave = resolver.buildSavePayload(
    resolver.getSettingsGroup(settingsSchema, resolver.ATTRIBUTE_GROUP),
    'entra-id',
    loadedState.attributeSettings,
    {
      sensitiveKeys: new Set(['EntraClientSecret']),
      secretMask: resolver.SECRET_MASK
    }
  );
  assert.strictEqual(
    serializedCleanSave.EntraGroupsCustomAttributeName,
    'Entra Groups',
    'untouched clean-save attribute payloads should persist the Entra Groups default'
  );
  assert.strictEqual(
    serializedCleanSave.EntraDeviceOwnershipCustomAttributeName,
    'Entra Device Ownership',
    'untouched clean-save attribute payloads should persist the Entra Device Ownership default'
  );

  const customSettings = resolver.resolveEffectiveSettings(settingsSchema, {
    ...cleanSettings,
    EntraGroupsCustomAttributeName: 'Custom Groups',
    EntraDeviceOwnershipCustomAttributeName: 'Custom Ownership'
  }, {
    storedSecrets: {},
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(
    customSettings.EntraGroupsCustomAttributeName,
    'Custom Groups',
    'saved custom Entra group attribute names should override schema defaults'
  );
  assert.strictEqual(
    customSettings.EntraDeviceOwnershipCustomAttributeName,
    'Custom Ownership',
    'saved custom Entra ownership attribute names should override schema defaults'
  );

  assert.strictEqual(
    resolver.getDisplayedSettingValue(getSetting('EntraGroupsCustomAttributeName'), cleanSettings),
    'Entra Groups',
    'displayed Entra Groups values should resolve the schema default from a clean host payload'
  );
  assert.strictEqual(
    resolver.getDisplayedSettingValue(getSetting('EntraDeviceOwnershipCustomAttributeName'), cleanSettings),
    'Entra Device Ownership',
    'displayed Entra Device Ownership values should resolve the schema default from a clean host payload'
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
