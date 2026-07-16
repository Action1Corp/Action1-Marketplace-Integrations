const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Dashboard.jsx'), 'utf8').replace(/\r\n/g, '\n');

  assert(source.includes('<h1 className="page-title" style={styles.title}>Microsoft Entra Device Groups Sync</h1>'), 'Dashboard.jsx should render the approved Entra Sync page title inside the centered page shell');
  assert(source.includes('Run and monitor synchronization of Microsoft Entra device groups and ownership into Action1 endpoint custom attributes.'), 'Dashboard.jsx should render the approved Sync page purpose text');
  assert(source.includes('const styles = {'), 'Dashboard.jsx should define a local card-shell style map like the Jira reference');
  assert(source.includes("maxWidth: 820"), 'Dashboard.jsx should use the constrained centered shell width from the Jira Sync reference');
  assert(source.includes("margin: '0 auto'"), 'Dashboard.jsx should center the Entra Sync page like the Jira Sync page');
  assert(source.includes("display: 'grid',\n    gap: '0.5rem'"), 'Dashboard.jsx should use the same page-shell grid gap as the Jira Sync page');
  assert(source.includes("gridTemplateColumns: 'minmax(0, 1fr) minmax(440px, 480px)'"), 'Dashboard.jsx should give the Totals panel enough width to keep the totals panel clearly separated');
  assert(source.includes("gridTemplateColumns: 'repeat(3, minmax(92px, 1fr))'"), 'Dashboard.jsx should keep three equal aligned totals counters with enough minimum width for single-line labels');
  assert(source.includes("gap: '0.75rem'"), 'Dashboard.jsx should keep clear horizontal spacing between totals counters');
  assert(source.includes("whiteSpace: 'nowrap'"), 'Dashboard.jsx should keep Totals labels on a single line');
  assert(source.includes('Sync Status'), 'Dashboard.jsx should render the Sync Status card');
  assert(source.includes('Last completed run'), 'Dashboard.jsx should render the Last completed run card');
  assert(source.includes('Scheduler'), 'Dashboard.jsx should render the Scheduler card');
  assert(source.includes('Run Sync'), 'Dashboard.jsx should render the manual sync action label');
  assert(source.includes('Syncing...'), 'Dashboard.jsx should render the running action label');
  assert(source.includes('Enable scheduled sync'), 'Dashboard.jsx should render the scheduler toggle');
  assert(source.includes('Every 24 hours'), 'Dashboard.jsx should render the approved 24-hour scheduler option');
  assert(source.includes('Every 12 hours'), 'Dashboard.jsx should render the approved 12-hour scheduler option');
  assert(source.includes('Run synchronization and monitor the latest synchronization status.'), 'Dashboard.jsx should render only the approved static Sync Status description');
  assert(source.includes('latestRunTimestampLabel'), 'Dashboard.jsx should source the last-run timestamp label from the tracked-run state so it can use Started by default and Finished only when separately persisted');
  assert(source.includes('Result:'), 'Dashboard.jsx should surface the latest run result in the compact context field list');
  assert(source.includes('Trigger:'), 'Dashboard.jsx should surface the latest run trigger');
  assert(source.includes('Totals'), 'Dashboard.jsx should render the Totals heading');
  assert(source.includes('Synced'), 'Dashboard.jsx should render the Synced total label');
  assert(source.includes('Skipped'), 'Dashboard.jsx should render the Skipped total label');
  assert(source.includes('Failed'), 'Dashboard.jsx should render the Failed total label');
  assert(source.includes('Synced — Action1 endpoints successfully updated with Microsoft Entra group and ownership data.'), 'Dashboard.jsx should expose the approved Synced tooltip definition');
  assert(source.includes('Skipped — devices not updated because no unique name match was found, including unmatched, ambiguous, or endpoint-reuse conflicts.'), 'Dashboard.jsx should expose the approved Skipped tooltip definition');
  assert(source.includes('Failed — matched Action1 endpoints whose update returned an endpoint-specific error; review run diagnostics for details.'), 'Dashboard.jsx should expose the approved Failed tooltip definition');
  assert(source.includes('aria-label="Totals help"'), 'Dashboard.jsx should render an accessible Totals help control');
  assert(source.includes('title={text}'), 'Dashboard.jsx should expose the Totals help text through hover and focus tooltip behavior');
  assert(source.includes('Completed with issues'), 'Dashboard.jsx should support the Completed with issues customer-facing label');
  assert(source.includes('<span style={{ ...styles.statusValue, ...stateTone }}>{state.label}</span>'), 'Dashboard.jsx should render the current Sync state as toned text instead of a filled status pill');
  assert(source.includes('<span style={{ ...styles.statusValue, ...resultTone }}>{resultLabel}</span>'), 'Dashboard.jsx should render the latest Sync result as toned text instead of a filled status pill');
  assert(source.includes('Save scheduler settings'), 'Dashboard.jsx should let write-capable operators save the Marketplace scheduler state');
  assert(source.includes('Refresh status'), 'Dashboard.jsx should expose the status refresh action like the Jira reference');
  assert(source.includes('list-entra-org-mappings'), 'Dashboard.jsx should use the existing mapping action to determine sync readiness');
  assert(source.includes('storedSecrets'), 'Dashboard.jsx should consume stored secret markers from /api/settings when computing readiness');
  assert(source.includes("label: 'Synced', value: latestSummary.endpointsSynchronized"), 'Dashboard.jsx should map Synced totals from endpoints synchronized');
  assert(source.includes("label: 'Skipped', value: latestSummary.skipped"), 'Dashboard.jsx should map Skipped totals from the runtime skipped count');
  assert(source.includes("label: 'Failed', value: latestSummary.failedEndpointUpdates"), 'Dashboard.jsx should map Failed totals from failed endpoint updates');
  assert(!source.includes("label: 'Organizations', value: latestSummary.mappedAction1OrganizationsProcessed"), 'Dashboard.jsx should not duplicate mapped organizations inside Totals');
  assert(!source.includes('{state.message}'), 'Dashboard.jsx should not render dynamic readiness or configuration guidance in the static Sync Status description');
  assert(!source.includes('Readiness is based on'), 'Dashboard.jsx should not expose readiness calculation details');
  assert(!source.includes('Configuration and organization mappings are ready.'), 'Dashboard.jsx should not render readiness success guidance');
  assert(!source.includes('Complete Settings and Organization Mapping before running synchronization.'), 'Dashboard.jsx should not render static configuration guidance');
  assert(!source.includes('Organizations processed:'), 'Dashboard.jsx should not keep organizations processed in the left context list');
  assert(!source.includes('Entra devices evaluated:'), 'Dashboard.jsx should not keep Entra devices evaluated in the left context list');
  assert(!source.includes('Action1 endpoints evaluated:'), 'Dashboard.jsx should not keep Action1 endpoints evaluated in the left context list');
  assert(!source.includes('Endpoints synchronized'), 'Dashboard.jsx should not keep the previous long total label');
  assert(!source.includes('Failed endpoint updates'), 'Dashboard.jsx should not keep the previous long failed-total label');
  assert(!source.includes('Schedule key:'), 'Dashboard.jsx should not render internal scheduler keys');
  assert(!source.includes('CronSchedule_'), 'Dashboard.jsx should not expose the Marketplace cron schedule setting key');
  assert(!source.includes('CronTimezone_'), 'Dashboard.jsx should not expose the Marketplace timezone setting key');
  assert(!source.includes('Scheduler settings saved.'), 'Dashboard.jsx should not render a persistent scheduler-saved success message');
  assert(!source.includes('Entra ID Dashboard'), 'Dashboard.jsx should not keep the old Dashboard title');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
