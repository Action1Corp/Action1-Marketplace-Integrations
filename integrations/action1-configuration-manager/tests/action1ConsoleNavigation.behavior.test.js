const assert = require('assert');
const { buildAction1ConsoleAutomationUrl } = require('../policyStore');

const name = 'A1CM — POL-000123 — Workstation Security — Removable Storage';
const url = buildAction1ConsoleAutomationUrl('https://eu.action1.example', 'org-1', name);
const parsed = new URL(url);

assert.strictEqual(parsed.origin, 'https://eu.action1.example');
assert.strictEqual(parsed.pathname, '/console/automations');
assert.strictEqual(parsed.searchParams.get('org'), 'org-1');
assert.strictEqual(parsed.searchParams.get('filter'), encodeURIComponent(name));
assert(!url.includes('/api/3.0/'));
