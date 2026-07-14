const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function importResolver() {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'settingsResolver.mjs')).href;
  return import(moduleUrl);
}

async function run() {
  const resolver = await importResolver();
  const settingsSchema = require('../ui/settingsSchema.json');

  const connectionSchema = resolver.getSettingsGroup(settingsSchema, resolver.CONNECTION_GROUP);
  const attributeSchema = resolver.getSettingsGroup(settingsSchema, resolver.ATTRIBUTE_GROUP);

  const defaults = resolver.getDefaultSettings(settingsSchema);
  assert.strictEqual(defaults.EntraGroupsCustomAttributeName, 'Entra Groups', 'schema defaults should define the canonical Entra Groups attribute name');
  assert.strictEqual(defaults.EntraDeviceOwnershipCustomAttributeName, 'Entra Device Ownership', 'schema defaults should define the canonical Entra Device Ownership attribute name');

  const effectiveFirstRun = resolver.resolveEffectiveSettings(settingsSchema, {}, {
    storedSecrets: {},
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(effectiveFirstRun.EntraGroupsCustomAttributeName, 'Entra Groups', 'effective settings should use canonical defaults before first save');
  assert.strictEqual(effectiveFirstRun.EntraDeviceOwnershipCustomAttributeName, 'Entra Device Ownership', 'effective settings should use canonical defaults before first save');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(effectiveFirstRun, 'EntraTenantId'), false, 'effective settings should not invent empty Entra credential values');

  const effectivePersisted = resolver.resolveEffectiveSettings(settingsSchema, {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraGroupsCustomAttributeName: 'Custom Groups',
    EntraDeviceOwnershipCustomAttributeName: 'Custom Ownership'
  }, {
    storedSecrets: {
      EntraClientSecret: true
    },
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(effectivePersisted.EntraGroupsCustomAttributeName, 'Custom Groups', 'persisted attribute values should override defaults');
  assert.strictEqual(effectivePersisted.EntraDeviceOwnershipCustomAttributeName, 'Custom Ownership', 'persisted attribute values should override defaults');
  assert.strictEqual(effectivePersisted.EntraClientSecret, resolver.SECRET_MASK, 'stored secrets should resolve to the shared secret mask');

  const loadedConfiguredState = resolver.buildLoadedSettingsState(settingsSchema, {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123'
  }, {
    storedSecrets: {
      EntraClientSecret: true
    },
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(loadedConfiguredState.connectionEditing, false, 'configured Entra settings should render collapsed after load');
  assert.strictEqual(loadedConfiguredState.connectionConfigured, true, 'stored secret fallback should count as configured after load');

  const loadedFirstRunState = resolver.buildLoadedSettingsState(settingsSchema, {}, {
    storedSecrets: {},
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(loadedFirstRunState.connectionEditing, true, 'first-run Entra settings should render expanded after load');
  assert.strictEqual(loadedFirstRunState.connectionConfigured, false, 'first-run Entra settings should not be treated as configured after load');

  const connectionValidationPayload = resolver.buildValidationRequestSettings(connectionSchema, {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: resolver.SECRET_MASK
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: resolver.SECRET_MASK,
    storedSecrets: {
      EntraClientSecret: true
    }
  });
  assert.deepStrictEqual(
    Object.keys(connectionValidationPayload).sort(),
    ['EntraClientId', 'EntraTenantId', '_secretModes'].sort(),
    'connection validation payload should remain scoped to the Entra credential fields'
  );
  assert.strictEqual(connectionValidationPayload._secretModes.EntraClientSecret, 'stored', 'stored secret placeholders should be represented through the shared secret-mode contract');

  const connectionSavePayload = resolver.buildSavePayload(connectionSchema, 'entra-id', {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: resolver.SECRET_MASK
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: resolver.SECRET_MASK
  });
  assert.deepStrictEqual(
    Object.keys(connectionSavePayload).sort(),
    ['EntraClientId', 'EntraTenantId', '_integration'].sort(),
    'saving a stored secret placeholder should not overwrite the persisted Entra client secret'
  );
  assert.deepStrictEqual(
    resolver.missingRequiredSettings(connectionSchema, {
      EntraTenantId: 'tenant-id-123',
      EntraClientId: 'client-id-123',
      EntraClientSecret: resolver.SECRET_MASK
    }, {
      storedSecrets: {
        EntraClientSecret: true
      },
      secretMask: resolver.SECRET_MASK
    }),
    [],
    'local connection save should accept an existing stored secret without requiring re-entry'
  );

  const newSecretSavePayload = resolver.buildSavePayload(connectionSchema, 'entra-id', {
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: 'new-client-secret'
  }, {
    sensitiveKeys: new Set(['EntraClientSecret']),
    secretMask: resolver.SECRET_MASK
  });
  assert.strictEqual(newSecretSavePayload.EntraClientSecret, 'new-client-secret', 'entering a new secret should replace the stored secret on save');

  const connectionSummary = resolver.getConnectionSummary({
    EntraTenantId: 'tenant-id-123',
    EntraClientId: 'client-id-123',
    EntraClientSecret: resolver.SECRET_MASK
  });
  assert.deepStrictEqual(
    connectionSummary,
    ['Connection settings are configured.', 'Tenant ID: tenant-id-123'],
    'configured summary should only expose the approved tenant-only copy'
  );

  assert.deepStrictEqual(
    resolver.missingRequiredSettings(connectionSchema, {
      EntraTenantId: 'tenant-id-123',
      EntraClientId: 'client-id-123',
      EntraClientSecret: ''
    }, {
      storedSecrets: {},
      secretMask: resolver.SECRET_MASK
    }),
    ['EntraClientSecret'],
    'explicitly cleared client secrets should fail connection validation'
  );

  assert.deepStrictEqual(
    resolver.missingRequiredSettings(attributeSchema, {
      EntraGroupsCustomAttributeName: '',
      EntraDeviceOwnershipCustomAttributeName: 'Entra Device Ownership'
    }),
    ['EntraGroupsCustomAttributeName'],
    'attribute-setting validation should stay separate from connection validation'
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
