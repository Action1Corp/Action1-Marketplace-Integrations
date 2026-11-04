const assert = require('node:assert/strict');
const test = require('node:test');

const { setupReporting } = require('../reporting/reportingService');
const { buildReportDefinitions, validateReportPayload } = require('../reporting/reportDefinitions');

function db(initial = null) {
  let row = initial;
  return {
    async get() { return row; },
    async run(sql, params) {
      if (sql.startsWith('INSERT')) row = { singleton_id: 1, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5], report_dashboard_endpoints: params[6], report_dashboard_non_compliant_endpoints: params[7], report_dashboard_non_compliant_controls: params[8] };
      if (sql.startsWith('UPDATE')) row = { ...row, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5], report_dashboard_endpoints: params[6], report_dashboard_non_compliant_endpoints: params[7], report_dashboard_non_compliant_controls: params[8] };
    }
  };
}

function api4Client(calls, { sourceId = null, missing = false } = {}) {
  const reports = new Set();
  return {
    async resolveConnection() { return { apiGeneration: 4 }; },
    async requestAction1Mutation(input) {
      calls.push(input);
      if (input.method === 'GET' && input.path.startsWith('/data-sources/')) {
        if (missing) throw { statusCode: 404, diagnostics: { responseContentType: 'application/json', errorMessage: 'not found' } };
        return { id: sourceId, type: 'DataSource', configs: [{ id: sourceId, type: 'DataSourceConfiguration', name: 'Configuration Management - Control Status', language: 'PowerShell', platform: 'Windows', script_text: 'script' }], columns: ['Endpoint Name'] };
      }
      if (input.method === 'POST' && input.path === '/data-sources/all') {
        const id = input.body.configs[0].id;
        sourceId = id;
        return { id, type: 'DataSource', configs: [{ ...input.body.configs[0] }], columns: input.body.columns };
      }
      if (input.method === 'POST' && input.path === '/reports/all/custom') {
        const id = `report-${reports.size + 1}`;
        reports.add(id);
        return { id, type: 'Report', data_sources: input.body.data_sources.map((id) => ({ id, name: 'source', columns: 'Endpoint Name' })), report_data: `/api/4.0/reportdata/org/${id}/data` };
      }
      if (input.method === 'GET' && input.path.startsWith('/reports/all/')) return { id: input.path.split('/').pop(), data_sources: [] };
      throw new Error(`Unexpected ${input.method} ${input.path}`);
    }
  };
}

test('API 4 reporting creates one complete Data Source without Draft/Publish', async () => {
  const calls = [];
  const result = await setupReporting({ db: db(), logger: {} }, {}, { client: api4Client(calls), uuidGenerator: () => 'a17d0001-1234-4567-890a-123456782abc' });
  const sourcePost = calls.find((call) => call.method === 'POST' && call.path === '/data-sources/all');
  assert.equal(sourcePost.body.configs.length, 1);
  assert.equal(sourcePost.body.configs[0].type, 'DataSourceConfiguration');
  assert.equal(sourcePost.body.configs[0].platform, 'Windows');
  assert.deepEqual(sourcePost.body.columns, ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message', 'State File']);
  assert.equal(Object.hasOwn(sourcePost.body, 'status'), false);
  assert.equal(calls.some((call) => call.method === 'PATCH' && call.path.startsWith('/data-sources/')), false);
  assert.equal(result.reporting.dataSource, 'Configured');
});

test('API 4 reporting uses UUID references and preserves built-in 2014 in Details', () => {
  const uuid = 'a17d0001-1234-4567-890a-123456782abc';
  const definitions = buildReportDefinitions(uuid, { apiGeneration: 4 });
  const details = definitions.find((definition) => definition.key === 'details').payload;
  const regular = definitions.find((definition) => definition.key === 'byPolicy').payload;
  assert.equal(details.type, 'Report');
  assert.deepEqual(details.data_sources, [uuid, '2014']);
  assert(details.simple_columns.some((column) => column.data_source_id === uuid));
  assert(details.simple_columns.some((column) => column.data_source_id === '2014'));
  assert(regular.data_sources.every((source) => source === uuid));
  assert(regular.summary_columns.every((column) => column.data_source_id === uuid));
  assert.doesNotThrow(() => validateReportPayload(details, { apiGeneration: 4 }));
});

test('API 4 reporting re-creates a missing Data Source and does not duplicate an existing one', async () => {
  const calls = [];
  const client = api4Client(calls, { sourceId: 'old-source', missing: true });
  await setupReporting({ db: db({ singleton_id: 1, data_source_id: 'old-source' }), logger: {} }, {}, { client, uuidGenerator: () => 'new-source-uuid' });
  assert.equal(calls.filter((call) => call.method === 'POST' && call.path === '/data-sources/all').length, 1);
  assert.equal(calls.some((call) => call.method === 'PATCH' && call.path.startsWith('/data-sources/')), false);
});

test('API 4 reporting reuses a structurally valid Data Source through GET', async () => {
  const calls = [];
  const client = api4Client(calls, { sourceId: 'existing-source' });
  await setupReporting({ db: db({ singleton_id: 1, data_source_id: 'existing-source' }), logger: {} }, {}, { client, uuidGenerator: () => { throw new Error('UUID generation must not run for reuse'); } });
  assert.equal(calls.filter((call) => call.method === 'POST' && call.path === '/data-sources/all').length, 0);
  assert.equal(calls.some((call) => call.method === 'PATCH' && call.path.startsWith('/data-sources/')), false);
});
