const assert = require('assert');

async function loadFreshActionsModule() {
  const actionsPath = require.resolve('../actions');
  const validatePath = require.resolve('../validate');
  delete require.cache[actionsPath];
  delete require.cache[validatePath];
  return require('../actions').actions;
}

function createSettingsContext(stored = {}) {
  return {
    values: { ...stored },
    async get(key) {
      return this.values[key] || '';
    }
  };
}

async function testValidateConfigurationActionExists() {
  const actions = await loadFreshActionsModule();
  assert.strictEqual(Object.prototype.hasOwnProperty.call(actions, 'validate-configuration'), false, 'validate-configuration should not remain exported in this local-save-only slice');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(actions, 'check-configuration'), false, 'legacy placeholder settings validation actions should not remain exported in this local-save-only slice');
  assert.strictEqual(typeof actions['list-entra-org-mappings'], 'function', 'mapping list handler should be exported once the mapping slice lands');
  assert.strictEqual(typeof actions['save-entra-org-mapping'], 'function', 'mapping save handler should be exported once the mapping slice lands');
  assert.strictEqual(typeof actions['delete-entra-org-mapping'], 'function', 'mapping delete handler should be exported once the mapping slice lands');
  assert.strictEqual(typeof actions['discover-action1-mapping-options'], 'function', 'Action1 mapping discovery handler should be exported once the mapping slice lands');
}

async function testMissingSettingsReturnsFailureWithoutHttp() {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called during lightweight settings validation');
  };

  try {
    const result = await require('../validate').validate({
      settings: createSettingsContext()
    }, {
      settings: {}
    });

    assert.strictEqual(result.ok, false, 'missing settings should fail validation');
    assert.strictEqual(
      result.message,
      'Missing required Microsoft Entra settings: EntraTenantId, EntraClientId, EntraClientSecret'
    );
    assert.strictEqual(fetchCalls, 0, 'lightweight validation should not trigger HTTP calls');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testStoredSecretFallbackPassesValidation() {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called during lightweight settings validation');
  };

  try {
    const result = await require('../validate').validate({
      settings: createSettingsContext({
        EntraClientSecret: 'stored-client-secret-value'
      })
    }, {
      settings: {
        EntraTenantId: 'tenant-id-123',
        EntraClientId: 'client-id-123',
        EntraGroupsCustomAttributeName: 'Entra Groups',
        EntraDeviceOwnershipCustomAttributeName: 'Entra Device Ownership',
        _secretModes: {
          EntraClientSecret: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'stored secret fallback should satisfy lightweight validation');
    assert.strictEqual(result.message, 'Configuration values are present.');
    assert.strictEqual(fetchCalls, 0, 'successful lightweight validation should not call external HTTP');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testBlankCustomAttributeNameFailsSafely() {
  const result = await require('../validate').validate({
    settings: createSettingsContext({
      EntraClientSecret: 'stored-client-secret-value'
    })
  }, {
    settings: {
      EntraTenantId: 'tenant-id-123',
      EntraClientId: 'client-id-123',
      EntraGroupsCustomAttributeName: '',
      EntraDeviceOwnershipCustomAttributeName: 'Entra Device Ownership',
      _secretModes: {
        EntraClientSecret: 'stored'
      }
    }
  });

  assert.strictEqual(result.ok, true, 'blank custom attribute names should not fail connection-only validation');
  assert.strictEqual(result.message, 'Configuration values are present.');
}

async function testExplicitlyClearedSecretFailsSafely() {
  const result = await require('../validate').validate({
    settings: createSettingsContext({
      EntraClientSecret: 'stored-client-secret-value'
    })
  }, {
    settings: {
      EntraTenantId: 'tenant-id-123',
      EntraClientId: 'client-id-123',
      EntraClientSecret: '',
      EntraGroupsCustomAttributeName: '',
      EntraDeviceOwnershipCustomAttributeName: '',
      _secretModes: {}
    }
  });

  assert.strictEqual(result.ok, false, 'explicitly cleared client secrets should fail connection-only validation');
  assert.strictEqual(
    result.message,
    'Missing required Microsoft Entra settings: EntraClientSecret'
  );
  assert(!result.message.includes('stored-client-secret-value'), 'validation message must not leak secret values');
}

async function testLoadSettingsResolvesStoredSecretMode() {
  const validatePath = require.resolve('../validate');
  delete require.cache[validatePath];
  const { loadSettings } = require('../validate');

  const settings = await loadSettings({
    settings: createSettingsContext({
      EntraClientSecret: 'stored-client-secret-value'
    })
  }, {
    settings: {
      EntraTenantId: 'tenant-id-123',
      EntraClientId: 'client-id-123',
      _secretModes: {
        EntraClientSecret: 'stored'
      }
    }
  });

  assert.strictEqual(settings.EntraClientSecret, 'stored-client-secret-value', 'backend validation should resolve stored-secret mode through context.settings.get');
}

async function run() {
  await testValidateConfigurationActionExists();
  await testMissingSettingsReturnsFailureWithoutHttp();
  await testStoredSecretFallbackPassesValidation();
  await testBlankCustomAttributeNameFailsSafely();
  await testExplicitlyClearedSecretFailsSafely();
  await testLoadSettingsResolvesStoredSecretMode();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
