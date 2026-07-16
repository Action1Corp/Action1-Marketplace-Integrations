const assert = require('assert');

async function loadRuntimeConfigModule() {
  return require('../runtimeConfig');
}

async function run() {
  const {
    readRuntimeSettings,
    loadSyncRuntimeConfig,
    getSyncReadiness,
    scheduleKey,
    timezoneKey,
    parseSavedSchedule
  } = await loadRuntimeConfigModule();

  assert.strictEqual(typeof readRuntimeSettings, 'function', 'runtimeConfig should export readRuntimeSettings');
  assert.strictEqual(typeof loadSyncRuntimeConfig, 'function', 'runtimeConfig should export loadSyncRuntimeConfig');
  assert.strictEqual(typeof getSyncReadiness, 'function', 'runtimeConfig should export getSyncReadiness');
  assert.strictEqual(scheduleKey('entra-id'), 'CronSchedule_entra-id', 'runtimeConfig should align schedule key naming with Marketplace schedule settings');
  assert.strictEqual(timezoneKey('entra-id'), 'CronTimezone_entra-id', 'runtimeConfig should align timezone key naming with Marketplace schedule settings');

  const readyContext = {
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret',
          EntraGroupsCustomAttributeName: 'Test Attribute 1',
          EntraDeviceOwnershipCustomAttributeName: 'Test Attribute 2',
          [scheduleKey('entra-id')]: '0 */12 * * *',
          [timezoneKey('entra-id')]: 'UTC'
        };
      }
    },
    action1: {
      async getCredentials() {
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret'
        };
      }
    },
    db: {
      async all(sql) {
        assert(sql.includes('FROM entra_id_org_mappings'), 'runtimeConfig should source sync organizations from the mapping table');
        return [
          {
            id: 1,
            action1_org_id: 'org-1',
            action1_org_name: 'Org One'
          }
        ];
      }
    }
  };

  const runtimeConfig = await loadSyncRuntimeConfig(readyContext, { integrationId: 'entra-id' });
  assert.strictEqual(runtimeConfig.tenants.length, 1, 'runtimeConfig should assemble one Marketplace-owned tenant');
  assert.strictEqual(runtimeConfig.tenants[0].targets.length, 1, 'runtimeConfig should produce one target block');
  assert.deepStrictEqual(runtimeConfig.tenants[0].targets[0].organizationIds, ['org-1'], 'runtimeConfig should scope sync jobs to persisted Action1 organization mappings');
  assert.strictEqual(runtimeConfig.action1.clientId, 'action1-client-id', 'runtimeConfig should use Marketplace-owned shared Action1 credentials');
  assert.strictEqual(runtimeConfig.action1.clientSecret, 'action1-client-secret', 'runtimeConfig should preserve the Action1 secret for backend runtime use only');
  assert.deepStrictEqual(
    runtimeConfig.tenants[0].targets[0].mappings.map((row) => row.action1CustomAttribute),
    ['Test Attribute 1', 'Test Attribute 2'],
    'runtimeConfig should let saved custom attribute names override the canonical defaults at runtime'
  );
  assert.deepStrictEqual(
    runtimeConfig.attributeMappings,
    {
      groupMembership: {
        entraProperty: 'memberOf',
        action1CustomAttribute: 'Test Attribute 1',
        source: 'saved'
      },
      deviceOwnership: {
        entraProperty: 'deviceOwnership',
        action1CustomAttribute: 'Test Attribute 2',
        source: 'saved'
      }
    },
    'runtimeConfig should preserve the resolved attribute names and their saved/default sources for diagnostics'
  );

  const readyState = getSyncReadiness(runtimeConfig);
  assert.strictEqual(readyState.status, 'ready', 'runtimeConfig with full settings and mappings should be ready');
  assert.strictEqual(readyState.code, 'ready', 'runtimeConfig ready state should preserve a stable readiness code');

  const missingMappingState = getSyncReadiness({
    ...runtimeConfig,
    mappings: [],
    tenants: [
      {
        ...runtimeConfig.tenants[0],
        targets: []
      }
    ]
  });
  assert.strictEqual(missingMappingState.status, 'no_mappings', 'runtimeConfig without persisted mappings should block sync as no_mappings');
  assert.strictEqual(missingMappingState.code, 'missing_organization_mappings', 'runtimeConfig without persisted mappings should expose a mapping-specific readiness code');
  assert.strictEqual(missingMappingState.retryable, false, 'mapping readiness failures should remain non-retryable');

  const missingConfigState = getSyncReadiness({
    ...runtimeConfig,
    settings: {
      ...runtimeConfig.settings,
      EntraTenantId: '',
      EntraClientId: '',
      EntraClientSecret: ''
    },
    tenants: []
  });
  assert.strictEqual(missingConfigState.status, 'not_configured', 'runtimeConfig without tenant settings should block sync as not_configured');
  assert.strictEqual(missingConfigState.code, 'missing_entra_tenant_id', 'runtimeConfig without tenant settings should expose the first missing Entra field');
  assert.strictEqual(missingConfigState.retryable, false, 'configuration readiness failures should remain non-retryable');

  const parsedSchedule = parseSavedSchedule('0 */12 * * *');
  assert.strictEqual(parsedSchedule.enabled, true, 'saved 12-hour cron should parse as enabled');
  assert.strictEqual(parsedSchedule.intervalHours, '12', 'saved 12-hour cron should parse to the approved 12-hour interval');

  const secretFallbackContext = {
    settings: {
      async all(keys) {
        assert(Array.isArray(keys), 'runtimeConfig should request explicit schema-backed settings keys');
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraGroupsCustomAttributeName: 'Entra Groups',
          EntraDeviceOwnershipCustomAttributeName: 'Entra Device Ownership'
        };
      },
      async get(key) {
        if (key === 'EntraClientSecret') {
          return 'stored-secret';
        }
        return '';
      }
    }
  };

  const resolvedSettings = await readRuntimeSettings(secretFallbackContext);
  assert.strictEqual(resolvedSettings.EntraTenantId, 'tenant-1', 'runtimeConfig should preserve non-secret Entra settings loaded through all()');
  assert.strictEqual(resolvedSettings.EntraClientId, 'client-1', 'runtimeConfig should preserve the Entra client id loaded through all()');
  assert.strictEqual(resolvedSettings.EntraClientSecret, 'stored-secret', 'runtimeConfig should recover stored Entra client secrets through per-key get()');

  const runtimeConfigWithStoredSecret = await loadSyncRuntimeConfig({
    ...secretFallbackContext,
    action1: {
      async getCredentials() {
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret'
        };
      }
    },
    db: {
      async all() {
        return [
          {
            id: 1,
            action1_org_id: 'org-1',
            action1_org_name: 'Org One'
          }
        ];
      }
    }
  }, { integrationId: 'entra-id' });
  assert.strictEqual(runtimeConfigWithStoredSecret.tenants.length, 1, 'runtimeConfig should still assemble the Entra tenant when the saved secret is only available through get()');
  assert.strictEqual(getSyncReadiness(runtimeConfigWithStoredSecret).status, 'ready', 'runtimeConfig should treat a recovered stored secret as ready');

  const defaultFallbackRuntimeConfig = await loadSyncRuntimeConfig({
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret',
          EntraGroupsCustomAttributeName: '   ',
          EntraDeviceOwnershipCustomAttributeName: ''
        };
      }
    },
    action1: {
      async getCredentials() {
        return {
          apiKey: 'action1-client-id',
          apiSecret: 'action1-client-secret'
        };
      }
    },
    db: {
      async all() {
        return [
          {
            id: 1,
            action1_org_id: 'org-1',
            action1_org_name: 'Org One'
          }
        ];
      }
    }
  }, { integrationId: 'entra-id' });
  assert.deepStrictEqual(
    defaultFallbackRuntimeConfig.tenants[0].targets[0].mappings.map((row) => row.action1CustomAttribute),
    ['Entra Groups', 'Entra Device Ownership'],
    'runtimeConfig should fall back to canonical default custom attribute names when saved values are blank'
  );
  assert.deepStrictEqual(
    defaultFallbackRuntimeConfig.attributeMappings,
    {
      groupMembership: {
        entraProperty: 'memberOf',
        action1CustomAttribute: 'Entra Groups',
        source: 'default'
      },
      deviceOwnership: {
        entraProperty: 'deviceOwnership',
        action1CustomAttribute: 'Entra Device Ownership',
        source: 'default'
      }
    },
    'runtimeConfig should record default attribute sources when persisted values are blank'
  );

  const missingClientSecretState = getSyncReadiness({
    ...runtimeConfig,
    settings: {
      ...runtimeConfig.settings,
      EntraClientSecret: ''
    },
    tenants: [
      {
        ...runtimeConfig.tenants[0],
        clientSecret: ''
      }
    ]
  });
  assert.strictEqual(missingClientSecretState.status, 'not_configured', 'runtimeConfig without an Entra client secret should remain not_configured');
  assert.strictEqual(missingClientSecretState.code, 'missing_entra_client_secret', 'runtimeConfig should identify a missing Entra client secret explicitly');
  assert.strictEqual(missingClientSecretState.message.includes('Action1'), false, 'missing Entra client secret messages should stay Entra-specific');

  const missingAction1CredsState = getSyncReadiness({
    ...runtimeConfig,
    action1: {
      clientId: '',
      clientSecret: ''
    }
  });
  assert.strictEqual(missingAction1CredsState.status, 'not_configured', 'runtimeConfig without Action1 credentials should remain not_configured');
  assert.strictEqual(missingAction1CredsState.code, 'missing_action1_credentials', 'runtimeConfig should identify missing Action1 credentials explicitly');
  assert.strictEqual(missingAction1CredsState.message.includes('Entra configuration'), false, 'missing Action1 credentials should not produce an Entra configuration message');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
