const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

async function loadFreshActionsModule() {
  const actionsPath = require.resolve('../actions');
  delete require.cache[actionsPath];
  return require('../actions').actions;
}

async function run() {
  const manifest = require('../manifest.json');
  const syncAction = manifest.actions.find((action) => action.id === 'sync');

  assert(syncAction, 'manifest.json should declare the tracked sync action');
  assert.strictEqual(syncAction.kind, 'sync', 'sync action should use Marketplace kind=sync');
  assert.strictEqual(syncAction.history, true, 'sync action should remain tracked in Marketplace History');
  assert.strictEqual(syncAction.placement, 'dashboard', 'sync action should belong to the Sync/dashboard surface');

  const actions = await loadFreshActionsModule();
  assert.strictEqual(typeof actions.sync, 'function', 'actions.js should export the sync handler');

  const hostLogDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-sync-log-'));
  const originalEntraLogDir = process.env.ENTRA_ID_LOG_DIR;
  delete process.env.DATA_DIR;
  process.env.ENTRA_ID_LOG_DIR = hostLogDir;

  const runLogs = [];
  let assetsProcessed = null;
  const hostInfoLogs = [];
  const result = await actions.sync({
    _entraSyncRunner: async (runtimeConfig, logger) => {
      assert.strictEqual(runtimeConfig.tenants.length, 1, 'sync handler should pass the assembled runtime config to the execution seam');
      logger.info('Detailed hidden trace.', { secret: 'hidden-value' });
      return {
        dryRun: false,
        jobs: 1,
        totalPlannedPatches: 3,
        totalAppliedPatches: 2,
        results: [
          {
            tenantName: 'Tenant One',
            organizationId: 'org-1',
            entraDevices: 5,
            action1Endpoints: 4,
            matched: 3,
            unmatchedEntra: 1,
            ambiguous: 1,
            ambiguousEndpointReuse: 0,
            patchesPlanned: 3,
            patchesToProcess: 3,
            patchesApplied: 2,
            patchErrors: [{ endpointId: 'ep-2', error: 'PATCH failed' }]
          }
        ]
      };
    },
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret',
          EntraGroupsCustomAttributeName: 'Test Attribute 1',
          EntraDeviceOwnershipCustomAttributeName: 'Test Attribute 2'
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
    },
    logger: {
      info(message) {
        hostInfoLogs.push(String(message));
      },
      warn() {},
      error() {},
      debug() {}
    }
  }, {
    payload: {
      trigger: 'manual'
    },
    run: {
      async appendLog(message) {
        runLogs.push(String(message));
      },
      async setAssetsProcessed(value) {
        assetsProcessed = value;
      }
    }
  });

  assert.strictEqual(typeof result.ok, 'boolean', 'sync handler should return a Marketplace action result');
  assert.strictEqual(typeof result.summary, 'object', 'sync handler should return a structured summary');
  assert.strictEqual(Array.isArray(runLogs), true, 'sync handler should write operator-safe Marketplace run logs');
  assert(runLogs.some((line) => line.includes('Sync started.')), 'sync handler should write the sync start checkpoint to request.run');
  assert(runLogs.some((line) => line.includes('runtime configuration loaded')), 'sync handler should log runtime configuration readiness');
  assert(runLogs.some((line) => line.includes('Runtime attribute mappings selected.')), 'sync handler should log the selected custom attribute keys for operator diagnostics');
  assert(runLogs.some((line) => line.includes('Test Attribute 1')), 'sync handler should identify the saved group-membership custom attribute key selected for the run');
  assert(runLogs.some((line) => line.includes('Test Attribute 2')), 'sync handler should identify the saved device-ownership custom attribute key selected for the run');
  assert(runLogs.some((line) => line.includes('"groupMembershipSource":"saved"')), 'sync handler should preserve whether the group-membership custom attribute came from saved settings');
  assert(runLogs.some((line) => line.includes('"deviceOwnershipSource":"saved"')), 'sync handler should preserve whether the device-ownership custom attribute came from saved settings');
  assert.strictEqual(runLogs.some((line) => line.includes('Detailed hidden trace.')), false, 'detailed diagnostics should stay out of request.run by default');
  assert.strictEqual(Number.isFinite(Number(assetsProcessed)), true, 'sync handler should report processed assets through request.run');
  assert.strictEqual(runLogs.some((line) => line.includes('client-secret')), false, 'request.run logs should not leak Entra secrets');
  assert.strictEqual(runLogs.some((line) => line.includes('action1-client-secret')), false, 'request.run logs should not leak Action1 secrets');
  assert.strictEqual(result.ok, true, 'completed syncs with isolated endpoint-level patch errors should still return ok=true');
  assert.strictEqual(result.summary.finalStatus, 'CompletedWithIssues', 'completed syncs with isolated endpoint-level patch errors should report CompletedWithIssues');
  assert.strictEqual(result.summary.trigger, 'manual', 'sync handler should preserve a manual trigger marker in the final summary');
  assert.strictEqual(hostInfoLogs.filter((line) => line.includes('[Integration:entra-id] Runtime log file:')).length, 1, 'sync handler should announce the resolved runtime log file once');
  const liveLogPath = path.join(hostLogDir, 'entra-id-runtime.log');
  assert.strictEqual(fs.existsSync(liveLogPath), true, 'sync handler should create the Entra runtime log file during normal execution');
  const liveLogText = await fsp.readFile(liveLogPath, 'utf8');
  assert.strictEqual(liveLogText.includes('Sync started.'), true, 'sync handler should mirror normal runtime lines into the runtime log file');
  assert.strictEqual(liveLogText.includes('Detailed hidden trace.'), true, 'sync handler should mirror ordinary Entra runtime logger lines into the runtime log file');
  assert.strictEqual(liveLogText.includes('hidden-value'), false, 'sync handler runtime file logs should redact secret-bearing values');

  const scheduledResult = await actions.sync({
    _entraSyncRunner: async () => ({ results: [] }),
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
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
  }, {
    payload: {
      trigger: 'scheduled'
    }
  });

  assert.strictEqual(scheduledResult.summary.trigger, 'scheduled', 'sync handler should preserve the scheduled trigger for shared action parity');
  assert.strictEqual(scheduledResult.summary.finalStatus, 'Success', 'completed syncs without endpoint failures should report Success');

  const readinessLogs = [];
  const readinessResult = await actions.sync({
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
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
        return [];
      }
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {}
    }
  }, {
    run: {
      async appendLog(message) {
        readinessLogs.push(String(message));
      }
    }
  });

  assert.strictEqual(readinessResult.ok, false, 'readiness failures should keep Marketplace ok=false semantics');
  assert.strictEqual(readinessResult.diagnostics.stage, 'readiness', 'readiness failures should preserve the readiness stage');
  assert.strictEqual(readinessResult.diagnostics.code, 'missing_organization_mappings', 'readiness failures should preserve the exact readiness code');
  assert.strictEqual(readinessResult.diagnostics.service, 'marketplace_runtime', 'readiness failures should identify the Marketplace runtime boundary');
  assert.strictEqual(readinessResult.diagnostics.httpStatus, null, 'readiness failures should not invent an HTTP status');
  assert.strictEqual(Array.isArray(readinessResult.diagnostics.checkpoints), true, 'readiness failures should include checkpoint context');
  assert.strictEqual(readinessResult.diagnostics.checkpoints.some((row) => row.stage === 'readiness' && row.outcome === 'blocked'), true, 'readiness failures should report a blocked readiness checkpoint');
  assert.strictEqual(readinessLogs.some((line) => line.includes('stage=readiness outcome=blocked')), true, 'request.run logs should include the blocked readiness checkpoint');

  let reachedSyncBoundary = false;
  const storedSecretReadyResult = await actions.sync({
    _entraSyncRunner: async (runtimeConfig) => {
      reachedSyncBoundary = true;
      assert.strictEqual(runtimeConfig.tenants[0].clientSecret, 'stored-secret', 'sync handler should pass the recovered stored secret to the sync engine boundary');
      return { results: [] };
    },
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1'
        };
      },
      async get(key) {
        if (key === 'EntraClientSecret') {
          return 'stored-secret';
        }
        return '';
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
  }, {});

  assert.strictEqual(storedSecretReadyResult.ok, true, 'sync handler should proceed when the saved Entra secret is recoverable through settings.get()');
  assert.strictEqual(reachedSyncBoundary, true, 'successful readiness should reach the existing sync engine boundary');

  const completedWithIssuesResult = await actions.sync({
    _entraSyncRunner: async () => ({
      dryRun: false,
      jobs: 1,
      totalPlannedPatches: 1,
      totalAppliedPatches: 0,
      results: [
        {
          tenantName: 'Tenant One',
          organizationId: 'org-1',
          entraDevices: 3,
          action1Endpoints: 3,
          matched: 1,
          unmatchedEntra: 2,
          ambiguous: 0,
          ambiguousEndpointReuse: 0,
          patchesPlanned: 1,
          patchesToProcess: 1,
          patchesApplied: 0,
          patchErrors: [{ endpointId: 'ep-1', error: 'PATCH failed' }]
        }
      ]
    }),
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
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
  }, {
    payload: {
      trigger: 'manual'
    }
  });

  assert.strictEqual(completedWithIssuesResult.ok, true, 'completed syncs with zero successful patches but isolated endpoint errors should still return ok=true');
  assert.strictEqual(completedWithIssuesResult.summary.finalStatus, 'CompletedWithIssues', 'completed syncs with zero successful patches but isolated endpoint errors should report CompletedWithIssues');
  assert.strictEqual(completedWithIssuesResult.summary.failedEndpointUpdates, 1, 'completed syncs with isolated endpoint errors should preserve the failed endpoint count');
  assert.strictEqual(completedWithIssuesResult.summary.endpointsSynchronized, 0, 'completed syncs with isolated endpoint errors should preserve zero synchronized endpoints');

  const missingAction1Logs = [];
  const missingAction1Result = await actions.sync({
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
        };
      }
    },
    action1: {
      async getCredentials() {
        return {
          apiKey: '',
          apiSecret: ''
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
  }, {
    run: {
      async appendLog(message) {
        missingAction1Logs.push(String(message));
      }
    }
  });

  assert.strictEqual(missingAction1Result.ok, false, 'sync handler should block when shared Action1 credentials are missing');
  assert.strictEqual(missingAction1Result.diagnostics.stage, 'readiness', 'missing Action1 credentials should remain a readiness failure');
  assert.strictEqual(missingAction1Result.diagnostics.code, 'missing_action1_credentials', 'missing Action1 credentials should preserve a distinct readiness code');
  assert.strictEqual(missingAction1Result.diagnostics.retryable, false, 'missing Action1 credentials should remain non-retryable');
  assert.strictEqual(missingAction1Result.message.includes('Entra configuration'), false, 'missing Action1 credentials should not reuse the Entra configuration message');
  assert.strictEqual(missingAction1Logs.some((line) => line.includes('missing_action1_credentials')), true, 'readiness logs should preserve the exact missing Action1 credentials code');

  const failureRunLogs = [];
  const hostErrorLogs = [];
  const failureHostInfoLogs = [];
  const failureResult = await actions.sync({
    _entraSyncRunner: async () => {
      const error = new Error('HTTP 401 from Microsoft Graph with bearer super-secret-token');
      error.stage = 'graph_authentication';
      error.operation = 'graph_token_request';
      error.code = 'ENTRA_HTTP_ERROR';
      error.status = 401;
      error.retryable = false;
      error.service = 'microsoft_graph';
      error.url = 'https://login.microsoftonline.com/example/oauth2/v2.0/token';
      throw error;
    },
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
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
    },
    logger: {
      info(message) {
        failureHostInfoLogs.push(String(message));
      },
      warn() {},
      error(message) {
        hostErrorLogs.push(String(message));
      },
      debug() {}
    }
  }, {
    run: {
      id: 'run-123',
      async appendLog(message) {
        failureRunLogs.push(String(message));
      }
    }
  });

  assert.strictEqual(failureResult.ok, false, 'sync failures should keep Marketplace ok=false semantics');
  assert.strictEqual(failureResult.summary.finalStatus, 'Failure', 'sync failures should preserve the failed summary status');
  assert.strictEqual(failureResult.diagnostics.stage, 'graph_authentication', 'Graph failures should preserve the graph authentication stage');
  assert.strictEqual(failureResult.diagnostics.operation, 'graph_token_request', 'sync failures should preserve the failing operation');
  assert.strictEqual(failureResult.diagnostics.code, 'ENTRA_HTTP_ERROR', 'sync failures should preserve the stable error code');
  assert.strictEqual(failureResult.diagnostics.httpStatus, 401, 'sync failures should preserve the HTTP status');
  assert.strictEqual(failureResult.diagnostics.retryable, false, 'sync failures should preserve retryability when the integration owns it');
  assert.strictEqual(failureResult.diagnostics.service, 'microsoft_graph', 'sync failures should identify the failing service');
  assert.strictEqual(failureResult.diagnostics.requestTarget.includes('/oauth2/v2.0/token'), true, 'sync failures should preserve a safe request target');
  assert.strictEqual(failureResult.diagnostics.runId, 'run-123', 'sync failures should preserve the Marketplace run id when available');
  assert.strictEqual(typeof failureResult.details, 'string', 'sync failures should return structured details');
  assert.strictEqual(failureResult.details.includes('"graph_authentication"'), true, 'failure details should retain the failure stage');
  assert.strictEqual(failureResult.details.includes('super-secret-token'), false, 'failure details should not leak secrets');
  assert.strictEqual(failureResult.message.includes('super-secret-token'), false, 'customer-safe failure messages should not leak secrets');
  assert.strictEqual(failureRunLogs.some((line) => line.includes('stage=graph_authentication outcome=failed')), true, 'request.run logs should include the failed graph stage');
  assert.strictEqual(hostErrorLogs.some((line) => line.includes('graph_authentication')), true, 'host logs should include the failing stage');
  assert.strictEqual(hostErrorLogs.some((line) => line.includes('super-secret-token')), false, 'host logs should not leak secrets');
  assert.strictEqual(failureHostInfoLogs.some((line) => line.includes('runtime configuration loaded')), true, 'successful checkpoints before the failure should still be logged');

  const action1Failure = await actions.sync({
    _entraSyncRunner: async () => {
      const error = new Error('[Action1] HTTP 503 Service Unavailable GET https://app.action1.com/api/3.0/organizations');
      error.code = 'ACTION1_HTTP_ERROR';
      error.status = 503;
      error.url = 'https://app.action1.com/api/3.0/organizations';
      throw error;
    },
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
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
  }, {});

  assert.strictEqual(action1Failure.diagnostics.stage, 'action1_endpoint_collection', 'Action1 fetch failures should identify the Action1 collection stage');
  assert.strictEqual(action1Failure.diagnostics.httpStatus, 503, 'Action1 fetch failures should preserve the HTTP status');
  assert.strictEqual(action1Failure.diagnostics.retryable, true, 'retryable Action1 failures should preserve retryability');
  assert.strictEqual(action1Failure.diagnostics.service, 'action1_api', 'Action1 fetch failures should identify the Action1 service');

  const endpointUpdateFailure = await actions.sync({
    _entraSyncRunner: async () => {
      const error = new Error('[Action1] HTTP 400 Bad Request PATCH https://app.action1.com/api/3.0/endpoints/managed/org-1/endpoint-1');
      error.operation = 'managed_endpoint_patch';
      error.code = 'ACTION1_PATCH_FAILED';
      error.status = 400;
      error.url = 'https://app.action1.com/api/3.0/endpoints/managed/org-1/endpoint-1';
      throw error;
    },
    settings: {
      async all() {
        return {
          EntraTenantId: 'tenant-1',
          EntraClientId: 'client-1',
          EntraClientSecret: 'client-secret'
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
  }, {});

  assert.strictEqual(endpointUpdateFailure.diagnostics.stage, 'endpoint_update', 'PATCH failures should identify the endpoint update stage');
  assert.strictEqual(endpointUpdateFailure.diagnostics.httpStatus, 400, 'PATCH failures should preserve the HTTP status');
  assert.strictEqual(endpointUpdateFailure.diagnostics.retryable, false, 'non-retryable PATCH failures should preserve retryability');
  assert.strictEqual(endpointUpdateFailure.diagnostics.service, 'action1_api', 'PATCH failures should identify the Action1 service');

  if (originalEntraLogDir === undefined) {
    delete process.env.ENTRA_ID_LOG_DIR;
  } else {
    process.env.ENTRA_ID_LOG_DIR = originalEntraLogDir;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
