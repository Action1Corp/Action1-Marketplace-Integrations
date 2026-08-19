const ACTION1_ENDPOINT_DATA_SOURCE_ID = 2014;
const REPORTING_DATA_SOURCE_COLUMNS = Object.freeze([
  'Endpoint Name', 'Policy ID', 'Control ID', 'Control Version', 'Control Name',
  'Configuration Status', 'Last Checked At', 'Remediation Attempted',
  'Last Remediated At', 'Message', 'State File'
]);

const REPORTS = Object.freeze([
  ['byEndpoint', 'Configuration Management - by Endpoint', 'Shows configuration status grouped by endpoint.'],
  ['details', 'Configuration Management - Details', 'Shows detailed Configuration Management results for individual endpoints and controls.'],
  ['byControl', 'Configuration Management - by Control', 'Shows endpoint configuration status grouped by Configuration Management control.'],
  ['byPolicy', 'Configuration Management - by Policy', 'Shows configuration status grouped by Configuration Management policy.'],
  ['byStatus', 'Configuration Management - by Status', 'Shows Configuration Management results grouped by configuration status.']
].map(([key, name, description]) => Object.freeze({ key, name, description })));

function numericDataSourceId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Action1 Data Source id must be a positive integer.');
  return id;
}
function resourcePath(dataSourceId) { return `/API/data_sources/all/${numericDataSourceId(dataSourceId)}`; }
function column(dataSourceId, name) { return { name, enabled: 'yes', sort: 'none', data_source_id: numericDataSourceId(dataSourceId) }; }
function filter(dataSourceId, name) { return { name, value: '*', operator: '=', data_source_id: numericDataSourceId(dataSourceId) }; }
function filterSet(dataSourceId, names) {
  const filters = names.map(name => filter(dataSourceId, name));
  return { filter_logic: filters.map((_, index) => index + 1).join(' AND '), filters };
}
function definition(dataSourceId, key) {
  const endpointFilters = ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message'];
  const controlFilters = [...endpointFilters, 'State File'];
  const drill = ['Configuration Status', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted'];
  const base = { name: REPORTS.find(report => report.key === key).name, description: REPORTS.find(report => report.key === key).description, data_sources: [resourcePath(dataSourceId)], simple_columns: [], summary_columns: [], drilldown_columns: [], column_aliases: [], filter_set: filterSet(dataSourceId, []) };
  if (key === 'byEndpoint') return { ...base, summary_columns: [column(dataSourceId, 'Endpoint Name')], drilldown_columns: drill.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, endpointFilters) };
  if (key === 'details') {
    const simple = ['Configuration Status', 'Control ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Policy ID', 'Remediation Attempted'].map(name => column(dataSourceId, name));
    simple.push(column(ACTION1_ENDPOINT_DATA_SOURCE_ID, 'Endpoint Groups'));
    const filters = [...filterSet(dataSourceId, ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Name', 'Configuration Status', 'Remediation Attempted']).filters, filter(ACTION1_ENDPOINT_DATA_SOURCE_ID, 'Endpoint Groups')];
    return { ...base, data_sources: [resourcePath(dataSourceId), resourcePath(ACTION1_ENDPOINT_DATA_SOURCE_ID)], simple_columns: simple, filter_set: { filter_logic: filters.map((_, index) => index + 1).join(' AND '), filters } };
  }
  const specs = { byControl: ['Control Name', controlFilters], byPolicy: ['Policy ID', ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version']], byStatus: ['Configuration Status', ['Endpoint Name', 'Policy ID', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At']] };
  const [summary, fields] = specs[key];
  const drilldown = key === 'byStatus' ? ['Configuration Status', 'Control ID', ...drill.slice(1)] : drill;
  return { ...base, summary_columns: [column(dataSourceId, summary)], drilldown_columns: drilldown.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, fields) };
}

function buildReportDefinitions(dataSourceId) {
  numericDataSourceId(dataSourceId);
  return REPORTS.map(report => ({ ...report, payload: definition(dataSourceId, report.key) }));
}

function validateReportPayload(payload) {
  const columnKeys = ['data_source_id', 'enabled', 'name', 'sort'].sort();
  for (const collectionName of ['simple_columns', 'summary_columns', 'drilldown_columns']) {
    for (const item of payload?.[collectionName] || []) {
      if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(columnKeys)) throw new Error(`${collectionName} contains an invalid column shape.`);
      if (typeof item.name !== 'string' || !item.name) throw new Error(`${collectionName} contains an empty column name.`);
      if (item.enabled !== 'yes' || item.sort !== 'none' || !Number.isInteger(item.data_source_id)) throw new Error(`${collectionName} contains an invalid column.`);
    }
  }
  const filters = payload?.filter_set?.filters;
  const filterKeys = ['data_source_id', 'name', 'operator', 'value'].sort();
  if (!Array.isArray(filters)) throw new Error('Report filter_set.filters is required.');
  for (const item of filters) {
    if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(filterKeys)) throw new Error('Report filter contains an invalid shape.');
    if (typeof item.name !== 'string' || !item.name || typeof item.value !== 'string' || item.operator !== '=' || !Number.isInteger(item.data_source_id)) throw new Error('Report filter contains an invalid value.');
  }
  const expectedLogic = filters.map((_, index) => index + 1).join(' AND ');
  if (payload.filter_set.filter_logic !== expectedLogic) throw new Error('Report filter_logic does not match filter count.');
  if (!Array.isArray(payload.column_aliases) || payload.column_aliases.length !== 0) throw new Error('Report column_aliases must be empty.');
  if (!Array.isArray(payload.data_sources) || payload.data_sources.some(source => !/^\/API\/data_sources\/all\/\d+$/.test(source))) throw new Error('Report data_sources contains an invalid resource reference.');
  return payload;
}

module.exports = { ACTION1_ENDPOINT_DATA_SOURCE_ID, REPORTING_DATA_SOURCE_COLUMNS, REPORTS, buildReportDefinitions, validateReportPayload };
