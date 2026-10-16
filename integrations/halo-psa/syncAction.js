const { loadRuntimeConfig } = require('./runtimeConfig');
const { createAction1Client } = require('./action1Api');
const {
  createHaloTicketsClient,
  normalizeCategory,
  requestReadOnlyJson,
  requestToken
} = require('./haloApi');
const { createDbCorrelationStore } = require('./correlationStore');
const { createDbSignalWatermarkStore } = require('./signalWatermarkStore');
const { runStage4CandidatePipeline } = require('./stage4CandidatePipeline');
const { createLifecycleRunService } = require('./lifecycleRunService');
const { createMarketplaceRunLogger, LOG_EVENT_TYPES, LOG_LEVELS } = require('./runtimeLogging');

async function runHaloPsaSync(context, request = {}) {
  const run = request.run || null;
  const runStartedAt = Date.now();
  const runLogger = createMarketplaceRunLogger({
    run,
    context,
    integrationId: 'halo-psa'
  });

  await runLogger.emit({
    runId: 'halo-sync',
    level: LOG_LEVELS.INFO,
    eventType: LOG_EVENT_TYPES.RUN_START,
    message: 'Starting HaloPSA sync.',
    context: {
      trigger: String(request?.trigger || 'manual')
    }
  });

  try {
    await runLogger.info('Loading HaloPSA runtime configuration.');
    const runtimeConfig = await loadRuntimeConfig(context);
    const executionPlan = buildSignalExecutionPlan(runtimeConfig);
    runLogger.configure({
      diagnosticLoggingEnabled: runtimeConfig.operationalSafeguards?.enableDebugLogging
    });

    const requiredErrors = validateRuntimeConfig(runtimeConfig);
    await runLogger.info('HaloPSA runtime configuration loaded.', {
      mappedOrganizations: Array.isArray(runtimeConfig.orgClientMappings) ? runtimeConfig.orgClientMappings.length : 0,
      enabledSignals: executionPlan.enabledSignals
    });

    if (executionPlan.enabledSignals.length === 0) {
      const summary = emptySummary();
      const details = buildRunDetails(summary, {
        notes: ['No enabled signals are configured. Nothing to process.']
      });
      const durationMs = Date.now() - runStartedAt;

      await runLogger.info('HaloPSA sync completed as a no-op because no signals are enabled.');
      await run?.setAssetsProcessed?.(0);
      await runLogger.emit({
        runId: 'halo-sync',
        level: LOG_LEVELS.INFO,
        eventType: LOG_EVENT_TYPES.RUN_END,
        message: 'HaloPSA sync completed as a no-op because no signals are enabled.',
        context: {
          durationMs,
          enabledSignals: executionPlan.enabledSignals,
          candidatesSeen: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          failed: 0
        }
      });

      return {
        ok: true,
        message: 'HaloPSA sync completed: no signals are enabled.',
        details,
        summary,
        assetsProcessed: 0,
        collection: {
          organizationsSeen: 0,
          orgFailures: 0
        }
      };
    }

    if (requiredErrors.length > 0) {
      await runLogger.warn(`Sync stopped: ${requiredErrors.join('; ')}`, {
        validationErrors: requiredErrors
      });
      await run?.setAssetsProcessed?.(0);
      return {
        ok: false,
        message: `HaloPSA sync is not ready: ${requiredErrors.join('; ')}`,
        summary: emptySummary(),
        assetsProcessed: 0
      };
    }

    if (!Array.isArray(runtimeConfig.orgClientMappings) || runtimeConfig.orgClientMappings.length === 0) {
      await runLogger.warn('Sync stopped: no Action1 organization to HaloPSA client mappings are configured.');
      await run?.setAssetsProcessed?.(0);
      return {
        ok: false,
        message: 'HaloPSA sync requires at least one enabled Action1 organization mapping.',
        summary: emptySummary(),
        assetsProcessed: 0
      };
    }

    await runLogger.debug('Marketplace mappings loaded.', {
      mappingRows: runtimeConfig.orgClientMappings.map((row) => ({
        mappingId: row.mappingId,
        action1OrgId: row.action1OrgId,
        haloClientId: row.haloClientId
      }))
    });
    const action1Credentials = await logCredentialAvailability(context, runLogger);
    runtimeConfig.connections.action1.baseUrl = String(action1Credentials?.baseUrl || '').trim();

    const correlationStore = createDbCorrelationStore(context);
    const watermarkStore = createDbSignalWatermarkStore(context);
    const action1Client = createAction1Client({ runLogger });
    const haloConnection = {
      resourceServer: runtimeConfig.connections?.halo?.resourceServer,
      authorisationServer: runtimeConfig.connections?.halo?.authorisationServer,
      clientId: runtimeConfig.connections?.halo?.clientId,
      clientSecret: runtimeConfig.connections?.halo?.clientSecretRef
    };
    const haloTicketsClient = createHaloTicketsClient({
      runLogger,
      connectionProvider: () => haloConnection
    });

    await runLogger.info('Starting Action1 collection.', {
      organizations: runtimeConfig.orgClientMappings.length
    });
    const collectionStartedAt = Date.now();
    const collection = await collectMarketplaceDatasets({
      context,
      runLogger,
      runtimeConfig,
      executionPlan,
      action1Client,
      watermarkStore
    });
    await runLogger.info('Action1 collection completed.', {
      durationMs: Date.now() - collectionStartedAt,
      organizationsSeen: collection.action1Organizations.length,
      orgFailures: collection.failures.length
    });

    await runLogger.info('Running candidate pipeline.');
    const pipelineStartedAt = Date.now();
    const pipeline = runStage4CandidatePipeline({
      config: runtimeConfig,
      action1Organizations: collection.action1Organizations,
      action1EndpointsByOrg: collection.action1EndpointsByOrg,
      signalDatasets: collection.signalDatasets,
      enableGroupedAggregation: true,
      now: new Date().toISOString()
    });
    await runLogger.info('Candidate pipeline completed.', {
      durationMs: Date.now() - pipelineStartedAt,
      endpointsSeen: pipeline.summary?.endpointsSeen || 0,
      candidatesBySignalType: pipeline.summary?.candidatesBySignalType || {},
      skippedByReason: pipeline.summary?.skippedByReason || {}
    });

    await runLogger.info('Loading HaloPSA category metadata.');
    const categoryStartedAt = Date.now();
    const categories = await loadLifecycleCategories(haloConnection, runtimeConfig, collection.haloCategoryCache, runLogger);
    await runLogger.debug('HaloPSA category metadata loaded.', {
      durationMs: Date.now() - categoryStartedAt,
      categoryCount: Array.isArray(categories) ? categories.length : 0
    });

    await runLogger.info('Starting lifecycle execution.', {
      candidatesSeen: Array.isArray(pipeline.candidates) ? pipeline.candidates.length : 0
    });
    const lifecycleStartedAt = Date.now();
    const lifecycleService = createLifecycleRunService({
      haloTicketsClient,
      correlationStore,
      runLogger
    });
    const lifecycleResult = await lifecycleService.runOnce({
      candidates: pipeline.candidates,
      categories,
      config: runtimeConfig,
      runLogger
    });
    await runLogger.info('Lifecycle execution completed.', {
      durationMs: Date.now() - lifecycleStartedAt,
      created: lifecycleResult.summary?.created || 0,
      updated: lifecycleResult.summary?.updated || 0,
      skipped: lifecycleResult.summary?.skipped || 0,
      failed: lifecycleResult.summary?.failed || 0
    });

    await runLogger.debug('Persisting automation-failed watermarks.', {
      pendingWatermarks: collection.pendingWatermarks.length
    });
    await persistPendingWatermarks(watermarkStore, collection.pendingWatermarks, lifecycleResult);

    const summary = mergeSummaries({
      pipeline,
      lifecycleResult,
      collectionFailures: collection.failures
    });
    const assetsProcessed = Number(pipeline.summary?.endpointsSeen || 0);
    const details = buildRunDetails(summary);
    const durationMs = Date.now() - runStartedAt;

    await run?.setAssetsProcessed?.(assetsProcessed);
    await runLogger.emit({
      runId: 'halo-sync',
      level: summary.failed > 0 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO,
      eventType: LOG_EVENT_TYPES.RUN_END,
      message: summary.failed > 0 ? 'HaloPSA sync completed with failures.' : 'HaloPSA sync completed.',
      context: {
        durationMs,
        candidatesSeen: summary.candidatesSeen,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        failed: summary.failed,
        bySignalType: summary.bySignalType
      }
    });

    return {
      ok: summary.failed === 0,
      message: summary.failed === 0 ? 'HaloPSA sync completed.' : 'HaloPSA sync completed with failures.',
      details,
      summary,
      assetsProcessed,
      collection: {
        organizationsSeen: collection.action1Organizations.length,
        orgFailures: collection.failures.length
      }
    };
  } catch (error) {
    const sanitizedError = sanitizeSyncError(error);
    await runLogger.error('HaloPSA sync failed.', {
      durationMs: Date.now() - runStartedAt,
      error: sanitizedError.message,
      code: sanitizedError.code,
      stack: sanitizedError.stack
    });
    throw error;
  }
}

async function collectMarketplaceDatasets(input) {
  const { context, runLogger, runtimeConfig, executionPlan, action1Client, watermarkStore } = input;
  const action1Organizations = [];
  const action1EndpointsByOrg = {};
  const signalDatasets = {
    vulnerabilitiesByEndpoint: {},
    updatesByEndpoint: {},
    automationFailedByEndpoint: {}
  };
  const failures = [];
  const pendingWatermarks = [];

  for (const mapping of runtimeConfig.orgClientMappings) {
    const action1OrgId = String(mapping.action1OrgId || '').trim();
    if (!action1OrgId) continue;
    action1Organizations.push({ id: action1OrgId, name: mapping.action1OrgName || action1OrgId });
    const orgLogger = runLogger.child({
      action1OrgId,
      haloClientId: String(mapping.haloClientId || '')
    });

    try {
      await orgLogger.info(`Collecting Action1 data for ${mapping.action1OrgName || action1OrgId}.`);
      const orgStartedAt = Date.now();
      let endpoints = [];
      let vulnerabilities = [];
      let updates = [];
      let automationFailed = [];
      const automationMeta = {};

      if (executionPlan.collectEndpoints) {
        await orgLogger.debug('Fetching Action1 endpoints.');
        endpoints = await action1Client.listEndpoints(action1OrgId, { context, runId: `sync-endpoints-${action1OrgId}` });
        action1EndpointsByOrg[action1OrgId] = endpoints;
        await orgLogger.debug('Action1 endpoints collected.', {
          endpoints: Array.isArray(endpoints) ? endpoints.length : 0
        });
      } else {
        await orgLogger.info('Skipping Action1 endpoint collection because no enabled signals require endpoint data.');
      }

      if (executionPlan.collectVulnerability) {
        await orgLogger.debug('Fetching Action1 vulnerabilities.');
        vulnerabilities = await action1Client.listVulnerabilityFindingsByOrg(action1OrgId, {
          context,
          runId: `sync-vuln-${action1OrgId}`,
          filter: runtimeConfig.signalFilters?.vulnerability
        });
        await orgLogger.debug('Action1 vulnerabilities collected.', {
          rows: Array.isArray(vulnerabilities) ? vulnerabilities.length : 0
        });
      } else {
        await orgLogger.info('Skipping Action1 vulnerability collection because VULNERABILITY is disabled.');
      }

      if (executionPlan.collectUpdate) {
        await orgLogger.debug('Fetching Action1 missing updates.');
        updates = await action1Client.listMissingUpdatesByOrg(action1OrgId, {
          context,
          runId: `sync-updates-${action1OrgId}`,
          filter: runtimeConfig.signalFilters?.update
        });
        await orgLogger.debug('Action1 missing updates collected.', {
          rows: Array.isArray(updates) ? updates.length : 0
        });
      } else {
        await orgLogger.info('Skipping Action1 update collection because UPDATE is disabled.');
      }

      if (executionPlan.collectAutomationFailed) {
        const existingWatermark = await watermarkStore.getAutomationFailedWatermark(mapping.mappingId);
        await orgLogger.debug('Fetching Action1 automation failures.', {
          existingWatermark: existingWatermark?.lastSeenAt || existingWatermark?.watermarkAt || existingWatermark?.watermarkValue || ''
        });
        automationFailed = await action1Client.listAutomationFailuresByOrg(action1OrgId, {
          context,
          runId: `sync-automation-${action1OrgId}`,
          cutoffEndTime: computeAutomationFailedCutoff(runtimeConfig.signalFilters?.automationFailed?.lookbackHours),
          watermarkEndTime: existingWatermark?.lastSeenAt || existingWatermark?.watermarkAt || existingWatermark?.watermarkValue || '',
          meta: automationMeta
        });
        await orgLogger.debug('Action1 automation failures collected.', {
          rows: Array.isArray(automationFailed) ? automationFailed.length : 0,
          instancesSeen: automationMeta.instancesSeen || 0,
          instancesQualified: automationMeta.instancesQualified || 0,
          instancesSkippedOld: automationMeta.instancesSkippedOld || 0
        });
      } else {
        await orgLogger.info('Skipping Action1 automation-failed collection because AUTOMATION_FAILED is disabled.');
      }

      signalDatasets.vulnerabilitiesByEndpoint[action1OrgId] = groupSignalRowsByEndpoint(vulnerabilities);
      signalDatasets.updatesByEndpoint[action1OrgId] = groupSignalRowsByEndpoint(updates);
      signalDatasets.automationFailedByEndpoint[action1OrgId] = groupSignalRowsByEndpoint(automationFailed);

      if (automationMeta.maxSeenEndTime) {
        pendingWatermarks.push({
          orgLinkId: mapping.mappingId,
          action1OrgId,
          lastSeenAt: automationMeta.maxSeenEndTime,
          lastInstanceId: automationMeta.lastInstanceId || ''
        });
      }
      await orgLogger.info(`Completed Action1 data collection for ${mapping.action1OrgName || action1OrgId}.`, {
        durationMs: Date.now() - orgStartedAt,
        endpoints: Array.isArray(endpoints) ? endpoints.length : 0,
        vulnerabilityRows: Array.isArray(vulnerabilities) ? vulnerabilities.length : 0,
        updateRows: Array.isArray(updates) ? updates.length : 0,
        automationFailedRows: Array.isArray(automationFailed) ? automationFailed.length : 0
      });
    } catch (error) {
      const reason = sanitizeFailureReason(error);
      failures.push({
        orgLinkId: mapping.mappingId,
        action1OrgId,
        reason
      });
      await orgLogger.warn(`Action1 collection failed for ${mapping.action1OrgName || action1OrgId}: ${reason}.`, {
        reason
      });
    }
  }

  return {
    action1Organizations,
    action1EndpointsByOrg,
    failures,
    haloCategoryCache: null,
    pendingWatermarks,
    signalDatasets
  };
}

async function loadLifecycleCategories(connection, runtimeConfig, haloCategoryCache, runLogger) {
  if (!runtimeConfig.ticketDestination?.category1Id) {
    await runLogger?.debug?.('Skipping HaloPSA category lookup because no Category 1 is configured.');
    return [];
  }

  const settingsShape = {
    HaloPsaResourceServer: connection.resourceServer,
    HaloPsaAuthorisationServer: connection.authorisationServer,
    HaloPsaClientId: connection.clientId,
    HaloPsaClientSecret: connection.clientSecret
  };
  const accessToken = await requestToken(settingsShape, {
    runLogger,
    runId: 'halo-category-token',
    timeoutMs: 15000,
    maxAttempts: 2
  });
  const payload = await requestReadOnlyJson(settingsShape, accessToken, '/Category?$top=200', {
    runLogger,
    runId: 'halo-category-read',
    timeoutMs: 15000,
    maxAttempts: 2
  });
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.categories) ? payload.categories : Array.isArray(payload?.items) ? payload.items : [];
  return rows.map((row) => normalizeCategory(row)).filter(Boolean);
}

async function persistPendingWatermarks(watermarkStore, pendingWatermarks, lifecycleResult) {
  if (!lifecycleResult || !Array.isArray(pendingWatermarks) || pendingWatermarks.length === 0) return;
  for (const pending of pendingWatermarks) {
    await watermarkStore.upsertAutomationFailedWatermark(pending.orgLinkId, {
      action1OrgId: pending.action1OrgId,
      lastSeenAt: pending.lastSeenAt,
      lastInstanceId: pending.lastInstanceId,
      orgLinkId: pending.orgLinkId
    });
  }
}

function mergeSummaries(input) {
  const lifecycleSummary = input.lifecycleResult?.summary || emptySummary();
  const collectionFailures = Array.isArray(input.collectionFailures) ? input.collectionFailures : [];
  const skippedByReason = {
    ...(input.pipeline?.summary?.skippedByReason || {}),
    ...(lifecycleSummary.skippedByReason || {})
  };
  const failuresByReason = { ...(lifecycleSummary.failuresByReason || {}) };
  for (const failure of collectionFailures) {
    failuresByReason[failure.reason] = Number(failuresByReason[failure.reason] || 0) + 1;
  }
  return {
    candidatesSeen: Number(lifecycleSummary.candidatesSeen || 0),
    created: Number(lifecycleSummary.created || 0),
    updated: Number(lifecycleSummary.updated || 0),
    skipped: Number(lifecycleSummary.skipped || 0),
    failed: Number(lifecycleSummary.failed || 0) + collectionFailures.length,
    bySignalType: { ...(lifecycleSummary.bySignalType || {}), ...(input.pipeline?.summary?.candidatesBySignalType || {}) },
    skippedByReason,
    failuresByReason
  };
}

function validateRuntimeConfig(runtimeConfig) {
  const errors = [];
  if (!String(runtimeConfig.connections?.halo?.resourceServer || '').trim()) errors.push('HaloPsaResourceServer is required');
  if (!String(runtimeConfig.connections?.halo?.authorisationServer || '').trim()) errors.push('HaloPsaAuthorisationServer is required');
  if (!String(runtimeConfig.connections?.halo?.clientId || '').trim()) errors.push('HaloPsaClientId is required');
  if (!String(runtimeConfig.connections?.halo?.clientSecretRef || '').trim()) errors.push('HaloPsaClientSecret is required');
  if (!String(runtimeConfig.ticketDestination?.ticketTypeId || '').trim()) errors.push('HaloPsaTicketTypeId is required');
  if (!Array.isArray(runtimeConfig.ticketDestination?.closedStatusIds) || runtimeConfig.ticketDestination.closedStatusIds.length === 0) errors.push('HaloPsaClosedStatusIds is required');
  return errors;
}

function groupSignalRowsByEndpoint(rows) {
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const endpointId = String(row?.endpointId || row?.endpoint_id || row?.id || '').trim();
    if (!endpointId) continue;
    if (!out[endpointId]) out[endpointId] = [];
    out[endpointId].push(row);
  }
  return out;
}

function computeAutomationFailedCutoff(lookbackHours) {
  const hours = Number(lookbackHours || 24);
  const deltaMs = (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - deltaMs);
  const pad = (value) => String(value).padStart(2, '0');
  return `${cutoff.getUTCFullYear()}-${pad(cutoff.getUTCMonth() + 1)}-${pad(cutoff.getUTCDate())}_${pad(cutoff.getUTCHours())}-${pad(cutoff.getUTCMinutes())}-${pad(cutoff.getUTCSeconds())}`;
}

function sanitizeFailureReason(error) {
  const text = String(error?.code || error?.message || 'collection_failed').trim().toLowerCase();
  if (text.includes('token') || text.includes('secret') || text.includes('authorization') || text.includes('bearer')) {
    return 'collection_failed';
  }
  return /^[a-z0-9_:/.\-\s]+$/i.test(text) ? text.replace(/\s+/g, '_') : 'collection_failed';
}

function emptySummary() {
  return {
    candidatesSeen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    bySignalType: {},
    skippedByReason: {},
    failuresByReason: {}
  };
}

function buildRunDetails(summary, options = {}) {
  const notes = Array.isArray(options.notes) ? options.notes.map((row) => String(row || '').trim()).filter(Boolean) : [];
  return [
    ...notes,
    'HALO_PSA_SYNC_SUMMARY_BEGIN',
    `candidatesSeen: ${Number(summary?.candidatesSeen || 0)}`,
    `created: ${Number(summary?.created || 0)}`,
    `updated: ${Number(summary?.updated || 0)}`,
    `skipped: ${Number(summary?.skipped || 0)}`,
    `failed: ${Number(summary?.failed || 0)}`,
    'HALO_PSA_SYNC_SUMMARY_END'
  ].join('\n');
}

async function logCredentialAvailability(context, runLogger) {
  const credentials = await context?.action1?.getCredentials?.();
  const apiKeyPresent = Boolean(String(credentials?.apiKey || '').trim());
  const apiSecretPresent = Boolean(String(credentials?.apiSecret || '').trim());
  await runLogger.info('Marketplace Action1 credentials checked.', {
    credentialsAvailable: apiKeyPresent && apiSecretPresent
  });
  return credentials || {};
}

function summarizeEnabledSignals(runtimeConfig) {
  const out = [];
  if (runtimeConfig.signalFilters?.offline?.enabled) out.push('OFFLINE');
  if (runtimeConfig.signalFilters?.rebootRequired?.enabled) out.push('REBOOT_REQUIRED');
  if (runtimeConfig.signalFilters?.automationFailed?.enabled) out.push('AUTOMATION_FAILED');
  if (runtimeConfig.signalFilters?.vulnerability?.enabled) out.push('VULNERABILITY');
  if (runtimeConfig.signalFilters?.update?.enabled) out.push('UPDATE');
  return out;
}

function buildSignalExecutionPlan(runtimeConfig) {
  const enabledSignals = summarizeEnabledSignals(runtimeConfig);
  return {
    enabledSignals,
    collectEndpoints: enabledSignals.length > 0,
    collectVulnerability: enabledSignals.includes('VULNERABILITY'),
    collectUpdate: enabledSignals.includes('UPDATE'),
    collectAutomationFailed: enabledSignals.includes('AUTOMATION_FAILED')
  };
}

function sanitizeSyncError(error) {
  const message = String(error?.message || 'sync_failed').trim();
  const stack = String(error?.stack || '').split('\n').slice(0, 6).join('\n');
  const safeMessage =
    message && !/(secret|token|authorization|bearer|password|x-tenant)/i.test(message)
      ? message
      : 'sync_failed';
  return {
    code: String(error?.code || 'sync_failed').trim() || 'sync_failed',
    message: safeMessage,
    stack: stack && !/(secret|token|authorization|bearer|password|x-tenant)/i.test(stack) ? stack : ''
  };
}

module.exports = {
  runHaloPsaSync
};
