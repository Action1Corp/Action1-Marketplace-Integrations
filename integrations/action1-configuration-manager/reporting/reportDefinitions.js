const ACTION1_ENDPOINT_DATA_SOURCE_ID = 2014;
const REPORTING_DATA_SOURCE_COLUMNS = Object.freeze([
  'Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name',
  'Configuration Status', 'Last Checked At', 'Remediation Attempted',
  'Last Remediated At', 'Message', 'State File'
]);

const REPORTS = Object.freeze([
  ['byEndpoint', 'Configuration Management - by Endpoint', 'Shows configuration status grouped by endpoint.'],
  ['details', 'Configuration Management - Details', 'Shows detailed Configuration Management results for individual endpoints and controls.'],
  ['byControl', 'Configuration Management - by Control', 'Shows endpoint configuration status grouped by Configuration Management control.'],
  ['byPolicy', 'Configuration Management - by Policy', 'Shows configuration status grouped by Configuration Management policy.'],
  ['byStatus', 'Configuration Management - by Status', 'Shows Configuration Management results grouped by configuration status.'],
  ['dashboardEndpoints', 'Configuration Management - Dashboard Endpoints', 'Provides one current summary row per Policy and endpoint for Overview aggregation.'],
  ['dashboardNonCompliantEndpoints', 'Configuration Management - Dashboard Non-Compliant Endpoints', 'Provides one summary row per Policy and endpoint with non-compliant Controls.'],
  ['dashboardNonCompliantControls', 'Configuration Management - Dashboard Non-Compliant Controls', 'Provides one summary row per Policy and Control with non-compliant endpoint counts.']
].map(([key, name, description]) => Object.freeze({ key, name, description })));

function numericDataSourceId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Action1 Data Source id must be a positive integer.');
  return id;
}
function resourcePath(dataSourceId) { return `/API/data_sources/all/${numericDataSourceId(dataSourceId)}`; }
function column(dataSourceId, name) { return { name, enabled: 'yes', sort: 'none', data_source_id: numericDataSourceId(dataSourceId) }; }
function filter(dataSourceId, name, value = '*') { return { name, value, operator: '=', data_source_id: numericDataSourceId(dataSourceId) }; }
function filterSet(dataSourceId, names, values = {}) {
  const filters = names.map(name => filter(dataSourceId, name, values[name] || '*'));
  return { filter_logic: filters.map((_, index) => index + 1).join(' AND '), filters };
}
function definition(dataSourceId, key) {
  const endpointFilters = ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At', 'Remediation Attempted', 'Last Remediated At', 'Message'];
  const controlFilters = [...endpointFilters, 'State File'];
  const drill = ['Configuration Status', 'Policy Name', 'Policy ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'];
  const base = { name: REPORTS.find(report => report.key === key).name, description: REPORTS.find(report => report.key === key).description, data_sources: [resourcePath(dataSourceId)], simple_columns: [], summary_columns: [], drilldown_columns: [], column_aliases: [], filter_set: filterSet(dataSourceId, []) };
  if (key === 'byEndpoint') return { ...base, summary_columns: [column(dataSourceId, 'Endpoint Name')], drilldown_columns: drill.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, endpointFilters) };
  if (key === 'details') {
    const simple = ['Configuration Status', 'Policy Name', 'Policy ID', 'Control ID', 'Control Name', 'Control Version', 'Endpoint Name', 'Last Checked At', 'Last Remediated At', 'Message', 'Remediation Attempted'].map(name => column(dataSourceId, name));
    simple.push(column(ACTION1_ENDPOINT_DATA_SOURCE_ID, 'Endpoint Groups'));
    const filters = [...filterSet(dataSourceId, ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Name', 'Configuration Status', 'Remediation Attempted']).filters, filter(ACTION1_ENDPOINT_DATA_SOURCE_ID, 'Endpoint Groups')];
    return { ...base, data_sources: [resourcePath(dataSourceId), resourcePath(ACTION1_ENDPOINT_DATA_SOURCE_ID)], simple_columns: simple, filter_set: { filter_logic: filters.map((_, index) => index + 1).join(' AND '), filters } };
  }
  if (key === 'dashboardEndpoints') {
    return { ...base, summary_columns: ['Policy Name', 'Policy ID', 'Endpoint Name'].map(name => column(dataSourceId, name)), drilldown_columns: drill.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, []) };
  }
  if (key === 'dashboardNonCompliantEndpoints') {
    return { ...base, summary_columns: ['Endpoint Name', 'Policy ID', 'Policy Name'].map(name => column(dataSourceId, name)), drilldown_columns: drill.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, ['Configuration Status'], { 'Configuration Status': 'NonCompliant' }) };
  }
  if (key === 'dashboardNonCompliantControls') {
    return { ...base, summary_columns: ['Policy ID', 'Policy Name', 'Control Name'].map(name => column(dataSourceId, name)), drilldown_columns: drill.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, ['Configuration Status'], { 'Configuration Status': 'NonCompliant' }) };
  }
  const specs = {
    byControl: { summary: ['Control Name'], fields: controlFilters },
    byPolicy: { summary: ['Policy Name', 'Policy ID'], fields: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version'] },
    byStatus: { summary: ['Configuration Status'], fields: ['Endpoint Name', 'Policy ID', 'Policy Name', 'Control ID', 'Control Version', 'Control Name', 'Configuration Status', 'Last Checked At'] }
  };
  const { summary, fields } = specs[key];
  return { ...base, summary_columns: summary.map(name => column(dataSourceId, name)), drilldown_columns: drill.map(name => column(dataSourceId, name)), filter_set: filterSet(dataSourceId, fields) };
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
  const customDataSourceId = Number(String(payload.data_sources[0]).split('/').pop());
  for (const item of [...(payload.simple_columns || []), ...(payload.summary_columns || []), ...(payload.drilldown_columns || []), ...filters]) {
    if ((item.name === 'Policy Name' || item.name === 'Policy ID') && item.data_source_id !== customDataSourceId) throw new Error('Policy identity fields must reference the custom Configuration Management Data Source.');
  }
  if (payload.name === 'Configuration Management - by Policy' && JSON.stringify((payload.summary_columns || []).map(item => item.name)) !== JSON.stringify(['Policy Name', 'Policy ID'])) throw new Error('The by Policy report must summarize by Policy Name and Policy ID.');
  return payload;
}

module.exports = { ACTION1_ENDPOINT_DATA_SOURCE_ID, REPORTING_DATA_SOURCE_COLUMNS, REPORTS, buildReportDefinitions, validateReportPayload };
