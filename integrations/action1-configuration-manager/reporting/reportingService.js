const { createAction1DiscoveryClient } = require('../action1DiscoveryClient');
const { writeOperationalLog } = require('../runtimeLogging');
const { buildReportDefinitions, REPORTING_DATA_SOURCE_COLUMNS, REPORTS, validateReportPayload } = require('./reportDefinitions');
const store = require('./reportingStore');

const DATA_SOURCE = Object.freeze({ name: 'Configuration Management - Control Status', description: 'Provides per-endpoint policy and control configuration status data for Configuration Management reports.', language: 'PowerShell' });
const SCRIPT_PATH = require('path').join(__dirname, 'configuration-management-control-status.ps1');
const fs = require('fs');
const EXISTENCE = Object.freeze({ EXISTS: 'EXISTS', MISSING: 'MISSING', UNRESOLVED: 'UNRESOLVED' });

function requiredId(payload, label) {
  const id = String(payload?.id || payload?.data?.id || '').trim();
  if (!id) throw new Error(`${label} was not returned by Action1.`);
  return id;
}
function errorMessage(error) { return String(error?.diagnostics?.errorMessage || error?.message || '').trim(); }
function isConclusiveMissing(error, id) {
  const status = Number(error?.statusCode || error?.diagnostics?.statusCode);
  if (status === 404) return true;
  if (status !== 400) return false;
  const contentType = String(error?.diagnostics?.responseContentType || '').toLowerCase();
  const message = errorMessage(error).toLowerCase();
  return contentType === 'application/json' && message.includes(String(id).toLowerCase()) && /(not found|does not exist|doesn't exist)/.test(message);
}
function isPublished(payload) { return String(payload?.status || payload?.state || '').toLowerCase() === 'published'; }
function safeMessage(error) { return errorMessage(error).replace(/\s+/g, ' ').slice(0, 240) || 'Reporting setup failed.'; }
async function log(context, level, message, fields = {}) {
  await writeOperationalLog(context, level, message, fields);
}
async function runLog(request, message) {
  if (typeof request?.run?.appendLog === 'function') await request.run.appendLog(message);
}
function scriptText() { return fs.readFileSync(SCRIPT_PATH, 'utf8'); }

async function observe(client, kind, id) {
  try {
    const payload = await client.requestAction1Mutation({ operation: `get-reporting-${kind}`, method: 'GET', path: `/${kind === 'data-source' ? 'data-sources/all' : 'reports/all'}/${encodeURIComponent(id)}` });
    if (!payload || typeof payload !== 'object' || String(payload.id || '').trim() !== String(id)) return { state: EXISTENCE.UNRESOLVED };
    return { state: EXISTENCE.EXISTS, payload };
  } catch (error) {
    return isConclusiveMissing(error, id) ? { state: EXISTENCE.MISSING } : { state: EXISTENCE.UNRESOLVED, error };
  }
}
function draftPayload(script) { return { name: DATA_SOURCE.name, description: DATA_SOURCE.description, language: DATA_SOURCE.language, status: 'Draft', columns: [], script_text: script }; }
function publishedPayload(script) { return { name: DATA_SOURCE.name, description: DATA_SOURCE.description, language: DATA_SOURCE.language, status: 'Published', columns: REPORTING_DATA_SOURCE_COLUMNS, script_text: script }; }
function validatePublishedDataSourcePayload(payload) {
  if (JSON.stringify(payload.columns) !== JSON.stringify(REPORTING_DATA_SOURCE_COLUMNS)) throw new Error('Reporting Data Source columns do not match the canonical schema.');
  if (payload.columns.includes('A1_Key')) throw new Error('Reporting Data Source published columns must not include A1_Key.');
  if (!String(payload.script_text || '').includes("$row.'Policy Name' = [string]$state.policyName")) throw new Error('Reporting Data Source script does not project Policy Name.');
  return payload;
}

async function ensureDataSource(context, request, state, client) {
  const script = scriptText();
  let id = state.dataSourceId;
  let replaced = false;
  if (id) {
    const observed = await observe(client, 'data-source', id);
    if (observed.state === EXISTENCE.UNRESOLVED) throw observed.error instanceof Error ? observed.error : new Error(safeMessage(observed.error));
    if (observed.state === EXISTENCE.MISSING) { id = null; replaced = true; }
    else if (isPublished(observed.payload)) { await log(context, 'info', 'reporting-data-source-verified', { dataSourceId: id }); await runLog(request, 'Existing Reporting Data Source verified.'); return { id, replaced }; }
  }
  if (!id) {
    await log(context, 'info', 'reporting-data-source-create-started'); await runLog(request, 'Creating Reporting Data Source draft.');
    const created = await client.requestAction1Mutation({ operation: 'create-reporting-data-source', method: 'POST', path: '/data-sources/all', body: draftPayload(script) });
    id = requiredId(created, 'Action1 Data Source id');
    await store.save(context, { dataSourceId: id });
    await log(context, 'info', 'reporting-data-source-draft-created', { dataSourceId: id });
  }
  await runLog(request, 'Publishing Reporting Data Source.');
  const publishedBody = validatePublishedDataSourcePayload(publishedPayload(script));
  const published = await client.requestAction1Mutation({ operation: 'publish-reporting-data-source', method: 'PATCH', path: `/data-sources/all/${encodeURIComponent(id)}`, body: publishedBody });
  if (!isPublished(published) && String(published?.id || id) !== id) throw new Error('Action1 Data Source publish response was invalid.');
  const confirmed = await observe(client, 'data-source', id);
  if (confirmed.state !== EXISTENCE.EXISTS || !isPublished(confirmed.payload)) throw confirmed.error instanceof Error ? confirmed.error : new Error('Action1 Data Source was not confirmed Published.');
  await store.save(context, { dataSourceId: id });
  await runLog(request, 'Reporting Data Source published.');
  return { id, replaced };
}

async function ensureReport(context, request, client, definition, state, dataSourceReplaced) {
  const stateKey = definition.key;
  let id = state[stateKey];
  if (id) {
    const observed = await observe(client, 'report', id);
    if (observed.state === EXISTENCE.UNRESOLVED) throw observed.error instanceof Error ? observed.error : new Error(safeMessage(observed.error) || `Report ${definition.name} could not be verified.`);
    if (observed.state === EXISTENCE.EXISTS) {
      const sources = Array.isArray(observed.payload?.data_sources) ? observed.payload.data_sources.map(source => String(source?.id || source?.data_source_id || source)) : null;
      if (sources && !sources.includes(String(definition.payload.data_sources[0]))) throw new Error(`Report ${definition.name} references a different Configuration Management Data Source.`);
      await log(context, 'info', 'reporting-report-verified', { reportKey: stateKey, reportId: id, dataSourceReplaced }); return id;
    }
  }
  await runLog(request, `Creating report: ${definition.name}`);
  const payload = validateReportPayload(definition.payload);
  const created = await client.requestAction1Mutation({ operation: `create-reporting-report-${stateKey}`, method: 'POST', path: '/reports/all/custom', body: payload });
  id = requiredId(created, 'Action1 Report id');
  await store.save(context, { [stateKey]: id });
  const confirmed = await observe(client, 'report', id);
  if (confirmed.state !== EXISTENCE.EXISTS) throw confirmed.error instanceof Error ? confirmed.error : new Error(`Report ${definition.name} was not confirmed after creation.`);
  await log(context, 'info', 'reporting-report-created', { reportKey: stateKey, reportId: id });
  return id;
}

async function setupReporting(context, request = {}, options = {}) {
  const client = options.client || createAction1DiscoveryClient(context);
  let state = await store.load(context);
  await runLog(request, 'Reporting setup started.');
  await log(context, 'info', 'reporting-setup-started');
  const source = await ensureDataSource(context, request, state, client);
  state = await store.load(context);
  const definitions = buildReportDefinitions(source.id);
  for (const definition of definitions) {
    const id = await ensureReport(context, request, client, definition, state, source.replaced);
    state = await store.save(context, { [definition.key]: id });
  }
  await runLog(request, 'Reporting setup completed.');
  await log(context, 'info', 'reporting-setup-completed');
  return { ok: true, reporting: { dataSource: 'Configured', reports: 'Configured' }, state };
}

async function getReportingStatus(context, options = {}) {
  const client = options.client || createAction1DiscoveryClient(context);
  const state = await store.load(context);
  if (!state.dataSourceId) return { dataSource: 'Not configured', reports: 'Not configured' };
  const source = await observe(client, 'data-source', state.dataSourceId);
  if (source.state !== EXISTENCE.EXISTS || !isPublished(source.payload)) return { dataSource: source.state === EXISTENCE.UNRESOLVED ? 'Not configured' : 'Not configured', reports: 'Not configured' };
  const reportChecks = await Promise.all(REPORTS.map(async report => {
    if (!state[report.key]) return false;
    const observed = await observe(client, 'report', state[report.key]);
    return observed.state === EXISTENCE.EXISTS;
  }));
  const reports = reportChecks.every(Boolean);
  return { dataSource: 'Configured', reports: reports ? 'Configured' : 'Not configured' };
}

async function getReportingState(context) {
  const state = await store.load(context);
  return {
    hasDataSourceId: Boolean(state.dataSourceId),
    reportIdsPresent: REPORTS.filter(report => Boolean(state[report.key])).map(report => report.key)
  };
}

module.exports = { DATA_SOURCE, EXISTENCE, getReportingState, getReportingStatus, isConclusiveMissing, setupReporting };
