const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { agentDownload, macPkgMetadata, linuxInstallScript, linuxPolicyBody } = require('./agentPackages');
const { normalizePolicy, createIntunePolicyStore } = require('./policyStore');
const { listAction1Organizations } = require('./validate');
const { buildDesiredAssignments, reconcileLinuxPolicySettings } = require('./sync');

test('macOS PKG assignments omit settings unsupported by Intune', () => {
  const macos = buildDesiredAssignments('selectedGroups', ['group-1'], 'macos');
  assert.equal(macos.length, 1);
  assert.equal(macos[0].intent, 'required');
  assert.equal(macos[0].target.groupId, 'group-1');
  assert.equal(Object.hasOwn(macos[0], 'settings'), false);
  assert.equal(buildDesiredAssignments('selectedGroups', ['group-1'], 'windows')[0].settings['@odata.type'], '#microsoft.graph.win32LobAppAssignmentSettings');
});

test('platform download URLs keep each package type and escape organization names', () => {
  assert.deepEqual(agentDownload('macos', 'mac-id', 'Research & Dev', 'https://app.action1.com/'), {
    fileName: 'agent(Research & Dev).pkg',
    downloadUrl: 'https://app.action1.com/agent/mac-id/Mac/agent(Research%20%26%20Dev).pkg'
  });
  assert.match(agentDownload('rpm', 'linux-id', 'Org', 'https://app.action1.com').downloadUrl, /\/Linux\/agent\(Org\)\.rpm$/);
  assert.match(agentDownload('deb', 'linux-id', "O'Brien", 'https://app.action1.com').downloadUrl, /O%27Brien/);
});

test('macOS PKG metadata comes from the XAR table of contents', () => {
  const distribution = zlib.deflateSync(Buffer.from('<installer-gui-script><pkg-ref id="com.action1.agent" version="6.12.3"/></installer-gui-script>'));
  const toc = zlib.deflateSync(Buffer.from(`<xar><toc><file><name>Distribution</name><data><offset>0</offset><length>${distribution.length}</length><encoding style="application/x-gzip"/></data></file></toc></xar>`));
  const header = Buffer.alloc(28);
  header.write('xar!', 0);
  header.writeUInt16BE(28, 4);
  header.writeBigUInt64BE(BigInt(toc.length), 8);
  assert.deepEqual(macPkgMetadata(Buffer.concat([header, toc, distribution])), { bundleId: 'com.action1.agent', version: '6.12.3' });
  assert.throws(() => macPkgMetadata(Buffer.from('<html>')), /PKG/);
});

test('Linux script selects native package manager and Graph policy runs as root', () => {
  const script = linuxInstallScript('https://app.action1.com/agent/deb/Linux/agent(Org).deb', 'https://app.action1.com/agent/rpm/Linux/agent(Org).rpm');
  assert.match(script, /apt-get install -y/);
  assert.match(script, /dnf -y install/);
  assert.match(script, /zypper --non-interactive install/);
  assert.match(script, /tdnf -y install/);
  assert.throws(() => linuxInstallScript('https://example.com/a.deb', 'https://app.action1.com/a.rpm'), /Action1 HTTPS/);
  const body = linuxPolicyBody('Action1 Agent (Linux)', script);
  assert.equal(body.platforms, 'linux');
  assert.equal(body.settings[0].settingInstance.choiceSettingValue.value, 'linux_customconfig_executioncontext_root');
  assert.equal(body.settings[2].settingInstance.choiceSettingValue.value, 'linux_customconfig_executionretries_0');
  assert.equal(Buffer.from(body.settings[3].settingInstance.simpleSettingValue.value, 'base64').toString(), script);
});

test('Linux policy reconciliation updates settings through their navigation URLs', async () => {
  const desired = linuxPolicyBody('Action1 Agent (Linux)', 'new script').settings;
  const existing = desired.map((setting, index) => ({
    id: `setting-${index}`,
    settingInstance: { ...setting.settingInstance }
  }));
  existing[3].settingInstance = {
    ...existing[3].settingInstance,
    simpleSettingValue: { ...existing[3].settingInstance.simpleSettingValue, value: 'old script' }
  };
  const calls = [];
  const graph = {
    get: async url => ({ data: { value: existing } }),
    post: async (...args) => { calls.push(['post', ...args]); },
    patch: async (...args) => { calls.push(['patch', ...args]); }
  };
  await reconcileLinuxPolicySettings(graph, 'https://graph.test/configurationPolicies', 'policy-1', desired, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'patch');
  assert.equal(calls[0][1], 'https://graph.test/configurationPolicies/policy-1/settings/setting-3');
  assert.deepEqual(calls[0][2], { settingInstance: desired[3].settingInstance });
});

test('existing profiles remain Windows-only until edited', () => {
  const policy = normalizePolicy({ policyId: 'ENR-000001', name: 'Legacy', organizationId: '1', organizationName: 'Org', agentId: 'windows' });
  assert.deepEqual(policy.platforms, ['windows']);
  assert.deepEqual(policy.agentIds, { macos: '', deb: '', rpm: '' });
});

test('organization discovery obtains distinct Windows, macOS, and Linux installer IDs', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async url => {
    requests.push(url);
    const kind = String(url).split('/').pop();
    const response = kind === 'organizations?limit=500&from=0'
      ? { items: [{ id: 'org-id', name: 'Org' }] }
      : kind === 'token'
        ? { access_token: 'token' }
        : { download_URL: `https://app.action1.com/agent/${kind}-id/${kind === 'MacPKG' ? 'Mac/agent(Org).pkg' : kind === 'LinuxDEB' ? 'Linux/agent(Org).deb' : 'Windows/agent(Org).msi'}` };
    return { ok: true, json: async () => response };
  };
  try {
    const organizations = await listAction1Organizations({ apiKey: 'id', apiSecret: 'secret' });
    assert.equal(organizations[0].agentId, 'WindowsMSI-id');
    assert.deepEqual(organizations[0].agentIds, { macos: 'MacPKG-id', deb: 'LinuxDEB-id', rpm: 'LinuxDEB-id' });
    assert.equal(requests.filter(url => String(url).includes('/agent-installation/')).length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('organization discovery retries a rate-limited installer without dropping its ID', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async url => {
    const kind = String(url).split('/').pop();
    if (kind === 'token') return { ok: true, json: async () => ({ access_token: 'token' }) };
    if (kind === 'organizations?limit=500&from=0') return { ok: true, json: async () => ({ items: [{ id: 'org-id', name: 'Org' }] }) };
    requests.push(kind);
    if (kind === 'MacPKG' && requests.filter(item => item === 'MacPKG').length === 1) {
      return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ download_URL: `https://app.action1.com/agent/${kind}-id/${kind === 'MacPKG' ? 'Mac/agent(Org).pkg' : kind === 'LinuxDEB' ? 'Linux/agent(Org).deb' : 'Windows/agent(Org).msi'}` }) };
  };
  try {
    const organizations = await listAction1Organizations({ apiKey: 'id', apiSecret: 'secret' });
    assert.deepEqual(organizations[0].agentIds, { macos: 'MacPKG-id', deb: 'LinuxDEB-id', rpm: 'LinuxDEB-id' });
    assert.deepEqual(requests, ['WindowsMSI', 'MacPKG', 'MacPKG', 'LinuxDEB']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('profile save requires installer IDs for selected platforms', async () => {
  const values = new Map();
  const store = createIntunePolicyStore({ settings: { get: async key => values.get(key), set: async (key, value) => values.set(key, value) } });
  const base = { name: 'Org enrollment', organizationId: 'org', organizationName: 'Org', agentId: 'windows', profileType: 'enrollmentOnly' };
  await assert.rejects(store.savePolicy({ ...base, platforms: ['windows', 'macos'] }), /macOS PKG/);
  await assert.rejects(store.savePolicy({ ...base, platforms: ['linux'], agentIds: { deb: 'deb' } }), /Linux DEB and RPM/);
  const saved = await store.savePolicy({ ...base, platforms: ['macos', 'linux'], agentIds: { macos: 'mac', deb: 'linux', rpm: 'linux' } });
  assert.deepEqual(saved.platforms, ['macos', 'linux']);
  const macOnly = await store.savePolicy({ ...base, organizationId: 'mac-org', organizationName: 'Mac Org', name: 'Mac enrollment', agentId: '', platforms: ['macos'], agentIds: { macos: 'mac' } });
  assert.deepEqual(macOnly.platforms, ['macos']);
});
