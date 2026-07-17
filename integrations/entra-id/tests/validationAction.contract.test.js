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
  assert.strictEqual(typeof actions['validate-configuration'], 'function', 'validate-configuration should be exported for the shared Marketplace settings action contract');
  assert.strictEqual(typeof actions.sync, 'function', 'sync action should remain exported');
}

async function testMissingSettingsReturnsFieldSpecificFailureWithoutHttp() {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called when required Entra fields are missing');
  };

  try {
    const result = await require('../validate').validate({
      settings: createSettingsContext()
    }, {
      settings: {}
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.message, 'Missing required Microsoft Entra settings: EntraDirectoryId, EntraApplicationClientId, EntraClientSecret');
    assert.strictEqual(fetchCalls, 0, 'missing required settings should fail before any outbound HTTP');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testStoredSecretFallbackValidatesGraphConnection() {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET'
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(200, {
        access_token: 'graph-token',
        expires_in: 3600
      });
    }

    return jsonResponse(200, {
      value: [{ id: 'device-1' }]
    });
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
        _secretModes: {
          EntraClientSecret: 'stored'
        }
      }
    });

    assert.strictEqual(result.ok, true, 'stored-secret mode should support connection testing without re-entering the secret');
    assert.strictEqual(result.message, 'Microsoft Entra connection succeeded.');
    assert.strictEqual(
      requests.some((entry) => entry.url.startsWith('https://graph.microsoft.com/v1.0/devices?')),
      true,
      'connection validation should perform a minimal read-only Graph request'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testCollapsedStatePayloadWithoutSecretStillUsesStoredSecret() {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      body: String(options.body || '')
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(200, {
        access_token: 'graph-token',
        expires_in: 3600
      });
    }

    return jsonResponse(200, {
      value: [{ id: 'device-1' }]
    });
  };

  try {
    const result = await require('../validate').validate({
      settings: createSettingsContext({
        EntraTenantId: 'stored-tenant-id',
        EntraClientId: 'stored-client-id',
        EntraClientSecret: 'stored-client-secret-value'
      })
    }, {
      settings: {
        EntraTenantId: 'stored-tenant-id',
        EntraClientId: 'stored-client-id'
      }
    });

    assert.strictEqual(result.ok, true, 'collapsed-state validation should resolve the stored secret even when the request omits the secret field');
    const tokenRequest = requests.find((entry) => entry.url.includes('/oauth2/v2.0/token'));
    assert(tokenRequest, 'collapsed-state validation should reach token acquisition');
    assert.strictEqual(tokenRequest.body.includes('stored-client-secret-value'), true, 'collapsed-state validation should use the stored secret for Graph authentication');
    assert.strictEqual(tokenRequest.body.includes('***'), false, 'collapsed-state validation must never send the masked marker as a client secret');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testInvalidCredentialsReturnSafeFailure() {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(401, {
        error: 'invalid_client',
        error_description: 'AADSTS7000215: Invalid client secret is provided.'
      });
    }

    throw new Error('Graph request should not execute after token failure');
  };

  try {
    const result = await require('../validate').validate({
      settings: createSettingsContext()
    }, {
      settings: {
        EntraTenantId: 'tenant-id-123',
        EntraClientId: 'client-id-123',
        EntraClientSecret: 'bad-secret'
      }
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.message, 'Microsoft Entra connection failed: Invalid credentials.');
    assert.strictEqual(result.message.includes('bad-secret'), false, 'validation results must not leak secrets');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testInsufficientPermissionsReturnSafeFailure() {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(200, {
        access_token: 'graph-token',
        expires_in: 3600
      });
    }

    return jsonResponse(403, {
      error: {
        code: 'Authorization_RequestDenied',
        message: 'Insufficient privileges to complete the operation.'
      }
    });
  };

  try {
    const result = await require('../validate').validate({
      settings: createSettingsContext()
    }, {
      settings: {
        EntraTenantId: 'tenant-id-123',
        EntraClientId: 'client-id-123',
        EntraClientSecret: 'good-secret'
      }
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.message, 'Microsoft Entra connection failed: Insufficient Microsoft Graph permissions.');
  } finally {
    global.fetch = originalFetch;
  }
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

async function testUnsavedSecretOverridesStoredSecretForValidationOnly() {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      body: String(options.body || '')
    });

    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(200, {
        access_token: 'graph-token',
        expires_in: 3600
      });
    }

    return jsonResponse(200, {
      value: [{ id: 'device-1' }]
    });
  };

  try {
    const context = {
      settings: createSettingsContext({
        EntraClientSecret: 'stored-client-secret-value'
      })
    };

    const result = await require('../validate').validate(context, {
      settings: {
        EntraTenantId: 'tenant-id-123',
        EntraClientId: 'client-id-123',
        EntraClientSecret: 'unsaved-secret-value'
      }
    });

    assert.strictEqual(result.ok, true, 'unsaved entered secrets should validate successfully when correct');
    const tokenRequest = requests.find((entry) => entry.url.includes('/oauth2/v2.0/token'));
    assert(tokenRequest, 'unsaved-secret validation should reach token acquisition');
    assert.strictEqual(tokenRequest.body.includes('unsaved-secret-value'), true, 'unsaved entered secrets should override the stored secret for this validation request');
    assert.strictEqual(tokenRequest.body.includes('stored-client-secret-value'), false, 'unsaved entered secrets should not fall back to the stored secret during that validation request');
  } finally {
    global.fetch = originalFetch;
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    async text() {
      return JSON.stringify(body);
    }
  };
}

async function run() {
  await testValidateConfigurationActionExists();
  await testMissingSettingsReturnsFieldSpecificFailureWithoutHttp();
  await testStoredSecretFallbackValidatesGraphConnection();
  await testCollapsedStatePayloadWithoutSecretStillUsesStoredSecret();
  await testInvalidCredentialsReturnSafeFailure();
  await testInsufficientPermissionsReturnSafeFailure();
  await testLoadSettingsResolvesStoredSecretMode();
  await testUnsavedSecretOverridesStoredSecretForValidationOnly();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
