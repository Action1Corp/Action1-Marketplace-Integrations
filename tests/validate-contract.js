const assert = require('assert');
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'integrations'),
  path.join(__dirname, '..', 'developer', 'examples')
];

async function run() {
  for (const root of roots) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const integrationDir = path.join(root, entry.name);
    const manifestPath = path.join(integrationDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'capabilities'), `${manifest.id}: capabilities are inferred and should not be in manifest.json`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'marketplaceActions'), `${manifest.id}: marketplaceActions should not be in manifest.json`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'hostServices'), `${manifest.id}: hostServices should not be in manifest.json`);
    assert(!Object.prototype.hasOwnProperty.call(manifest, 'settings'), `${manifest.id}: settings belong in ui/settingsSchema.json`);
    const displayPath = path.join(integrationDir, 'display.json');
    const handlerPath = path.join(integrationDir, manifest.entry || 'index.js');
    const migrationsDir = path.join(integrationDir, 'migrations');
    assert(fs.existsSync(handlerPath), `${manifest.id}: handler file should exist`);
    assert(fs.existsSync(path.join(integrationDir, 'README.md')), `${manifest.id}: README.md should exist`);
    if (fs.existsSync(migrationsDir)) {
      const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql'));
      for (const migration of migrations) {
        assert(/^\d{3,}_[a-z0-9_]+\.sql$/.test(migration), `${manifest.id}: migration ${migration} should use 001_description.sql naming`);
      }
    }

    const handlerSource = fs.readFileSync(handlerPath, 'utf8');
    assert(!handlerSource.includes("require('../database')"), `${manifest.id}: must not import Marketplace database`);
    assert(!handlerSource.includes("require('./nvdService')"), `${manifest.id}: must not import Marketplace NVD service`);
    assert(!handlerSource.includes('context.legacy'), `${manifest.id}: must not use legacy runtime bridge`);
    assert(!handlerSource.includes('context.db.tables'), `${manifest.id}: must own table names instead of using Marketplace table helpers`);

    const handler = require(handlerPath);
    if (Array.isArray(manifest.actions) && manifest.actions.length > 0) {
      assert(handler.actions && typeof handler.actions === 'object', `${manifest.id}: manifest actions require exported action handlers`);
      for (const action of manifest.actions) {
        assert.strictEqual(typeof handler.actions[action.id], 'function', `${manifest.id}: action ${action.id} requires a handler`);
      }
    }
    const validateAction = Array.isArray(manifest.actions) && manifest.actions.find(action => action.kind === 'validate');
    if (validateAction) {
      assert.strictEqual(typeof handler.actions[validateAction.id], 'function', `${manifest.id}: validate action ${validateAction.id} requires a handler`);
      const result = await handler.actions[validateAction.id]({
        integrationId: manifest.id,
        action1: {
          getCredentials: async () => ({ apiKey: '', apiSecret: '', organizationId: '' })
        },
        logger: console
      }, {
        settings: {},
        payload: {},
        run: null
      });
      assert(result && typeof result === 'object', `${manifest.id}: validate action should return an object`);
      assert(Object.prototype.hasOwnProperty.call(result, 'ok'), `${manifest.id}: validate action should return an ok field`);
    }

    const syncAction = Array.isArray(manifest.actions) && manifest.actions.find(action => action.kind === 'sync');
    if (syncAction) {
      assert.strictEqual(typeof handler.actions[syncAction.id], 'function', `${manifest.id}: sync action ${syncAction.id} requires a handler`);
    }

    if (fs.existsSync(displayPath)) {
      const display = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
      assert(Array.isArray(display.navigation) && display.navigation.length > 0, `${manifest.id}: display.json should define navigation`);
      for (const key of Object.keys(display)) {
        assert.strictEqual(key, 'navigation', `${manifest.id}: display.json should only define marketplace navigation; move screen UI metadata into React views`);
      }
    }
  }
  }

  const rapid7SyncSource = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'rapid7', 'sync.js'), 'utf8');
  assert(
    rapid7SyncSource.includes('fetchAction1EndpointVulnCounts'),
    'rapid7: sync must fetch endpoint-level Action1 vulnerability counts so Action1-only endpoints do not show zero vulnerabilities'
  );
  assert(
    rapid7SyncSource.includes('?endpoint_id=${endpointId}&limit=${limit}&from=${offset}'),
    'rapid7: Action1 vulnerability lookup must be scoped by endpoint_id'
  );
  assert(
    rapid7SyncSource.includes('action1_critical_vulns') && rapid7SyncSource.includes('action1_high_vulns') && rapid7SyncSource.includes('action1_medium_vulns') && rapid7SyncSource.includes('action1_low_vulns'),
    'rapid7: sync must persist Action1 vulnerability severity counts'
  );
  assert(
    rapid7SyncSource.includes('Loaded Action1 endpoint vulnerability counts for'),
    'rapid7: sync must log Action1 endpoint vulnerability count success/failure totals'
  );
  assert(
    rapid7SyncSource.includes("source = rapid7Cve && action1Cve ? 'Both' : action1Cve ? 'Action1' : 'VM Scanner'"),
    'rapid7: endpoint CVE rows must preserve whether a CVE came from Rapid7, Action1, or both'
  );

  const intuneDashboardSource = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'intune', 'ui', 'IntuneDashboard.jsx'), 'utf8');
  assert(
    intuneDashboardSource.includes('selectedPolicyResult?.intuneDeployment || (selectedPolicyIsActive ? data : selectedPolicyResult)'),
    'intune: dashboard assignment targeting must use the selected policy deployment instead of top-level active-policy data'
  );
  assert(
    intuneDashboardSource.includes(".map(device => ({ ...device, profileName: selectedPolicy?.name || '' }))") &&
      intuneDashboardSource.includes("{ key: 'profileName', label: 'Profile'"),
    'intune: dashboard endpoint rows must identify the selected profile'
  );
  assert(
    !intuneDashboardSource.includes('Agent Deployment') &&
      !intuneDashboardSource.includes('Latest Action1 Agent Version') &&
      !intuneDashboardSource.includes('Application Details'),
    'intune: dashboard must not render the obsolete single-agent deployment panel'
  );
  assert(
    intuneDashboardSource.includes('/api/integrations/intune/actions/list-policies') &&
      intuneDashboardSource.includes('mergePoliciesIntoDashboard(statusJson, policies)'),
    'intune: dashboard must load profile definitions even before the first status sync writes IntuneVersionData'
  );
  const intuneSyncSource = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'intune', 'sync.js'), 'utf8');
  assert(
    intuneSyncSource.includes('(isInSelectedAction1ProvisioningGroup(endpoint) || endpoint.provisioningCompletedByAttribute)'),
    'intune: completed-by-attribute endpoints must still be scanned for recent Action1 automation results'
  );
  assert(
    intuneSyncSource.includes('endpoint.automationResults = latestAutomationResults.length ? latestAutomationResults : previousAutomationResults'),
    'intune: completed-by-attribute endpoints must preserve automation result evidence instead of clearing it'
  );

  for (const integrationId of ['defender', 'qualys', 'tenable']) {
    const syncSource = fs.readFileSync(path.join(__dirname, '..', 'integrations', integrationId, 'sync.js'), 'utf8');
    assert(
      syncSource.includes('fetchAction1EndpointVulnCounts'),
      `${integrationId}: sync must fetch endpoint-level Action1 vulnerability counts so Action1-only endpoints do not show zero vulnerabilities`
    );
    assert(
      syncSource.includes('?endpoint_id=${endpointId}&limit=${limit}&from=${offset}'),
      `${integrationId}: Action1 vulnerability lookup must be scoped by endpoint_id`
    );
    assert(
      syncSource.includes('action1_critical_vulns') && syncSource.includes('action1_high_vulns') && syncSource.includes('action1_medium_vulns') && syncSource.includes('action1_low_vulns'),
      `${integrationId}: sync must persist Action1 vulnerability severity counts`
    );
    assert(
      syncSource.includes('Loaded Action1 endpoint vulnerability counts for'),
      `${integrationId}: sync must log Action1 endpoint vulnerability count success/failure totals`
    );
  }

  const tenableSyncSource = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'tenable', 'sync.js'), 'utf8');
  assert(
    tenableSyncSource.includes("source = tenableCve && action1Cve ? 'Both' : action1Cve ? 'Action1' : 'VM Scanner'"),
    'tenable: endpoint CVE rows must preserve whether a CVE came from Tenable, Action1, or both'
  );
  assert(
    fs.existsSync(path.join(__dirname, '..', 'integrations', 'tenable', 'migrations', '002_add_endpoint_cve_source.sql')),
    'tenable: must migrate existing endpoint CVE rows to include source'
  );

  for (const integrationId of ['defender', 'qualys', 'rapid7', 'tenable']) {
    const integrationDir = path.join(__dirname, '..', 'integrations', integrationId);
    const syncSource = fs.readFileSync(path.join(integrationDir, 'sync.js'), 'utf8');
    assert(syncSource.includes('discoverAction1Inventory'), `${integrationId}: sync must discover every accessible Action1 organization`);
    assert(!syncSource.includes('organizationId:'), `${integrationId}: sync must not depend on a default Action1 organization ID`);
    assert(syncSource.includes('action1_organization_id'), `${integrationId}: sync must persist the Action1 organization identity`);
    assert(
      fs.existsSync(path.join(integrationDir, 'migrations', '003_add_action1_organization.sql')),
      `${integrationId}: must migrate endpoint data to include Action1 organization identity`
    );
    for (const uiFile of ['Dashboard.jsx', 'viewToolkit.jsx']) {
      const uiSource = fs.readFileSync(path.join(integrationDir, 'ui', uiFile), 'utf8');
      assert(
        uiSource.includes('integrationAssets - missingFromAction1') &&
          uiSource.includes('Math.min(100, Math.round((matchedAssets / integrationAssets) * 100))'),
        `${integrationId}: ${uiFile} sync rate must measure matched scanner assets and never exceed 100%`
      );
      assert(
        !uiSource.includes('(stats.totalAction1Assets || 0) / stats.totalIntegrationAssets'),
        `${integrationId}: ${uiFile} must not divide the full Action1 inventory by the scanner inventory`
      );
    }
  }

  const { discoverAction1Inventory } = require('../integrations/defender/action1Organizations');
  const mockAxios = {
    get: async (url) => {
      if (url.includes('/organizations?')) {
        return { data: { organizations: [{ id: 'org-a', name: 'North' }, { id: 'org-b', name: 'South' }] } };
      }
      if (url.includes('/org-a?')) return { data: { endpoints: [{ id: 'endpoint-a', device_name: 'shared-host.example.com' }] } };
      if (url.includes('/org-b?')) return { data: { endpoints: [{ id: 'endpoint-b', device_name: 'shared-host.example.com' }] } };
      throw new Error(`Unexpected Action1 test URL: ${url}`);
    }
  };
  const inventory = await discoverAction1Inventory(mockAxios, 'https://action1.example/api/3.0', {});
  assert.strictEqual(inventory.organizations.length, 2, 'Action1 discovery must return every accessible organization');
  assert.strictEqual(inventory.endpoints.length, 2, 'same-named endpoints in separate organizations must both be retained');
  assert.deepStrictEqual(
    inventory.endpoints.map((endpoint) => endpoint.action1_organization_id).sort(),
    ['org-a', 'org-b'],
    'Action1 endpoints must retain their source organization ID'
  );

  console.log('Integration handler contract tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
