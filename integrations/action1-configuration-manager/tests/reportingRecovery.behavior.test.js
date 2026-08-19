const assert = require('assert');
const { EXISTENCE, isConclusiveMissing, setupReporting } = require('../reporting/reportingService');

function missingError(id) { return { statusCode: 404, diagnostics: { responseContentType: 'application/json', errorMessage: `resource ${id} not found` } }; }
function unresolvedError() { return { statusCode: 503, diagnostics: { responseContentType: 'application/json', errorMessage: 'temporarily unavailable' } }; }
function makeDb(initial) {
  let row = initial ? { singleton_id: 1, data_source_id: initial.dataSourceId, report_by_endpoint: initial.byEndpoint, report_details: initial.details, report_by_control: initial.byControl, report_by_policy: initial.byPolicy, report_by_status: initial.byStatus } : null;
  return {
    async get() { return row; },
    async run(sql, params) {
      if (sql.startsWith('INSERT')) row = { singleton_id: 1, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5] };
      else if (sql.startsWith('UPDATE')) row = { ...row, data_source_id: params[0], report_by_endpoint: params[1], report_details: params[2], report_by_control: params[3], report_by_policy: params[4], report_by_status: params[5] };
    }
  };
}
function makeClient({ sourceId = 'new-ds', reports = {}, missing = new Set(), unresolved = new Set() } = {}) {
  let createdReport = 0;
  return {
    async requestAction1Mutation(input) {
      const match = input.path.match(/\/([^/]+)$/);
      const id = match && decodeURIComponent(match[1]);
      if (input.method === 'GET') {
        if (unresolved.has(id)) throw unresolvedError();
        if (missing.has(id)) throw missingError(id);
        if (input.path.includes('/data-sources/')) return { id: id || sourceId, status: 'Published' };
        return { id, name: 'report' };
      }
      if (input.path === '/data-sources/all') return { id: sourceId };
      if (input.path.includes('/data-sources/all/')) return { id: sourceId, status: 'Published' };
      createdReport += 1;
      return { id: `new-report-${createdReport}` };
    }
  };
}

(async () => {
  assert.strictEqual(isConclusiveMissing(missingError('x'), 'x'), true);
  assert.strictEqual(isConclusiveMissing(unresolvedError(), 'x'), false);
  const db = makeDb({ dataSourceId: '111', byEndpoint: 'old-1', details: 'old-2', byControl: 'old-3', byPolicy: 'old-4', byStatus: 'old-5' });
  const result = await setupReporting({ db, logger: {} }, {}, { client: makeClient({ sourceId: '333', missing: new Set(['111', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5']) }) });
  assert.strictEqual(result.reporting.dataSource, 'Configured');
  assert.strictEqual(result.reporting.reports, 'Configured');
  assert.strictEqual(result.state.dataSourceId, '333');
  assert.deepStrictEqual([result.state.byEndpoint, result.state.details, result.state.byControl, result.state.byPolicy, result.state.byStatus], ['new-report-1', 'new-report-2', 'new-report-3', 'new-report-4', 'new-report-5']);
  await assert.rejects(() => setupReporting({ db, logger: {} }, {}, { client: makeClient({ sourceId: 'should-not-create', unresolved: new Set(['333']) }) }), /temporarily unavailable/);
  console.log('Reporting recovery behavior passed.');
})().catch(error => { console.error(error); process.exit(1); });
