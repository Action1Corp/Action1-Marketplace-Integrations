const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'History.jsx'), 'utf8');
const adapterSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'historyAdapter.js'), 'utf8');
for (const header of ['Date & time', 'Operation', 'Policy', 'Organization', 'Result', 'Summary', 'Actions']) assert(source.includes(header));
for (const forbidden of ['Operation filter', 'Result filter', 'Search', 'Show all']) assert(!source.includes(forbidden));
assert(source.includes('Control Family changes'));
assert(source.includes('FamilyChangeList'));
assert(source.includes('policyGroups.length > 1'));
assert(source.includes('HISTORY_PAGE_SIZES'));
assert(source.includes('getCompactHistorySummary'), 'History table should use concise counter summaries');
assert(source.includes("column === 'Actions' ? '' : column"), 'History Actions header should remain semantically present but visually blank');
assert(source.includes('textOverflow: \'ellipsis\''), 'History table should truncate long values without increasing row height');
assert(source.includes('tableLayout: \'fixed\''), 'History table should preserve predictable compact column widths');
assert(source.includes('maxWidth: 1080'), 'History should use a modestly wider audit-table container');
assert(source.includes('overflow: \'visible\''), 'Date & time should not be ellipsized');
assert(adapterSource.includes("'Scheduled reconciliation': 'Reconciliation'"), 'scheduled reconciliation should use the concise customer-facing label');
assert(!source.includes('sortDirection=desc')); // adapter owns request construction
console.log('Configuration Manager History UI contract passed.');
