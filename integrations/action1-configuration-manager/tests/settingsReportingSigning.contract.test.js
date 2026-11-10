const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Settings.jsx'), 'utf8');
const signingFlowSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'policies', 'signingFlow.js'), 'utf8');

function makeSettingsRequest(invoke, fetch) {
  return async (action, payload) => {
    const response = await fetch(`/api/integrations/action1-configuration-manager/actions/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ? { payload } : {})
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.message || 'Reporting setup failed.');
    return body;
  };
}

test('Settings reporting requests use the Marketplace action payload envelope', () => {
  assert.match(settingsSource, /fetch\(`\/api\/integrations\/\$\{integration\}\/actions\/\$\{action\}`/);
  assert.match(settingsSource, /body:\s*JSON\.stringify\(payload\s*\?\s*\{\s*payload\s*\}\s*:\s*\{\}\)/);
});

test('reporting request sequence preserves signing fields and cancellation stops before setup', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const action = url.split('/').pop();
    return { ok: true, async json() { return action === 'prepare-reporting-signing' ? { ok: true, signingRequired: true, signingId: 'signing-1', digest: 'digest-1', configurationId: 'source-1' } : { ok: true, reporting: { dataSource: 'Configured', reports: 'Configured' } }; } };
  };
  const invoke = makeSettingsRequest(null, fetch);
  const prepared = await invoke('prepare-reporting-signing', { intentId: 'intent-1' });
  assert.deepEqual(calls[0].body, { payload: { intentId: 'intent-1' } });
  assert.deepEqual({ signingId: prepared.signingId, digest: prepared.digest }, { signingId: 'signing-1', digest: 'digest-1' });
  await invoke('setup-reporting', { intentId: 'intent-1', configurationId: prepared.configurationId, signingId: prepared.signingId, digest: prepared.digest });
  assert.deepEqual(calls[1].body, { payload: { intentId: 'intent-1', configurationId: 'source-1', signingId: 'signing-1', digest: 'digest-1' } });
  assert.equal(calls.filter(call => call.url.endsWith('/setup-reporting')).length, 1);
});

test('non-ETP reporting setup remains a direct setup action', () => {
  assert.match(signingFlowSource, /if \(!prepared\.signingRequired\) return invoke\('setup-reporting', payload\)/);
});

test('reporting signing cancellation does not invoke setup-reporting', async () => {
  const { pathToFileURL } = require('node:url');
  const { invokeReportingSigningOperation } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'signingFlow.js')).href);
  const calls = [];
  global.window = { Action1Marketplace: { provisioner: { sign: async () => { throw new Error('Signing cancelled.'); } } } };
  await assert.rejects(() => invokeReportingSigningOperation(async (action) => { calls.push(action); return { signingRequired: true, signingId: 'signing-1', digest: 'digest-1' }; }, 'action1-configuration-manager', {}), /cancelled/);
  assert.deepEqual(calls, ['prepare-reporting-signing']);
});
