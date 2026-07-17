const path = require('path');
const { pathToFileURL } = require('url');

const {
  getSyncReadiness,
  loadSyncRuntimeConfig
} = require('./runtimeConfig');
const {
  LOG_LEVELS,
  createMarketplaceRunLogger,
  sanitizeText,
  sanitizeValue
} = require('./runtimeLogging');

const DIAGNOSTIC_STAGES = Object.freeze({
  RUNTIME_CONFIG: 'runtime_config',
  READINESS: 'readiness',
  ORGANIZATION_MAPPINGS: 'organization_mappings',
  GRAPH_AUTHENTICATION: 'graph_authentication',
  GRAPH_DEVICE_COLLECTION: 'graph_device_collection',
  ACTION1_ENDPOINT_COLLECTION: 'action1_endpoint_collection',
  DEVICE_MATCHING: 'device_matching',
  ENDPOINT_UPDATE: 'endpoint_update',
  RESULT_AGGREGATION: 'result_aggregation',
  HISTORY_PERSISTENCE: 'history_persistence'
});

function sumBy(results, key) {
  return (Array.isArray(results) ? results : []).reduce((total, row) => total + Number(row?.[key] || 0), 0);
}

function summarizeSyncResult(result = {}, runtimeConfig = {}) {
  const results = Array.isArray(result.results) ? result.results : [];
  const failedOrganizations = results.filter((row) => row?.error).length;
  const patchErrors = results.reduce((total, row) => total + (Array.isArray(row?.patchErrors) ? row.patchErrors.length : 0), 0);
  const unmatched = sumBy(results, 'unmatchedEntra');
  const ambiguous = sumBy(results, 'ambiguous');
  const ambiguousReuse = sumBy(results, 'ambiguousEndpointReuse');

  const summary = {
    mappedAction1OrganizationsProcessed: results.length,
    failedOrganizations,
    entraDevicesEvaluated: sumBy(results, 'entraDevices'),
    action1EndpointsEvaluated: sumBy(results, 'action1Endpoints'),
    endpointsSynchronized: sumBy(results, 'patchesApplied'),
    skipped: unmatched + ambiguous + ambiguousReuse,
    failedEndpointUpdates: patchErrors,
    trigger: 'manual',
    finalStatus: failedOrganizations > 0 || patchErrors > 0 ? 'CompletedWithIssues' : 'Success',
    schedulerEnabled: Boolean(runtimeConfig?.scheduler?.enabled)
  };

  return summary;
}

async function executeCoreSync(runtimeConfig, logger) {
  const moduleUrl = pathToFileURL(path.join(__dirname, 'core', 'sync', 'syncEngine.mjs')).href;
  const module = await import(moduleUrl);
  return module.runSync(runtimeConfig, logger, { dryRun: false });
}

function sanitizeMessage(value) {
  return sanitizeText(String(value || '').trim()) || 'Sync failed.';
}

function truncateText(value, maxLength = 240) {
  const text = sanitizeMessage(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function safeStage(value, fallback = DIAGNOSTIC_STAGES.RESULT_AGGREGATION) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.values(DIAGNOSTIC_STAGES).includes(normalized) ? normalized : fallback;
}

function safeCode(value, fallback = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  return /^[A-Za-z0-9_./:-]+$/.test(normalized) ? normalized : fallback;
}

function safeOperation(value, fallback = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  return /^[A-Za-z0-9_./:-]+$/.test(normalized) ? normalized : fallback;
}

function safeService(value, fallback = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return /^[a-z0-9_:-]+$/.test(normalized) ? normalized : fallback;
}

function safeHttpStatus(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function safeRequestTarget(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  try {
    const parsed = new URL(text);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return sanitizeText(text.replace(/\?.*$/, ''));
  }
}

function extractRequestTarget(error) {
  return safeRequestTarget(error?.requestTarget || error?.url || error?.target || '');
}

function inferStageFromError(error, fallbackStage) {
  if (error?.stage) {
    return safeStage(error.stage, fallbackStage);
  }

  const requestTarget = extractRequestTarget(error).toLowerCase();
  const operation = safeOperation(error?.operation || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (requestTarget.includes('login.microsoftonline.com') || operation.includes('graph_token')) {
    return DIAGNOSTIC_STAGES.GRAPH_AUTHENTICATION;
  }
  if (requestTarget.includes('graph.microsoft.com')) {
    return DIAGNOSTIC_STAGES.GRAPH_DEVICE_COLLECTION;
  }
  if (requestTarget.includes('/oauth2/token') || requestTarget.includes('/organizations') || requestTarget.includes('/endpoints/managed')) {
    if (operation.includes('patch') || message.includes('patch')) {
      return DIAGNOSTIC_STAGES.ENDPOINT_UPDATE;
    }
    return DIAGNOSTIC_STAGES.ACTION1_ENDPOINT_COLLECTION;
  }
  if (operation.includes('match')) {
    return DIAGNOSTIC_STAGES.DEVICE_MATCHING;
  }
  if (operation.includes('mapping')) {
    return DIAGNOSTIC_STAGES.ORGANIZATION_MAPPINGS;
  }
  return safeStage(fallbackStage, DIAGNOSTIC_STAGES.RESULT_AGGREGATION);
}

function inferServiceFromError(error, stage) {
  if (error?.service) {
    return safeService(error.service, 'integration_runtime');
  }

  if (stage === DIAGNOSTIC_STAGES.GRAPH_AUTHENTICATION || stage === DIAGNOSTIC_STAGES.GRAPH_DEVICE_COLLECTION) {
    return 'microsoft_graph';
  }
  if (stage === DIAGNOSTIC_STAGES.ACTION1_ENDPOINT_COLLECTION || stage === DIAGNOSTIC_STAGES.ENDPOINT_UPDATE) {
    return 'action1_api';
  }
  if (stage === DIAGNOSTIC_STAGES.READINESS || stage === DIAGNOSTIC_STAGES.RUNTIME_CONFIG || stage === DIAGNOSTIC_STAGES.HISTORY_PERSISTENCE) {
    return 'marketplace_runtime';
  }
  return 'integration_runtime';
}

function inferRetryable(error) {
  if (typeof error?.retryable === 'boolean') {
    return error.retryable;
  }

  const status = safeHttpStatus(error?.status);
  if (status === 429) {
    return true;
  }
  if (status !== null && status >= 400 && status < 500) {
    return false;
  }
  if (status !== null && status >= 500) {
    return true;
  }

  const code = safeCode(error?.code || '').toUpperCase();
  if (code.includes('TRANSPORT') || code.includes('TIMEOUT') || code.includes('RATE')) {
    return true;
  }

  return null;
}

function buildCheckpoint(stage, outcome, context = {}) {
  return {
    stage: safeStage(stage, DIAGNOSTIC_STAGES.RESULT_AGGREGATION),
    outcome: safeOperation(outcome, 'observed'),
    at: new Date().toISOString(),
    context: sanitizeValue(context)
  };
}

async function logCheckpoint(runLogger, checkpoints, input = {}) {
  const checkpoint = buildCheckpoint(input.stage, input.outcome, input.context);
  checkpoints.push(checkpoint);
  const level = checkpoint.outcome === 'failed' || checkpoint.outcome === 'blocked'
    ? LOG_LEVELS.WARN
    : LOG_LEVELS.INFO;
  await runLogger.emit({
    runId: String(input.runId || 'entra-sync'),
    level,
    eventType: input.eventType,
    message: `Checkpoint stage=${checkpoint.stage} outcome=${checkpoint.outcome}`,
    context: checkpoint.context
  });
  return checkpoint;
}

function buildReadinessDiagnostics(readiness, runId, checkpoints) {
  return {
    stage: DIAGNOSTIC_STAGES.READINESS,
    operation: 'sync_readiness_check',
    errorName: 'ReadinessBlocked',
    message: sanitizeMessage(readiness?.message || 'Sync is not ready.'),
    code: safeCode(readiness?.code || readiness?.status || 'readiness_blocked', 'readiness_blocked'),
    httpStatus: null,
    retryable: false,
    service: 'marketplace_runtime',
    requestTarget: '',
    runId: runId || '',
    mappingCount: Number(readiness?.mappingCount || 0),
    presence: sanitizeValue(readiness?.presence || {}),
    checkpoints: checkpoints.map((row) => ({
      stage: row.stage,
      outcome: row.outcome,
      at: row.at
    }))
  };
}

function buildFailureDiagnostics(error, input = {}) {
  const stage = inferStageFromError(error, input.fallbackStage);
  const message = truncateText(error?.safeMessage || error?.message || 'Sync failed.');

  return {
    stage,
    operation: safeOperation(error?.operation || input.operation || '', 'sync_execution'),
    errorName: safeOperation(error?.name || 'Error', 'Error'),
    message,
    code: safeCode(error?.code || input.code || '', 'sync_failed'),
    httpStatus: safeHttpStatus(error?.status),
    retryable: inferRetryable(error),
    service: inferServiceFromError(error, stage),
    requestTarget: extractRequestTarget(error),
    runId: String(input.runId || ''),
    checkpoints: (Array.isArray(input.checkpoints) ? input.checkpoints : []).map((row) => ({
      stage: row.stage,
      outcome: row.outcome,
      at: row.at
    }))
  };
}

function safeDetailsString(payload) {
  return JSON.stringify(sanitizeValue(payload));
}

async function runEntraSync(context, request = {}) {
  const run = request.run || null;
  const requestedTrigger = request?.trigger ?? request?.payload?.trigger ?? 'manual';
  const trigger = String(requestedTrigger).trim().toLowerCase() === 'scheduled'
    ? 'scheduled'
    : 'manual';
  const runId = String(run?.id || '');
  const loggerOptions =
    context?._entraRuntimeLoggerOptions && typeof context._entraRuntimeLoggerOptions === 'object'
      ? context._entraRuntimeLoggerOptions
      : {};
  const runLogger = createMarketplaceRunLogger({
    ...loggerOptions,
    run,
    context,
    integrationId: 'entra-id'
  });
  const detailedLogger = createMarketplaceRunLogger({
    ...loggerOptions,
    context,
    integrationId: 'entra-id'
  });
  const checkpoints = [];
  const runner = typeof context?._entraSyncRunner === 'function' ? context._entraSyncRunner : executeCoreSync;
  let runtimeConfig = null;

  try {
    await runLogger.info('Sync started.', {
      trigger
    });
    await logCheckpoint(runLogger, checkpoints, {
      runId,
      stage: DIAGNOSTIC_STAGES.RUNTIME_CONFIG,
      outcome: 'started',
      context: {
        trigger
      }
    });

    runtimeConfig = await loadSyncRuntimeConfig(context, { integrationId: 'entra-id' });
    await logCheckpoint(runLogger, checkpoints, {
      runId,
      stage: DIAGNOSTIC_STAGES.RUNTIME_CONFIG,
      outcome: 'completed',
      context: {
        schedulerEnabled: Boolean(runtimeConfig?.scheduler?.enabled)
      }
    });

    await runLogger.info('Sync runtime configuration loaded.', {
      mappedOrganizations: Array.isArray(runtimeConfig?.mappings) ? runtimeConfig.mappings.length : 0
    });
    await runLogger.info('Runtime attribute mappings selected.', {
      groupMembershipAttribute: runtimeConfig?.attributeMappings?.groupMembership?.action1CustomAttribute || '',
      groupMembershipSource: runtimeConfig?.attributeMappings?.groupMembership?.source || 'default',
      deviceOwnershipAttribute: runtimeConfig?.attributeMappings?.deviceOwnership?.action1CustomAttribute || '',
      deviceOwnershipSource: runtimeConfig?.attributeMappings?.deviceOwnership?.source || 'default'
    });
    await logCheckpoint(runLogger, checkpoints, {
      runId,
      stage: DIAGNOSTIC_STAGES.ORGANIZATION_MAPPINGS,
      outcome: 'loaded',
      context: {
        count: Array.isArray(runtimeConfig?.mappings) ? runtimeConfig.mappings.length : 0
      }
    });

    const readiness = getSyncReadiness(runtimeConfig, { activeRun: false });
    if (readiness.status !== 'ready') {
      await logCheckpoint(runLogger, checkpoints, {
        runId,
        stage: DIAGNOSTIC_STAGES.READINESS,
        outcome: 'blocked',
        context: {
          status: readiness.status,
          code: readiness.code || '',
          mappingCount: Number(readiness.mappingCount || 0)
        }
      });

      const diagnostics = buildReadinessDiagnostics(readiness, runId, checkpoints);
      await runLogger.warn(`Sync blocked. ${readiness.message}`, diagnostics);
      return {
        ok: false,
        message: diagnostics.message,
        readiness,
        diagnostics,
        summary: {
          finalStatus: 'Failure',
          trigger
        },
        details: safeDetailsString({
          summary: {
            finalStatus: 'Failure',
            trigger
          },
          diagnostics
        })
      };
    }

    await logCheckpoint(runLogger, checkpoints, {
      runId,
      stage: DIAGNOSTIC_STAGES.READINESS,
      outcome: 'ready',
      context: {
        status: readiness.status
      }
    });

    const logger = detailedLogger.child({
      trigger
    });
    const result = await runner(runtimeConfig, logger);
    await logCheckpoint(runLogger, checkpoints, {
      runId,
      stage: DIAGNOSTIC_STAGES.RESULT_AGGREGATION,
      outcome: 'started',
      context: {}
    });

    const summary = summarizeSyncResult(result, runtimeConfig);
    summary.trigger = trigger;
    const diagnostics = {
      stage: DIAGNOSTIC_STAGES.RESULT_AGGREGATION,
      operation: 'sync_result_summary',
      errorName: '',
      message: summary.finalStatus === 'Success' ? 'Sync completed successfully.' : 'Sync completed with issues.',
      code: summary.finalStatus === 'Success' ? 'sync_completed' : 'sync_completed_with_issues',
      httpStatus: null,
      retryable: null,
      service: 'integration_runtime',
      requestTarget: '',
      runId,
      checkpoints: checkpoints.map((row) => ({
        stage: row.stage,
        outcome: row.outcome,
        at: row.at
      }))
    };
    const details = safeDetailsString({ summary, diagnostics, results: result.results || [] });

    await runLogger.info('Sync completed.', {
      finalStatus: summary.finalStatus,
      endpointsSynchronized: summary.endpointsSynchronized,
      skipped: summary.skipped,
      failedEndpointUpdates: summary.failedEndpointUpdates
    });
    await run?.setAssetsProcessed?.(summary.endpointsSynchronized + summary.skipped + summary.failedEndpointUpdates);

    return {
      ok: true,
      message: summary.finalStatus === 'Success' ? 'Sync completed successfully.' : 'Sync completed with issues.',
      summary,
      diagnostics,
      details
    };
  } catch (error) {
    await logCheckpoint(runLogger, checkpoints, {
      runId,
      stage: inferStageFromError(error, DIAGNOSTIC_STAGES.RESULT_AGGREGATION),
      outcome: 'failed',
      context: {
        operation: safeOperation(error?.operation || '', 'sync_execution'),
        code: safeCode(error?.code || '', 'sync_failed'),
        httpStatus: safeHttpStatus(error?.status)
      }
    });

    const diagnostics = buildFailureDiagnostics(error, {
      fallbackStage: DIAGNOSTIC_STAGES.RESULT_AGGREGATION,
      runId,
      checkpoints
    });
    const summary = {
      finalStatus: 'Failure',
      trigger
    };
    const details = safeDetailsString({
      summary,
      diagnostics
    });

    await runLogger.error(`Sync failed. ${diagnostics.message}`, diagnostics);
    return {
      ok: false,
      message: diagnostics.message,
      summary,
      diagnostics,
      details
    };
  }
}

module.exports = {
  runEntraSync,
  summarizeSyncResult
};
