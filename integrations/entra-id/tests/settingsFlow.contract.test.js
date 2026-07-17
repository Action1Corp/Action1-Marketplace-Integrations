const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const helpersUrl = pathToFileURL(path.join(__dirname, '..', 'ui', 'settingsFlowHelpers.mjs')).href;
  const {
    ATTRIBUTE_GROUP,
    CONNECTION_GROUP,
    applySchemaDefaults,
    buildSavePayload,
    buildValidationRequestSettings,
    getInitialConnectionEditing,
    getSettingsGroup,
    isConnectionConfigured,
    missingRequiredSettings,
    pickSettingsValues
  } = await import(helpersUrl);
  const settingsSchema = require('../ui/settingsSchema.json');
  const connectionSchema = getSettingsGroup(settingsSchema, CONNECTION_GROUP);
  const attributeSchema = getSettingsGroup(settingsSchema, ATTRIBUTE_GROUP);

  const firstRenderSettings = applySchemaDefaults(settingsSchema, {}, { storedSecrets: {} });
  assert.strictEqual(getInitialConnectionEditing(connectionSchema, {}, { storedSecrets: {} }), true, 'first-run Entra settings should start expanded');
  assert.strictEqual(isConnectionConfigured(connectionSchema, firstRenderSettings, { storedSecrets: {} }), false, 'first-run Entra settings should not be treated as configured before credentials exist');
  assert.strictEqual(firstRenderSettings.EntraGroupsCustomAttributeName, 'Entra Groups', 'initial render should show the Entra Groups default');
  assert.strictEqual(firstRenderSettings.EntraDeviceOwnershipCustomAttributeName, 'Entra Device Ownership', 'initial render should show the Entra Device Ownership default');

  const configuredSettings = {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: '***'
  };
  assert.strictEqual(
    getInitialConnectionEditing(connectionSchema, configuredSettings, {
      storedSecrets: { EntraClientSecret: true },
      secretMask: '***'
    }),
    false,
    'configured Entra settings should start in collapsed summary mode'
  );
  assert.strictEqual(
    isConnectionConfigured(connectionSchema, configuredSettings, {
      storedSecrets: { EntraClientSecret: true },
      secretMask: '***'
    }),
    true,
    'stored secret placeholders should still count as configured credentials'
  );

  const validationPayload = buildValidationRequestSettings(attributeSchema, firstRenderSettings, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***',
    storedSecrets: {}
  });

  assert.strictEqual(validationPayload.EntraGroupsCustomAttributeName, 'Entra Groups', 'visible Entra Groups defaults should be used before first save');
  assert.strictEqual(validationPayload.EntraDeviceOwnershipCustomAttributeName, 'Entra Device Ownership', 'visible Entra Device Ownership defaults should be used before first save');
  assert.strictEqual(Object.keys(validationPayload._secretModes || {}).length, 0, 'first-run validation should not mark secrets as stored when no stored secret exists');

  const connectionSavePayload = buildSavePayload(connectionSchema, 'entra-id', {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: 'new-secret'
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***'
  });
  assert.deepStrictEqual(
    Object.keys(connectionSavePayload).sort(),
    ['EntraClientId', 'EntraClientSecret', 'EntraTenantId', '_integration'].sort(),
    'Save Connection Settings should only save Entra credential fields'
  );

  const connectionValidationPayload = buildValidationRequestSettings(connectionSchema, {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: 'new-secret'
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***',
    storedSecrets: {}
  });
  assert.deepStrictEqual(
    Object.keys(connectionValidationPayload).sort(),
    ['EntraClientId', 'EntraClientSecret', 'EntraTenantId'],
    'connection-card validation payloads should stay scoped to the Entra credential fields'
  );

  const attributeSavePayload = buildSavePayload(attributeSchema, 'entra-id', firstRenderSettings, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***'
  });
  assert.deepStrictEqual(
    Object.keys(attributeSavePayload).sort(),
    ['EntraDeviceOwnershipCustomAttributeName', 'EntraGroupsCustomAttributeName', '_integration'].sort(),
    'Save Attribute Settings should only save the custom attribute fields'
  );

  const storedSecretPayload = buildValidationRequestSettings(settingsSchema, {
    ...firstRenderSettings,
    EntraClientSecret: '***'
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***',
    storedSecrets: {
      EntraClientSecret: true
    }
  });

  assert.strictEqual(storedSecretPayload.EntraClientSecret, undefined, 'stored secret placeholders should not be echoed into the validation payload');
  assert.strictEqual(storedSecretPayload._secretModes.EntraClientSecret, 'stored', 'stored secrets should be represented through _secretModes');

  const blankStoredSecretPayload = buildValidationRequestSettings(connectionSchema, {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: ''
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***',
    storedSecrets: {
      EntraClientSecret: true
    }
  });
  assert.strictEqual(blankStoredSecretPayload.EntraClientSecret, undefined, 'blank edit-state secrets should not be sent as empty credentials when a stored secret exists');
  assert.strictEqual(blankStoredSecretPayload._secretModes.EntraClientSecret, 'stored', 'blank edit-state secrets should still request the saved secret for Test Connection');

  const storedSecretSavePayload = buildSavePayload(connectionSchema, 'entra-id', {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: '***'
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***'
  });
  assert.strictEqual(storedSecretSavePayload.EntraClientSecret, undefined, 'saved secret placeholders should not overwrite the stored secret on save');

  const clearedGroupsPayload = buildValidationRequestSettings(settingsSchema, {
    ...firstRenderSettings,
    EntraGroupsCustomAttributeName: ''
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***',
    storedSecrets: {}
  });
  assert.strictEqual(clearedGroupsPayload.EntraGroupsCustomAttributeName, '', 'clearing Entra Groups custom attribute name should remain empty in the validation payload');

  const clearedOwnershipPayload = buildValidationRequestSettings(settingsSchema, {
    ...firstRenderSettings,
    EntraDeviceOwnershipCustomAttributeName: ''
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: '***',
    storedSecrets: {}
  });
  assert.strictEqual(clearedOwnershipPayload.EntraDeviceOwnershipCustomAttributeName, '', 'clearing Entra Device Ownership custom attribute name should remain empty in the validation payload');

  assert.deepStrictEqual(
    missingRequiredSettings(connectionSchema, {
      EntraTenantId: '',
      EntraClientId: 'client-id-123',
      EntraClientSecret: ''
    }, {
      storedSecrets: {},
      secretMask: '***'
    }),
    ['EntraTenantId', 'EntraClientSecret'],
    'empty Entra credential fields should fail connection validation'
  );

  assert.deepStrictEqual(
    missingRequiredSettings(attributeSchema, {
      EntraGroupsCustomAttributeName: '',
      EntraDeviceOwnershipCustomAttributeName: 'Entra Device Ownership'
    }),
    ['EntraGroupsCustomAttributeName'],
    'empty custom attribute names should fail attribute validation'
  );

  assert.deepStrictEqual(
    Object.keys(pickSettingsValues(connectionSchema, {
      EntraTenantId: 'tenant-id-123',
      EntraClientId: 'client-id-123',
      EntraClientSecret: '***',
      EntraGroupsCustomAttributeName: 'Entra Groups'
    })).sort(),
    ['EntraClientId', 'EntraClientSecret', 'EntraTenantId'].sort(),
    'connection-card settings should remain separate from attribute settings'
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
