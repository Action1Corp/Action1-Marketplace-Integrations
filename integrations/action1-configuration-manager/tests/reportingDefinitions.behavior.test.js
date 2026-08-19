const assert = require('assert');
const { REPORTS, buildReportDefinitions } = require('../reporting/reportDefinitions');
const { setupReporting } = require('../reporting/reportingService');

const DATA_SOURCE_ID = 123456789;
const EXPECTED = {
  byEndpoint: { simple: [], summary: ['Endpoint Name'], drilldown: ['Configuration Status', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message'] },
  details: { simple: ['Configuration Status', 'Control ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted', 'Endpoint Groups'], summary: [], drilldown: [], filters: ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Name', 'Configuration Status', 'Remediation Attempted', 'Endpoint Groups'] },
  byControl: { simple: [], summary: ['Control Name'], drilldown: ['Configuration Status', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message', 'State File'] },
  byPolicy: { simple: [], summary: ['Policy ID'], drilldown: ['Configuration Status', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version'] },
  byStatus: { simple: [], summary: ['Configuration Status'], drilldown: ['Configuration Status', 'Control ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted'], filters: ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At'] }
};

function makeDb() {
  let row = { singleton_id: 1, data_source_id: String(DATA_SOURCE_ID), report_by_endpoint: null, report_details: null, report_by_control: null, report_by_policy: null, report_by_status: null };
  return { async get() { return row; }, async run(sql, params) { if (sql.startsWith('UPDATE')) row = { ...row, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5] }; } };
}
function finalPayloadClient(postedReports) {
  return { async requestAction1Mutation(input) {
    if (input.method === 'GET' && input.path.includes('/data-sources/')) return { id: String(DATA_SOURCE_ID), status: 'Published' };
    if (input.method === 'POST' && input.path === '/reports/all/custom') { postedReports.push(input.body); return { id: `report-${postedReports.length}` }; }
    if (input.method === 'GET') return { id: input.path.split('/').pop() };
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
    assert.strictEqual(filter.value, '*'); assert.strictEqual(filter.operator, '=');
    assert.strictEqual(Number.isInteger(filter.data_source_id), true);
    assert(!Object.prototype.hasOwnProperty.call(filter, 'column_name')); assert(!Object.prototype.hasOwnProperty.call(filter, 'field'));
  }
  assert.strictEqual(payload.filter_set.filter_logic, payload.filter_set.filters.map((_, index) => index + 1).join(' AND '));
  assert.deepStrictEqual(payload.column_aliases, []);
  assert(payload.data_sources.every(source => /^\/API\/data_sources\/all\/\d+$/.test(source)));
}

(async () => {
  const definitions = buildReportDefinitions(DATA_SOURCE_ID);
  assert.deepStrictEqual(definitions.map(definition => definition.key), REPORTS.map(report => report.key));
  const postedReports = [];
  await setupReporting({ db: makeDb(), logger: {} }, {}, { client: finalPayloadClient(postedReports) });
  assert.strictEqual(postedReports.length, 5);
  for (const payload of postedReports) {
    assertFinalContract(payload);
    const expected = EXPECTED[REPORTS.find(report => report.name === payload.name).key];
    assert.deepStrictEqual(payload.simple_columns.map(column => column.name), expected.simple);
    assert.deepStrictEqual(payload.summary_columns.map(column => column.name), expected.summary);
    assert.deepStrictEqual(payload.drilldown_columns.map(column => column.name), expected.drilldown);
    assert.deepStrictEqual(payload.filter_set.filters.map(filter => filter.name), expected.filters);
    assert.deepStrictEqual(payload.data_sources, payload.name === 'Configuration Management - Details' ? ['/API/data_sources/all/123456789', '/API/data_sources/all/2014'] : ['/API/data_sources/all/123456789']);
  }
  console.log('Reporting final-payload contract behavior passed.');
})().catch(error => { console.error(error); process.exit(1); });
