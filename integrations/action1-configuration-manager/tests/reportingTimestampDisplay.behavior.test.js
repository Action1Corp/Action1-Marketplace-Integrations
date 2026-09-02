const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReportDefinitions, REPORTING_DATA_SOURCE_COLUMNS } = require('../reporting/reportDefinitions');

const scriptPath = path.join(__dirname, '..', 'reporting', 'configuration-management-control-status.ps1');
const canonical = '2026-08-31T17:27:11.8740746Z';
const expectedCanonical = 'Aug 31, 2026 5:27 PM UTC';

function runDataSource(states) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'action1-cm-reporting-'));
  const statePath = path.join(root, 'state.json');
  const testScriptPath = path.join(root, 'configuration-management-control-status.ps1');
  fs.writeFileSync(statePath, JSON.stringify(states), 'utf8');
  const source = fs.readFileSync(scriptPath, 'utf8').replace('C:\\Windows\\Action1\\ConfigurationManager', root.replace(/\\/g, '\\\\'));
  fs.writeFileSync(testScriptPath, source, 'utf8');
  const command = `& '${testScriptPath.replace(/'/g, "''")}' | ConvertTo-Json -Depth 8`;
  try {
    const output = childProcess.execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
    return { row: JSON.parse(output), original: JSON.parse(fs.readFileSync(statePath, 'utf8')) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const { row, original } = runDataSource({
  policyId: 'POL-1', policyName: 'Policy', controlId: 'CTRL-1', controlVersion: '1', controlName: 'Control',
  status: 'Compliant', lastCheckedAt: canonical, remediationAttempted: true,
  lastRemediatedAt: '2025-01-02T03:04:05Z', message: 'ok'
});
assert.strictEqual(row['Last Checked At'], expectedCanonical);
assert.strictEqual(row['Last Remediated At'], 'Jan 02, 2025 3:04 AM UTC');
assert.strictEqual(original.lastCheckedAt, canonical, 'canonical state must remain ISO');
assert.strictEqual(original.lastRemediatedAt, '2025-01-02T03:04:05Z', 'canonical remediation state must remain ISO');
assert.strictEqual(row['Policy ID'], 'POL-1');
assert.strictEqual(row['Configuration Status'], 'Compliant');

const edge = runDataSource({
  policyId: 'POL-2', controlId: 'CTRL-2', lastCheckedAt: 'not-a-date', lastRemediatedAt: 'Aug 31, 2026 5:27 PM UTC',
  remediationAttempted: false
}).row;
assert.strictEqual(edge['Last Checked At'], 'not-a-date', 'malformed timestamps must safely fall back');
assert.strictEqual(edge['Last Remediated At'], 'Aug 31, 2026 5:27 PM UTC', 'already-formatted values must safely fall back unchanged');

const empty = runDataSource({ policyId: 'POL-3', controlId: 'CTRL-3', lastCheckedAt: '', lastRemediatedAt: null }).row;
assert.strictEqual(empty['Last Checked At'], null);
assert.strictEqual(empty['Last Remediated At'], null);

const missing = runDataSource({ policyId: 'POL-4', controlId: 'CTRL-4' }).row;
assert.strictEqual(missing['Last Checked At'], null);
assert.strictEqual(missing['Last Remediated At'], null);

const source = fs.readFileSync(scriptPath, 'utf8');
assert.strictEqual((source.match(/ConvertTo-A1CMDisplayTimestamp/g) || []).length, 3, 'one formatter should be reused for both timestamp fields');
assert(source.includes("$row.'Last Checked At' = ConvertTo-A1CMDisplayTimestamp"));
assert(source.includes("$row.'Last Remediated At' = ConvertTo-A1CMDisplayTimestamp"));
assert(source.includes("$row.'Last Checked At' = [string]$state.lastCheckedAt"), 'raw value should be captured before display projection');
assert.deepStrictEqual(REPORTING_DATA_SOURCE_COLUMNS.filter(name => /Checked|Remediated/.test(name)), ['Last Checked At', 'Last Remediated At']);
assert(buildReportDefinitions(123).every(definition => [...definition.payload.simple_columns, ...definition.payload.summary_columns, ...definition.payload.drilldown_columns].every(column => column.sort === 'none')), 'reports must not declare lexical timestamp sorting');

console.log('Reporting timestamp display behavior passed.');
