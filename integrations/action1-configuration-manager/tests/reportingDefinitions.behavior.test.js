const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { REPORTS, REPORTING_DATA_SOURCE_COLUMNS, buildReportDefinitions } = require('../reporting/reportDefinitions');
const { setupReporting } = require('../reporting/reportingService');

const DATA_SOURCE_ID = 123456789;
const EXPECTED = {
  byEndpoint: { simple: [], summary: ['Endpoint Name'], drilldown: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message'] },
  details: { simple: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted', 'Endpoint Groups'], summary: [], drilldown: [], filters: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Name', 'Configuration Status', 'Remediation Attempted', 'Endpoint Groups'] },
  byControl: { simple: [], summary: ['Control Name'], drilldown: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message', 'State File'] },
  byPolicy: { simple: [], summary: ['Policy Name', 'Policy ID'], drilldown: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version'] },
  byStatus: { simple: [], summary: ['Configuration Status'], drilldown: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At'] },
  dashboardEndpoints: { simple: [], summary: ['Policy Name', 'Policy ID', 'Endpoint Name'], drilldown: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'], filters: [] },
  dashboardNonCompliantEndpoints: { simple: [], summary: ['Endpoint Name', 'Policy ID', 'Policy Name'], drilldown: ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'], filters: ['Configuration Status'] }
};

function makeDb() {
  let row = { singleton_id: 1, data_source_id: String(DATA_SOURCE_ID), report_by_endpoint: null, report_details: null, report_by_control: null, report_by_policy: null, report_by_status: null };
  return { async get() { return row; }, async run(sql, params) { if (sql.startsWith('UPDATE')) row = { ...row, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5] }; } };
}
function makeOriginalFiveDb() {
  const db = makeDb();
  const originalGet = db.get;
  return {
    ...db,
    async get() { return { ...(await originalGet()), report_by_endpoint: 'old-1', report_details: 'old-2', report_by_control: 'old-3', report_by_policy: 'old-4', report_by_status: 'old-5' }; }
  };
}
function finalPayloadClient(postedReports) {
  return { async requestAction1Mutation(input) {
    if (input.method === 'GET' && input.path.includes('/data-sources/')) return { id: String(DATA_SOURCE_ID), status: 'Published' };
    if (input.method === 'POST' && input.path === '/reports/all/custom') { postedReports.push(input.body); return { id: `report-${postedReports.length}` }; }
    if (input.method === 'GET') return { id: input.path.split('/').pop() };
    throw new Error(`Unexpected reporting request: ${input.method} ${input.path}`);
  } };
}
function emptyDb() {
  let row = null;
  return {
    async get() { return row; },
    async run(sql, params) {
      if (sql.startsWith('INSERT')) row = { singleton_id: 1, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5] };
      else if (sql.startsWith('UPDATE')) row = { ...row, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5] };
    }
  };
}
function finalProvisioningClient(captured) {
  let reportId = 0;
  const createdReports = new Set();
  return { async requestAction1Mutation(input) {
    if (input.method === 'POST' && input.path === '/data-sources/all') { captured.dataSourceCreate = input.body; return { id: '555' }; }
    if (input.method === 'PATCH' && input.path === '/data-sources/all/555') { captured.dataSourcePublish = input.body; return { id: '555', status: 'Published' }; }
    if (input.method === 'GET' && input.path === '/data-sources/all/555') return { id: '555', status: 'Published' };
    if (input.method === 'GET' && input.path.startsWith('/reports/all/')) {
      const id = input.path.split('/').pop();
      if (!createdReports.has(id)) throw { statusCode: 404, diagnostics: { responseContentType: 'application/json', errorMessage: 'not found' } };
      return { id, name: 'report' };
    }
    if (input.method === 'POST' && input.path === '/reports/all/custom') { captured.reports.push(input.body); const id = `report-${++reportId}`; createdReports.add(id); return { id }; }
    throw new Error(`Unexpected reporting request: ${input.method} ${input.path}`);
  } };
}
function assertFinalContract(payload) {
  const requiredColumnKeys = ['name', 'enabled', 'sort', 'data_source_id'].sort();
  for (const collectionName of ['simple_columns', 'summary_columns', 'drilldown_columns']) for (const column of payload[collectionName]) {
    assert.deepStrictEqual(Object.keys(column).sort(), requiredColumnKeys);
    assert.strictEqual(typeof column.name, 'string'); assert.notStrictEqual(column.name, '');
    assert.strictEqual(column.enabled, 'yes'); assert.strictEqual(column.sort, 'none');
    assert.strictEqual(Number.isInteger(column.data_source_id), true);
    assert(!Object.prototype.hasOwnProperty.call(column, 'column_name')); assert(!Object.prototype.hasOwnProperty.call(column, 'field'));
  }
  const requiredFilterKeys = ['name', 'value', 'operator', 'data_source_id'].sort();
  for (const filter of payload.filter_set.filters) {
    assert.deepStrictEqual(Object.keys(filter).sort(), requiredFilterKeys);
    assert.strictEqual(typeof filter.name, 'string'); assert.notStrictEqual(filter.name, '');
    assert.strictEqual(filter.value, payload.name === 'Configuration Management - Dashboard Non-Compliant Endpoints' ? 'NonCompliant' : '*'); assert.strictEqual(filter.operator, '=');
    assert.strictEqual(Number.isInteger(filter.data_source_id), true);
    assert(!Object.prototype.hasOwnProperty.call(filter, 'column_name')); assert(!Object.prototype.hasOwnProperty.call(filter, 'field'));
  }
  assert.strictEqual(payload.filter_set.filter_logic, payload.filter_set.filters.map((_, index) => index + 1).join(' AND '));
  assert.deepStrictEqual(payload.column_aliases, []);
  assert(payload.data_sources.every(source => /^\/API\/data_sources\/all\/\d+$/.test(source)));
}

(async () => {
  assert.deepStrictEqual(REPORTING_DATA_SOURCE_COLUMNS, [
    'Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name',
    'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message', 'State File'
  ]);
  const dataSourceScript = fs.readFileSync(path.join(__dirname, '..', 'reporting', 'configuration-management-control-status.ps1'), 'utf8');
  assert(dataSourceScript.includes("'Policy ID','Policy Name','Control ID'"));
  assert(dataSourceScript.includes("$row.'Policy Name' = [string]$state.policyName"));
  assert(dataSourceScript.includes("'State File','A1_Key'"));
  assert(dataSourceScript.indexOf("'A1_Key'") > dataSourceScript.indexOf("'State File'"));
  const definitions = buildReportDefinitions(DATA_SOURCE_ID);
  assert.deepStrictEqual(definitions.map(definition => definition.key), REPORTS.map(report => report.key));
  const postedReports = [];
  await setupReporting({ db: makeDb(), logger: {} }, {}, { client: finalPayloadClient(postedReports) });
  assert.strictEqual(postedReports.length, 7);
  for (const payload of postedReports) {
    assertFinalContract(payload);
    const expected = EXPECTED[REPORTS.find(report => report.name === payload.name).key];
    assert.deepStrictEqual(payload.simple_columns.map(column => column.name), expected.simple);
    assert.deepStrictEqual(payload.summary_columns.map(column => column.name), expected.summary);
    assert.deepStrictEqual(payload.drilldown_columns.map(column => column.name), expected.drilldown);
    assert.deepStrictEqual(payload.filter_set.filters.map(filter => filter.name), expected.filters);
    if (payload.name === 'Configuration Management - Dashboard Non-Compliant Endpoints') assert.strictEqual(payload.filter_set.filters[0].value, 'NonCompliant');
    assert.deepStrictEqual(payload.data_sources, payload.name === 'Configuration Management - Details' ? ['/API/data_sources/all/123456789', '/API/data_sources/all/2014'] : ['/API/data_sources/all/123456789']);
  }
  const missingSupportReports = [];
  await setupReporting({ db: makeOriginalFiveDb(), logger: {} }, {}, { client: finalPayloadClient(missingSupportReports) });
  assert.strictEqual(missingSupportReports.length, 2);
  const captured = { reports: [] };
  await setupReporting({ db: emptyDb(), logger: {} }, {}, { client: finalProvisioningClient(captured) });
  assert.deepStrictEqual(captured.dataSourcePublish.columns, REPORTING_DATA_SOURCE_COLUMNS);
  assert.strictEqual(captured.dataSourcePublish.columns.includes('A1_Key'), false);
  assert(captured.dataSourcePublish.script_text.includes("'Policy ID','Policy Name','Control ID'"));
  assert(captured.dataSourcePublish.script_text.includes("$row.'Policy Name' = [string]$state.policyName"));
  assert.deepStrictEqual(captured.reports.find(report => report.name === 'Configuration Management - by Policy').summary_columns.map(column => column.name), ['Policy Name', 'Policy ID']);
  assert(captured.reports.every(report => {
    const names = [...report.simple_columns, ...report.summary_columns, ...report.drilldown_columns, ...report.filter_set.filters].map(item => item.name);
    return report.name === 'Configuration Management - Details'
      ? names.includes('Policy Name') && names.includes('Policy ID')
      : names.includes('Policy Name') && names.includes('Policy ID');
  }));
  console.log('Reporting final-payload contract behavior passed.');
})().catch(error => { console.error(error); process.exit(1); });
