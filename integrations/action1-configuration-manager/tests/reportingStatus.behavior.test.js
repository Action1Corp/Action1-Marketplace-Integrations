const assert = require('assert');
const { getReportingState, getReportingStatus } = require('../reporting/reportingService');

function dbWithState(row) { return { async get() { return row; } }; }
function stateRow(values) { return { data_source_id: values.dataSourceId || null, report_by_endpoint: values.byEndpoint || null, report_details: values.details || null, report_by_control: values.byControl || null, report_by_policy: values.byPolicy || null, report_by_status: values.byStatus || null, report_dashboard_endpoints: values.dashboardEndpoints || null, report_dashboard_non_compliant_endpoints: values.dashboardNonCompliantEndpoints || null }; }

(async () => {
  const emptyState = await getReportingState({ db: dbWithState(null) });
  assert.deepStrictEqual(emptyState, { hasDataSourceId: false, reportIdsPresent: [] });

  const calls = [];
  let inFlightReports = 0;
  let maxInFlightReports = 0;
  const client = {
    async requestAction1Mutation(input) {
      const id = input.path.split('/').pop();
      if (input.path.includes('/data-sources/')) return { id, status: 'Published' };
      calls.push(id); inFlightReports += 1; maxInFlightReports = Math.max(maxInFlightReports, inFlightReports);
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlightReports -= 1;
      return { id };
    }
  };
  const state = stateRow({ dataSourceId: '100', byEndpoint: '201', details: '202', byControl: '203', byPolicy: '204', byStatus: '205', dashboardEndpoints: '206', dashboardNonCompliantEndpoints: '207' });
  const status = await getReportingStatus({ db: dbWithState(state) }, { client });
  assert.deepStrictEqual(status, { dataSource: 'Configured', reports: 'Configured' });
  assert.strictEqual(calls.length, 7);
  assert(maxInFlightReports > 1, 'report verification should run independently in parallel');
  console.log('Reporting status behavior passed.');
})().catch(error => { console.error(error); process.exit(1); });
