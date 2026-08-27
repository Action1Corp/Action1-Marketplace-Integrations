const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const readSource = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

async function run() {
  const display = JSON.parse(readSource('display.json'));
  const uiIndex = readSource('ui/index.jsx');
  assert.deepStrictEqual(display.navigation.map((item) => item.label), ['Overview', 'Policies', 'History', 'Settings']);
  assert(uiIndex.includes("import Overview from './Overview.jsx';"));
  assert(uiIndex.includes('overview: Overview'));

  const source = readSource('ui/Overview.jsx');
  for (const label of ['Dashboard', 'Active Policies', 'Need Attention', 'Not Fully Evaluated', 'Evaluation Coverage', 'Policies', 'All policies']) {
    assert(source.includes(label), `Overview should render ${label}`);
  }
  for (const column of ['Policy', 'Assigned', 'Evaluated', 'Compliant', 'Need attention', 'Not fully evaluated', 'Coverage', 'Compliance']) {
    assert(source.includes(column), `Overview should render ${column}`);
  }
  assert(source.includes('get-overview'), 'Overview must consume get-overview');
  assert(source.includes('Refresh'), 'Overview must have a manual Refresh action');
  assert(source.includes('Refreshing...'), 'Overview must show a manual Refresh busy state');
  assert(source.includes('operationType'), 'Overview must distinguish initial load from manual refresh');
  assert(source.includes('maxWidth: 1160'), 'Overview should use the wider analytical content width');
  assert(!source.includes('overflowX'), 'Overview must not force horizontal table scrolling');
  assert(source.includes('Loading Dashboard'), 'Overview must have a loading state');
  assert(source.includes('Set up reporting'), 'Overview must guide reporting setup');
  assert(source.includes('Unable to load Dashboard'), 'Overview must have a safe error state');
  assert(source.includes('Monitor configuration evaluation and compliance across active policies and their assigned Windows endpoints.'), 'Overview must replace placeholder description');
  assert(!source.includes('Partial / No data'), 'Overview must use the canonical aggregate label');
  assert(!source.includes('INCONSISTENT'), 'Overview must not expose INCONSISTENT');
  assert(source.includes('buildPolicyDetailsPath'), 'Policy names must use the existing Policy Details route');
  assert(source.includes('buildNonCompliantReportUrl'), 'Need attention links must use the report-link helper');
  assert(source.includes('target="_blank"'), 'Action1 report links must open externally');
  assert(!source.includes('reduce('), 'Overview must not aggregate domain metrics in React');

  const reportLink = await import(pathToFileURL(path.join(root, 'ui', 'overviewReportLink.js')).href);
  const url = reportLink.buildNonCompliantReportUrl('report-42', 'org-7');
  assert.strictEqual(url, 'https://app.action1.com/console/reports/report-42/summary?limit=200&from=0&live_only=no&details=no&org=org-7&ent=no');
  assert(!url.includes('policyId=') && !url.includes('group='), 'Report URL must not invent Policy/group filters');
  assert.strictEqual(reportLink.formatPercent(null), '—');
  assert.strictEqual(reportLink.formatPercent(84), '84%');
}

run().catch((error) => { console.error(error); process.exit(1); });
