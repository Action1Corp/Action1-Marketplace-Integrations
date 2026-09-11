const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const readSource = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

async function run() {
  const display = JSON.parse(readSource('display.json'));
  const manifest = JSON.parse(readSource('manifest.json'));
  const uiIndex = readSource('ui/index.jsx');
  assert.deepStrictEqual(display.navigation.map((item) => item.label), ['Dashboard', 'Policies', 'History', 'Settings']);
  assert.deepStrictEqual(display.navigation.map((item) => item.path), ['overview', 'policies', 'history', 'settings']);
  assert.strictEqual(manifest.name, 'Configuration Management', 'Integration page metadata must use the meaningful Configuration Management name');
  assert(!display.navigation.some((item) => ['Integration', 'Configuration'].includes(item.label)), 'Navigation must not expose generic page metadata');
  assert(uiIndex.includes('overview: Overview'), 'Existing Dashboard route must remain mapped to Overview internally');
  assert(uiIndex.includes("import Overview from './Overview.jsx';"));

  const source = readSource('ui/Overview.jsx');
  const policiesView = source.slice(source.indexOf('role="table" aria-label="Policies"'), source.indexOf('<div style={styles.sectionHead}><h2 id="top-controls-heading"'));
  for (const label of ['Dashboard', 'Active Policies', 'Need Attention', 'Overall Compliance', 'Evaluation Coverage', 'Policies', 'All policies']) {
    assert(source.includes(label), `Overview should render ${label}`);
  }
  assert(!source.includes('label="Not Fully Evaluated"'), 'Dashboard must not render a dedicated Not Fully Evaluated KPI');
  const kpiSection = source.slice(source.indexOf('<div style={styles.kpis}>'), source.indexOf('<div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Policies</h2>'));
  assert.deepStrictEqual(
    [...kpiSection.matchAll(/label="([^"]+)"/g)].map((match) => match[1]).filter((label) => ['Active Policies', 'Need Attention', 'Overall Compliance', 'Evaluation Coverage'].includes(label)),
    ['Active Policies', 'Need Attention', 'Overall Compliance', 'Evaluation Coverage'],
    'Dashboard KPI cards must retain the approved order'
  );
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
  assert(!source.includes('Loading Dashboard...'), 'Overview must not render the obsolete standalone loading panel');
  assert(source.includes('Loading dashboard data...'), 'Overview must expose a subtle initial data loading status');
  assert(source.includes('Loading policy data...'), 'Policies must expose an inline initial loading state');
  assert(source.includes('Loading control data...'), 'Top Controls must expose an inline initial loading state');
  assert(source.includes('initialLoading'), 'Overview must distinguish initial loading from refresh loading');
  assert(source.includes('aria-busy="true"'), 'Dashboard loading surfaces must expose their busy state');
  assert(source.includes('a1cm-dashboard-spinner'), 'Dashboard loading must reuse the integration spinner pattern');
  assert(source.includes('initialLoading ? <DashboardLoading'), 'Initial KPI values must use loading indicators before overview data exists');
  assert(source.includes('initialLoading ? null : <p'), 'Initial KPI secondary values must remain absent before overview data exists');
  assert(source.includes('Set up reporting'), 'Overview must guide reporting setup');
  assert(source.includes('Unable to load Dashboard'), 'Overview must have a safe error state');
  const description = 'Monitor current configuration evaluation and compliance across active policies and assigned Windows endpoints. Coverage reflects the latest available reporting data and may change as endpoint availability changes.';
  assert(source.includes(description), 'Dashboard must use the approved current-state description');
  assert.strictEqual((source.match(/<p style={styles\.description}>{DESCRIPTION}<\/p>/g) || []).length, 4, 'Each Dashboard render state must have one introductory description');
  assert(!source.includes('Dashboard reflects the latest available configuration results.'), 'Dashboard must not render the former standalone informational paragraph');
  assert(!source.includes('CURRENT_DATA_NOTE') && !source.includes('currentDataNote'), 'Dashboard must not render a second explanatory note');
  assert(source.includes("description: { margin: '0 0 22px', color: '#5A6079', fontSize: 13, lineHeight: 1.5 },"), 'Dashboard description must use the normal page width');
  assert(source.includes("active: 'Enabled Configuration Manager policies included in this Dashboard.'"), 'Active Policies tooltip must use the approved concise copy');
  assert(!source.includes('overlapping scopes'), 'Dashboard must not expose overlapping Policy scope warning copy');
  assert(source.includes("coverage: 'Percentage of assigned endpoints with a complete evaluation in the latest available report data. Coverage may change as endpoint availability and report data are refreshed.'"), 'Evaluation Coverage tooltip must communicate current report state');
  assert(!source.includes("['Not fully evaluated', TOOLtips.rowIncomplete]"), 'Overview must not use the obsolete table-header label');
  assert(!source.includes('INCONSISTENT'), 'Overview must not expose INCONSISTENT');
  assert(source.includes('buildPolicyDetailsPath'), 'Policy names must use the existing Policy Details route');
  assert(source.includes('buildNonCompliantReportUrl'), 'Need attention links must use the report-link helper');
  assert(!source.includes('https://app.action1.com'), 'Dashboard UI must not own the default Action1 host');
  assert(source.includes('dashboardNonCompliantControls'), 'Overview must consume the non-compliant controls report ID');
  assert(source.includes('topControlsNeedingAttention'), 'Overview must render backend-provided Top Controls');
  assert(policiesView.includes('>Endpoints</div>') && policiesView.includes('>Metrics</div>'), 'Policy grid must visually group endpoint and metric columns');
  assert(source.includes("['Partial / No data', TOOLtips.rowIncomplete]"), 'Policy table must use the approved Partial / No data label');
  assert(!source.includes("['Not fully evaluated', TOOLtips.rowIncomplete]"), 'Policy table must not use the obsolete Not fully evaluated header label');
  assert(!source.includes('>RATES<'), 'Policy table must not use the obsolete RATES group label');
  assert(!source.includes('>POLICY<'), 'Policy must not be rendered as a top-level table group');
  assert(source.includes('bar-accent') && source.includes('lvl-hi') && source.includes('lvl-mid') && source.includes('lvl-low'), 'Percentage bars must use semantic visual treatments');
  assert(source.includes('fontSize: 28'), 'KPI values should retain the approved reference scale');
  assert(source.includes('ratioPercent(summary.needsAttentionCount, summary.fullyEvaluatedCount)'), 'Need Attention secondary copy should use evaluated-endpoint percentage');
  assert(source.includes('summary.compliancePercent'), 'Overall Compliance should use the backend aggregate compliancePercent');
  assert(source.includes('summary.fullyEvaluatedCount > 0'), 'Overall Compliance secondary copy must guard the evaluated denominator');
  assert(source.includes('No fully evaluated endpoints'), 'Overall Compliance must explain a zero evaluated population');
  assert(source.includes('complianceFillColor(complianceTone(summary.compliancePercent))'), 'Overall Compliance bar must use Compliance semantic colors');
  assert(source.includes('styles.barFill'), 'Evaluation Coverage must retain its blue progress bar');
  assert(policiesView.includes('gridColumn: \'2 / span 5\'') && policiesView.includes('gridColumn: \'7 / span 2\''), 'Policy grid must span Endpoints columns 2-6 and Metrics columns 7-8');
  assert(!policiesView.includes('rowSpan') && !policiesView.includes('colSpan'), 'Policies layout must not use rowSpan or colSpan');
  assert(source.includes('numeric >= 90') && source.includes('numeric >= 50') && source.includes('numeric >= 25'), 'Compliance bar thresholds must remain explicit');
  assert(source.includes('hasValue ?') && source.includes('Number.isFinite(numeric)'), 'Only null percentages may omit the progress fill');
  assert(!source.includes('Most affected controls</p>'), 'Top Controls must not render a redundant second title');
  assert(source.includes('Affected endpoints'), 'Top Controls must include the approved count column header');
  assert(source.includes('>Control<') && source.includes('>Policy<'), 'Top Controls must include explicit Control and Policy headers');
  assert(!source.includes('strong>{displayCount(control.affectedEndpointCount)'), 'Top Controls counts must not be bolded');
  assert(source.includes('POLICY_GRID_COLUMNS') && source.includes('gridTemplateColumns: POLICY_GRID_COLUMNS'), 'Policies layout must use one shared eight-column grid definition');
  assert(source.includes('deriveDisplayName') && source.includes('policyDisplayName'), 'Policy labels must use the canonical Policy + Scope display helper');
  assert(source.includes('.policiesGrid { position: relative; }'), 'Policies surface must own the structural dividers');
  assert(source.includes('.policyDivider { left: 28%; }') && source.includes('.metricsDivider { left: 80%; }'), 'Structural dividers must use the approved grid boundaries');
  assert((source.match(/className="policyDivider"/g) || []).length === 1 && (source.match(/className="metricsDivider"/g) || []).length === 1, 'Policies surface must own exactly two divider elements');
  assert(source.includes('aria-hidden="true"'), 'Structural divider elements must be presentation-only');
  assert(!policiesView.includes('policyGridBoundary') && !policiesView.includes('metricsBoundary') && !policiesView.includes('groupStart'), 'Policies grid must not retain obsolete per-cell divider hacks');
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
  assert(source.includes("sectionDescription: { margin: '3px 0 0', color: '#5A6079', fontSize: 13, lineHeight: 1.5, maxWidth: 640 },"), 'Dashboard section descriptions must use the readable muted typography step');
  assert(source.includes('TOOLtips.active') && source.includes('TOOLtips.compliance'), 'Approved tooltip content must remain present');
  assert(source.includes('numeric >= 90 ? \'lvl-hi\' : numeric >= 50 ? \'lvl-mid\' : numeric >= 25 ? \'lvl-orange\' : \'lvl-low\''), 'Compliance thresholds must include green, amber, orange, and red states');
  assert(source.includes("tone === 'lvl-orange' ? '#C77C02'") && source.includes("'#B3261E'"), 'Compliance orange and red colors must remain explicit');
  assert(source.includes('!hasValue ? \'metric-null\''), 'Null compliance must remain neutral without a semantic fill');
  assert(source.includes('alignItems: \'flex-end\', gap: 4, minWidth: 58'), 'Coverage and Compliance stacks must use the reference right-aligned layout');
  assert(!source.includes('styles.metricHead') && !source.includes("width: '100%', minWidth: 0"), 'Coverage and Compliance must not use the centered-over-bar variant');
  assert(source.includes('target="_blank"'), 'Action1 report links must open externally');
  assert(!source.includes('reduce('), 'Overview must not aggregate domain metrics in React');

  const reportLink = await import(pathToFileURL(path.join(root, 'ui', 'overviewReportLink.js')).href);
  const url = reportLink.buildNonCompliantReportUrl('report-42', 'org-7', 'https://app.action1.com');
  assert.strictEqual(url, 'https://app.action1.com/console/reports/report-42/summary?limit=200&from=0&live_only=no&details=no&org=org-7&ent=no');
  for (const [origin, expectedHost] of [
    ['https://app.au.action1.com/api/3.0', 'https://app.au.action1.com'],
    ['https://app.eu.action1.com/api/3.0', 'https://app.eu.action1.com']
  ]) {
    const regionalUrl = reportLink.buildNonCompliantReportUrl('report-42', 'org-7', new URL(origin).origin);
    assert(regionalUrl.startsWith(`${expectedHost}/console/reports/`));
    assert(!regionalUrl.includes('/api/3.0/'));
    assert(regionalUrl.endsWith('?limit=200&from=0&live_only=no&details=no&org=org-7&ent=no'));
  }
  assert(!url.includes('policyId=') && !url.includes('group='), 'Report URL must not invent Policy/group filters');
  assert.strictEqual(reportLink.formatPercent(null), '—');
  assert.strictEqual(reportLink.formatPercent(undefined), '—');
  assert.strictEqual(reportLink.formatPercent(66.6666667), '67%');
  assert.strictEqual(reportLink.formatPercent(33.3333333), '33%');
  assert.strictEqual(reportLink.formatPercent(84.4), '84%');
  assert.strictEqual(reportLink.formatPercent(84.5), '85%');
  assert.strictEqual(reportLink.formatPercent(100), '100%');
  assert.strictEqual(reportLink.formatPercent(0), '0%');
  assert(source.includes('formatPercent(ratioPercent(summary.needsAttentionCount, summary.fullyEvaluatedCount))'), 'Need Attention percentage must use the shared display formatter');
  assert(source.includes('formatPercent(summary.evaluationCoveragePercent)'), 'Evaluation Coverage must use the shared display formatter');
  assert((policiesView.match(/formatPercent\(/g) || []).length >= 2, 'Policy table percentage metrics must use the shared display formatter');
  assert(!source.includes('`${summary.evaluationCoveragePercent}%`') && !source.includes('`${summary.compliancePercent}%`'), 'Dashboard must not directly render decimal percentage values');
}

run().catch((error) => { console.error(error); process.exit(1); });
