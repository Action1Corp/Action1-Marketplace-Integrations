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
  for (const label of ['Top controls needing attention', 'Controls affecting the largest number of endpoints across active policies.', 'No controls currently need attention', 'View non-compliant controls report']) {
    assert(source.includes(label), `Overview should render ${label}`);
  }
  for (const column of ['Policy', 'Assigned', 'Evaluated', 'Compliant', 'Need attention', 'Not fully evaluated', 'Coverage', 'Compliance']) {
    assert(source.includes(column), `Overview should render ${column}`);
  }
  assert(source.includes('get-overview'), 'Overview must consume get-overview');
  assert(source.includes('Refresh'), 'Overview must have a manual Refresh action');
  assert(source.includes('Refreshing...'), 'Overview must show a manual Refresh busy state');
  assert(source.includes('operationType'), 'Overview must distinguish initial load from manual refresh');
  assert(source.includes('maxWidth: 1080'), 'Overview should use the approved analytical content width');
  assert(!source.includes('overflowX'), 'Overview must not force horizontal table scrolling');
  assert(source.includes('Loading Dashboard'), 'Overview must have a loading state');
  assert(source.includes('Set up reporting'), 'Overview must guide reporting setup');
  assert(source.includes('Unable to load Dashboard'), 'Overview must have a safe error state');
  assert(source.includes('Monitor configuration evaluation and compliance across active policies and their assigned Windows endpoints.'), 'Overview must replace placeholder description');
  assert(!source.includes("['Not fully evaluated', TOOLtips.rowIncomplete]"), 'Overview must not use the obsolete table-header label');
  assert(!source.includes('INCONSISTENT'), 'Overview must not expose INCONSISTENT');
  assert(source.includes('buildPolicyDetailsPath'), 'Policy names must use the existing Policy Details route');
  assert(source.includes('buildNonCompliantReportUrl'), 'Need attention links must use the report-link helper');
  assert(source.includes('dashboardNonCompliantControls'), 'Overview must consume the non-compliant controls report ID');
  assert(source.includes('topControlsNeedingAttention'), 'Overview must render backend-provided Top Controls');
  assert(source.includes('>Endpoints<') && source.includes('>Metrics<'), 'Policy table must visually group endpoint and metric columns');
  assert(source.includes("['Partial / No data', TOOLtips.rowIncomplete]"), 'Policy table must use the approved Partial / No data label');
  assert(!source.includes("['Not fully evaluated', TOOLtips.rowIncomplete]"), 'Policy table must not use the obsolete Not fully evaluated header label');
  assert(!source.includes('>RATES<'), 'Policy table must not use the obsolete RATES group label');
  assert(!source.includes('>POLICY<'), 'Policy must not be rendered as a top-level table group');
  assert(source.includes('bar-accent') && source.includes('lvl-hi') && source.includes('lvl-mid') && source.includes('lvl-low'), 'Percentage bars must use semantic visual treatments');
  assert(source.includes('fontSize: 28'), 'KPI values should retain the approved reference scale');
  assert(source.includes('ratioPercent(summary.needsAttentionCount, summary.fullyEvaluatedCount)'), 'Need Attention secondary copy should use evaluated-endpoint percentage');
  assert(source.includes('ratioPercent(summary.notFullyEvaluatedCount, summary.assignedCount)'), 'Not Fully Evaluated secondary copy should use assigned-endpoint percentage');
  assert(source.includes('rowSpan={2}'), 'Policy header cell should span the two table header levels');
  assert(source.includes('numeric >= 90') && source.includes('numeric >= 50') && source.includes('numeric >= 25'), 'Compliance bar thresholds must remain explicit');
  assert(source.includes('hasValue ?') && source.includes('Number.isFinite(numeric)'), 'Only null percentages may omit the progress fill');
  assert(!source.includes('Most affected controls</p>'), 'Top Controls must not render a redundant second title');
  assert(source.includes('Affected endpoints'), 'Top Controls must include the approved count column header');
  assert(source.includes('>Control<') && source.includes('>Policy<'), 'Top Controls must include explicit Control and Policy headers');
  assert(!source.includes('strong>{displayCount(control.affectedEndpointCount)'), 'Top Controls counts must not be bolded');
  assert(source.includes('tableLayout: \'fixed\'') && source.includes('<colgroup>'), 'Dashboard tables must use shared fixed column geometry');
  assert(source.includes('deriveDisplayName') && source.includes('policyDisplayName'), 'Policy labels must use the canonical Policy + Scope display helper');
  assert(source.includes('groupStart: { borderLeft: \'1px solid #E4E8F0\', borderLeftStyle: \'solid\', boxShadow: \'inset 1px 0 #E4E8F0\' }'), 'Policy table must define the approved vertical divider');
  assert(source.includes('.metricsBoundary::before'), 'Metrics boundary must use an independent pseudo-element');
  assert(source.includes('className="metricsBoundary" style={styles.groupTh}>Metrics'), 'Metrics group header must carry the Metrics boundary');
  assert(source.includes("className={index === 5 ? 'metricsBoundary' : undefined}"), 'Coverage header must carry the Metrics boundary');
  assert(source.includes("className={first ? 'metricsBoundary' : undefined} style={styles.td}"), 'Policy Coverage cells must carry the Metrics boundary');
  assert(source.includes("className={index === 6 ? 'metricsBoundary' : undefined}"), 'All policies Coverage cell must carry the Metrics boundary');
  assert(source.includes('dashboard-tip'), 'Dashboard metric labels must be tooltip triggers');
  assert(!source.includes('data-tip={tooltip} tabIndex="0" role="button" aria-label={`${label}: ${tooltip}`} title={tooltip}'), 'Tooltip triggers must not include a duplicate native title tooltip');
  assert(source.includes('border-bottom: 1px dotted #C3CAD8'), 'Tooltip labels must use the approved dotted underline');
  assert(source.includes('.dashboard-tip:hover::after, .dashboard-tip:focus::after'), 'Tooltip labels must work on hover and focus');
  assert(source.includes('overflow: \'visible\', position: \'relative\', zIndex: 0'), 'Dashboard surfaces must not clip tooltip overlays');
  assert(source.includes('z-index: 20'), 'Tooltip overlays must sit above Dashboard surfaces');
  assert(source.includes('tabIndex="0"') && source.includes('role="button"'), 'Tooltip labels must support keyboard focus accessibly');
  assert(!source.includes('InfoBubble'), 'Dashboard must not render standalone information bubbles');
  assert(source.includes('<h2 style={styles.sectionTitle}>Policies</h2>'), 'Policies heading must not contain a tooltip icon');
  assert(source.includes('<h2 id="top-controls-heading" style={styles.sectionTitle}>Top controls needing attention</h2>'), 'Top Controls heading must not contain a tooltip icon');
  assert(source.includes('Operational data for active policies.'), 'Policies subtitle must remain visible');
  assert(source.includes('Controls affecting the largest number of endpoints across active policies.'), 'Top Controls subtitle must remain visible');
  assert(source.includes('TOOLtips.active') && source.includes('TOOLtips.compliance'), 'Approved tooltip content must remain present');
  assert(source.includes('numeric >= 90 ? \'lvl-hi\' : numeric >= 50 ? \'lvl-mid\' : numeric >= 25 ? \'lvl-orange\' : \'lvl-low\''), 'Compliance thresholds must include green, amber, orange, and red states');
  assert(source.includes("tone === 'lvl-orange' ? '#C77C02'") && source.includes("'#B3261E'"), 'Compliance orange and red colors must remain explicit');
  assert(source.includes('!hasValue ? \'metric-null\''), 'Null compliance must remain neutral without a semantic fill');
  assert(source.includes('alignItems: \'flex-end\', gap: 4, minWidth: 58'), 'Coverage and Compliance stacks must use the reference right-aligned layout');
  assert(!source.includes('styles.metricHead') && !source.includes("width: '100%', minWidth: 0"), 'Coverage and Compliance must not use the centered-over-bar variant');
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
