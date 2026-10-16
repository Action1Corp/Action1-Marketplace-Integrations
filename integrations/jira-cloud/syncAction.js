const { createAction1Client } = require('./action1Api');
const { createDbCorrelationStore } = require('./correlationStore');
const { createIssue, getIssue, loadSettings, updateIssue } = require('./jiraApi');
const { createLifecycleRunService } = require('./lifecycleRunService');
const { loadRuntimeConfig } = require('./runtimeConfig');
const { createMarketplaceRunLogger, LOG_EVENT_TYPES, LOG_LEVELS } = require('./runtimeLogging');
const { createDbSignalWatermarkStore } = require('./signalWatermarkStore');
const { runStage4CandidatePipeline } = require('./stage4CandidatePipeline');

const SUMMARY_BLOCK_BEGIN = 'JIRA_CLOUD_SYNC_SUMMARY_BEGIN';
const SUMMARY_BLOCK_END = 'JIRA_CLOUD_SYNC_SUMMARY_END';

async function runJiraCloudSync(context, request = {}) {
  const run = request.run || null;
  const runStartedAt = Date.now();
  const runLogger = createMarketplaceRunLogger({
    run,
    context,
    integrationId: 'jira-cloud'
  });

  await runLogger.emit({
    runId: 'jira-sync',
    level: LOG_LEVELS.INFO,
    eventType: LOG_EVENT_TYPES.RUN_START,
    message: 'Starting Jira Cloud sync.',
    context: {
      trigger: String(request?.trigger || 'manual')
    }
  });

  try {
    await runLogger.info('Loading Jira Cloud runtime configuration.');
    const runtimeConfig = await loadRuntimeConfig(context);
    const executionPlan = buildSignalExecutionPlan(runtimeConfig);
    runLogger.configure({
      diagnosticLoggingEnabled: runtimeConfig.operationalSafeguards?.enableDebugLogging
    });

    const requiredErrors = validateRuntimeConfig(runtimeConfig);
    await runLogger.info('Jira Cloud runtime configuration loaded.', {
      mappedOrganizations: Array.isArray(runtimeConfig.orgProjectMappings) ? runtimeConfig.orgProjectMappings.length : 0,
      enabledSignals: executionPlan.enabledSignals
    });

    if (executionPlan.enabledSignals.length === 0) {
      const summary = emptySummary();
      const details = buildRunDetails(summary, {
        assetsProcessed: 0,
        notes: ['No enabled signals are configured. Nothing to process.']
      });
      const durationMs = Date.now() - runStartedAt;

      await runLogger.info('Jira Cloud sync completed as a no-op because no signals are enabled.');
      await run?.setAssetsProcessed?.(0);
      await runLogger.emit({
        runId: 'jira-sync',
        level: LOG_LEVELS.INFO,
        eventType: LOG_EVENT_TYPES.RUN_END,
        message: 'Jira Cloud sync completed as a no-op because no signals are enabled.',
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
        message: 'Jira Cloud sync completed: no signals are enabled.',
        details,
        summary,
        candidatesPreview: [],
        assetsProcessed: 0,
        diagnostics: {
          partial: false,
          warnings: [],
          executionPlan: {
            enabledSignals: executionPlan.enabledSignals
          },
          settingsSummary: buildSettingsSummary(runtimeConfig),
          signalCollection: {
            organizationsSeen: 0,
            orgFailures: 0
          }
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
        message: `Jira Cloud sync is not ready: ${requiredErrors.join('; ')}`,
        details: buildRunDetails(emptySummary(), { assetsProcessed: 0 }),
        summary: emptySummary(),
        candidatesPreview: [],
        diagnostics: {
          partial: false,
          warnings: requiredErrors.map((reason) => ({ reason })),
          executionPlan: {
            enabledSignals: executionPlan.enabledSignals
          },
          settingsSummary: buildSettingsSummary(runtimeConfig),
          signalCollection: {
            organizationsSeen: 0,
            orgFailures: 0
          }
        },
        assetsProcessed: 0
      };
    }

    if (!Array.isArray(runtimeConfig.orgProjectMappings) || runtimeConfig.orgProjectMappings.length === 0) {
      await runLogger.warn('Sync stopped: no Jira project mappings are configured.');
      await run?.setAssetsProcessed?.(0);
      return buildNoopResult('Jira Cloud sync requires at least one enabled Action1 organization mapping.', runtimeConfig, executionPlan);
    }

    await runLogger.debug('Marketplace mappings loaded.', {
      mappingRows: runtimeConfig.orgProjectMappings.map((row) => ({
        mappingId: row.mappingId,
        action1OrgId: row.action1OrgId,
        jiraProjectId: row.jiraProjectId,
        jiraIssueTypeId: row.jiraIssueTypeId
      }))
    });
    const action1Credentials = await logCredentialAvailability(context, runLogger);
    runtimeConfig.connections.action1.baseUrl = String(action1Credentials?.baseUrl || '').trim();

    const action1Client = createAction1Client({ runLogger });
    const watermarkStore = createDbSignalWatermarkStore(context);
    await runLogger.info('Starting Action1 collection.', {
      organizations: runtimeConfig.orgProjectMappings.length
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

    await runLogger.info('Running Jira candidate pipeline.');
    const pipelineStartedAt = Date.now();
    const pipeline = runStage4CandidatePipeline({
      config: runtimeConfig,
      action1Organizations: collection.action1Organizations,
      action1EndpointsByOrg: collection.action1EndpointsByOrg,
      signalDatasets: collection.signalDatasets,
      enableGroupedAggregation: true,
      now: new Date().toISOString()
    });
    await runLogger.info('Jira candidate pipeline completed.', {
      durationMs: Date.now() - pipelineStartedAt,
      endpointsSeen: pipeline.summary?.endpointsSeen || 0,
      candidatesBySignalType: pipeline.summary?.candidatesBySignalType || {},
      skippedByReason: pipeline.summary?.skippedByReason || {}
    });

    await runLogger.info('Starting Jira lifecycle execution.', {
      candidatesSeen: Array.isArray(pipeline.candidates) ? pipeline.candidates.length : 0
    });
    const lifecycleStartedAt = Date.now();
    const jiraSettings = await loadSettings(context, request);
    const lifecycleService = createLifecycleRunService({
      jiraApi: {
        createIssue: (payload) => createIssue(jiraSettings, payload),
        getIssue: (issueIdOrKey) => getIssue(jiraSettings, issueIdOrKey),
        updateIssue: (issueIdOrKey, payload) => updateIssue(jiraSettings, issueIdOrKey, payload)
      },
      correlationStore: createDbCorrelationStore(context),
      runLogger
    });
    const lifecycleResult = await lifecycleService.runOnce({
      candidates: pipeline.candidates,
      config: runtimeConfig,
      runLogger
    });
    await runLogger.info('Jira lifecycle execution completed.', {
      durationMs: Date.now() - lifecycleStartedAt,
      created: lifecycleResult.summary?.created || 0,
      updated: lifecycleResult.summary?.updated || 0,
      skipped: lifecycleResult.summary?.skipped || 0,
      failed: lifecycleResult.summary?.failed || 0,
      skippedByReason: lifecycleResult.summary?.skippedByReason || {},
      bySignalAndReason: lifecycleResult.summary?.bySignalAndReason || {}
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
    const candidatesPreview = buildCandidatesPreview(pipeline.candidates, lifecycleResult.results, 20);
    const assetsProcessed = Number(pipeline.summary?.endpointsSeen || 0);
    const details = buildRunDetails(summary, { assetsProcessed });
    const durationMs = Date.now() - runStartedAt;

    await run?.setAssetsProcessed?.(assetsProcessed);
    await runLogger.emit({
      runId: 'jira-sync',
      level: summary.failed > 0 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO,
      eventType: LOG_EVENT_TYPES.RUN_END,
      message: summary.failed > 0 ? 'Jira Cloud sync completed with failures.' : 'Jira Cloud sync completed.',
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
      message: summary.failed === 0 ? 'Jira Cloud sync completed.' : 'Jira Cloud sync completed with failures.',
      details,
      summary,
      candidatesPreview,
      assetsProcessed,
      diagnostics: {
        partial: collection.failures.length > 0,
        warnings: collection.failures.map((failure) => ({
          action1OrgId: failure.action1OrgId,
          reason: failure.reason,
          code: failure.code || '',
          relation: failure.relation || '',
          operation: failure.operation || ''
        })),
        executionPlan: {
          enabledSignals: executionPlan.enabledSignals
        },
        settingsSummary: buildSettingsSummary(runtimeConfig),
        signalCollection: {
          organizationsSeen: collection.action1Organizations.length,
          orgFailures: collection.failures.length
        }
      }
    };
  } catch (error) {
    const sanitizedError = sanitizeSyncError(error);
    await runLogger.error('Jira Cloud sync failed.', {
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

  for (const mapping of runtimeConfig.orgProjectMappings) {
    const action1OrgId = String(mapping.action1OrgId || '').trim();
    if (!action1OrgId) continue;
    action1Organizations.push({ id: action1OrgId, name: mapping.action1OrgName || action1OrgId });
    const orgLogger = runLogger.child({
      action1OrgId,
      jiraProjectId: String(mapping.jiraProjectId || ''),
      jiraIssueTypeId: String(mapping.jiraIssueTypeId || '')
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
        endpoints = await action1Client.listEndpoints(action1OrgId, {
          context,
          runId: `jira-sync-endpoints-${action1OrgId}`
        });
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
          runId: `jira-sync-vuln-${action1OrgId}`,
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
          runId: `jira-sync-updates-${action1OrgId}`,
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
          runId: `jira-sync-automation-${action1OrgId}`,
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

      await orgLogger.info(`Completed Action1 read-only collection for ${mapping.action1OrgName || action1OrgId}.`, {
        durationMs: Date.now() - orgStartedAt,
        endpoints: Array.isArray(endpoints) ? endpoints.length : 0,
        vulnerabilityRows: Array.isArray(vulnerabilities) ? vulnerabilities.length : 0,
        updateRows: Array.isArray(updates) ? updates.length : 0,
        automationFailedRows: Array.isArray(automationFailed) ? automationFailed.length : 0
      });
    } catch (error) {
      const failureDiagnostic = buildSafeFailureDiagnostic(error);
      failures.push({
        action1OrgId,
        reason: failureDiagnostic.reason,
        code: failureDiagnostic.code,
        relation: failureDiagnostic.relation,
        operation: failureDiagnostic.operation
      });
      await orgLogger.warn(`Action1 signal collection failed for ${mapping.action1OrgName || action1OrgId}.`, {
        reason: failureDiagnostic.reason,
        code: failureDiagnostic.code,
        relation: failureDiagnostic.relation,
        operation: failureDiagnostic.operation
      });
    }
  }

  return {
    action1Organizations,
    action1EndpointsByOrg,
    failures,
    pendingWatermarks,
    signalDatasets
  };
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

function validateRuntimeConfig(runtimeConfig) {
  const errors = [];
  if (!String(runtimeConfig.connections?.jira?.siteUrl || '').trim()) errors.push('JiraCloudSiteUrl is required');
  if (!String(runtimeConfig.connections?.jira?.email || '').trim()) errors.push('JiraCloudUserEmail is required');
  if (!String(runtimeConfig.connections?.jira?.apiTokenRef || '').trim()) errors.push('JiraCloudApiToken is required');
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
    failuresByReason,
    bySignalAndReason: { ...(lifecycleSummary.bySignalAndReason || {}) }
  };
}

function buildCandidatesPreview(candidates, lifecycleResults, limit) {
  const outcomesByIdentity = new Map(
    (Array.isArray(lifecycleResults) ? lifecycleResults : [])
      .filter((row) => row && typeof row === 'object' && row.identityKey)
      .map((row) => [String(row.identityKey), row])
  );

  return (Array.isArray(candidates) ? candidates : []).slice(0, limit).map((candidate) => {
    const identityKey = candidate?.identity?.key || candidate?.identity?.identityKey || '';
    const outcome = outcomesByIdentity.get(identityKey);
    return {
      ticketModel: candidate.ticketModel,
      identityKey,
      signalType: candidate?.signal?.type || '',
      action1OrgName: candidate?.routing?.action1OrgName || '',
      jiraProjectKey: candidate?.routing?.jiraProjectKey || '',
      jiraIssueTypeName: candidate?.routing?.jiraIssueTypeName || '',
      endpointId: candidate?.endpoint?.id || '',
      endpointName: candidate?.endpoint?.name || '',
      groupedIssueKey: candidate?.grouped?.issueKey || '',
      lifecycleAction: outcome?.action || '',
      linkedJiraIssueKey: outcome?.issueKey || '',
      lifecycleReason: outcome?.reason || ''
    };
  });
}

function buildNoopResult(message, runtimeConfig = {}, executionPlan = { enabledSignals: [] }) {
  return {
    ok: false,
    message,
    details: buildRunDetails(emptySummary(), { assetsProcessed: 0 }),
    summary: emptySummary(),
    candidatesPreview: [],
    diagnostics: {
      partial: false,
      warnings: [],
      executionPlan: {
        enabledSignals: executionPlan.enabledSignals || []
      },
      settingsSummary: buildSettingsSummary(runtimeConfig),
      signalCollection: {
        organizationsSeen: 0,
        orgFailures: 0
      }
    },
    assetsProcessed: 0
  };
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
    SUMMARY_BLOCK_BEGIN,
    `candidatesSeen: ${Number(summary?.candidatesSeen || 0)}`,
    `created: ${Number(summary?.created || 0)}`,
    `updated: ${Number(summary?.updated || 0)}`,
    `skipped: ${Number(summary?.skipped || 0)}`,
    `failed: ${Number(summary?.failed || 0)}`,
    `assetsProcessed: ${Number(options.assetsProcessed || 0)}`,
    SUMMARY_BLOCK_END
  ].join('\n');
}

async function logCredentialAvailability(context, runLogger) {
  const credentials = await context?.action1?.getCredentials?.();
  const apiKeyPresent = Boolean(String(credentials?.apiKey || '').trim());
  const apiSecretPresent = Boolean(String(credentials?.apiSecret || '').trim());
  await runLogger.info('Marketplace Action1 credentials checked for Jira sync.', {
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

function buildSettingsSummary(runtimeConfig = {}) {
  return {
    enabledSignals: summarizeEnabledSignals(runtimeConfig),
    ticketModels: {
      vulnerability: runtimeConfig.vulnerabilities?.ticketModel || 'grouped',
      update: runtimeConfig.updates?.ticketModel || 'grouped',
      automationFailed: runtimeConfig.automationFailed?.ticketModel || 'grouped'
    },
    maxImpactedEndpointsInGroupedTicket: Number(runtimeConfig.maxImpactedEndpointsInGroupedTicket || 0),
    maxOpenTicketsPerOrganization: Number(runtimeConfig.operationalSafeguards?.maxOpenTicketsPerOrganization || 0)
  };
}

function buildSafeFailureDiagnostic(error) {
  const safe = error?.safeDiagnostic && typeof error.safeDiagnostic === 'object' ? error.safeDiagnostic : null;
  if (safe) {
    return {
      reason: sanitizeFailureReason(safe.reason || 'collection_failed'),
      code: sanitizeFailureField(safe.code),
      relation: sanitizeFailureField(safe.relation),
      operation: sanitizeFailureField(safe.operation)
    };
  }

  const code = sanitizeFailureField(error?.code);
  const relation = sanitizeFailureField(extractFailureRelation(error));
  const operation = sanitizeFailureField(error?.operation);
  return {
    reason: code === '42P01' || relation ? 'database_error' : sanitizeFailureReason(error?.message || code || 'collection_failed'),
    code,
    relation,
    operation
  };
}

function sanitizeFailureReason(value) {
  const text = String(value || 'collection_failed').trim().toLowerCase();
  if (text.includes('token') || text.includes('secret') || text.includes('authorization') || text.includes('bearer')) {
    return 'collection_failed';
  }
  return /^[a-z0-9_:/.\-\s]+$/i.test(text) ? text.replace(/\s+/g, '_') : 'collection_failed';
}

function sanitizeFailureField(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (/(token|secret|authorization|bearer|password|cookie)/i.test(text)) {
    return '';
  }
  return /^[a-z0-9_:/.\-]+$/i.test(text) ? text : '';
}

function extractFailureRelation(error) {
  const direct = String(error?.relation || error?.table || '').trim();
  if (direct) {
    return direct;
  }

  const match = String(error?.message || '').match(/relation\s+"?([a-z0-9_]+)"?\s+does not exist/i);
  return match ? String(match[1] || '').trim() : '';
}

function sanitizeSyncError(error) {
  const message = String(error?.message || 'sync_failed').trim();
  const stack = String(error?.stack || '').split('\n').slice(0, 6).join('\n');
  const safeMessage =
    message && !/(secret|token|authorization|bearer|password|cookie)/i.test(message)
      ? message
      : 'sync_failed';
  return {
    code: String(error?.code || 'sync_failed').trim() || 'sync_failed',
    message: safeMessage,
    stack: stack && !/(secret|token|authorization|bearer|password|cookie)/i.test(stack) ? stack : ''
  };
}

module.exports = {
  runJiraCloudSync
};
