const assert = require('assert');
const fs = require('fs');
const path = require('path');

const integrationDir = path.join(__dirname, '..');
const manifest = require(path.join(integrationDir, 'manifest.json'));
const display = require(path.join(integrationDir, 'display.json'));
const settingsSchema = require(path.join(integrationDir, 'ui', 'settingsSchema.json'));
const { actions } = require(path.join(integrationDir, 'actions.js'));

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function hasForgeImportLikePattern(text) {
  return (
    /require\(\s*['"]@forge\//.test(text) ||
    /from\s+['"]@forge\//.test(text) ||
    /import\s+['"]@forge\//.test(text) ||
    /require\(\s*['"][^'"]*forge-bridge['"]\s*\)/.test(text) ||
    /from\s+['"][^'"]*forge-bridge['"]/.test(text) ||
    /require\(\s*['"][^'"]*forge\/api['"]\s*\)/.test(text) ||
    /from\s+['"][^'"]*forge\/api['"]/.test(text)
  );
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(fullPath));
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

async function run() {
  assert.strictEqual(manifest.id, 'jira-cloud', 'manifest.id should match jira-cloud');

  assert(actions && typeof actions === 'object', 'actions.js should export an actions object');
  for (const action of manifest.actions || []) {
    assert.strictEqual(typeof actions[action.id], 'function', `manifest action ${action.id} should have a matching exported handler`);
  }

  const runLogs = [];
  const validateResult = await actions['validate-configuration'](
    {},
    {
      settings: {},
      run: {
        appendLog: async (message) => runLogs.push(message)
      }
    }
  );
  assert(validateResult && typeof validateResult === 'object', 'validate-configuration should return an object');
  assert.strictEqual(validateResult.ok, false, 'validate-configuration should fail safely when required Jira settings are absent');
  assert.strictEqual(
    runLogs.some((message) => String(message).includes('Starting Jira Cloud configuration validation.')),
    true,
    'validate-configuration should log validation start'
  );
  assert.strictEqual(
    runLogs.some((message) => String(message).includes('Missing required Jira Cloud settings')),
    true,
    'validate-configuration should log a safe missing-settings failure'
  );

  const originalFetch = global.fetch;
  const fetchCalls = [];
  global.fetch = async (url) => {
    const urlText = String(url);
    fetchCalls.push(urlText);
    if (urlText.endsWith('/oauth2/token')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({ access_token: 'action1-token' })
      };
    }
    if (urlText.includes('/endpoints/managed/org-1')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ id: 'ep-1', name: 'Endpoint One', last_seen: '2026-06-01_00-00-00', reboot_required: 'yes' }],
          from: 0,
          total_items: 1
        })
      };
    }
    if (urlText.includes('/vulnerabilities/org-1?')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ cve_id: 'CVE-1', severity: 'High', remediation_status: 'Overdue' }],
          from: 0,
          total_items: 1
        })
      };
    }
    if (urlText.includes('/vulnerabilities/org-1/CVE-1/endpoints')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ id: 'ep-1' }],
          from: 0,
          total_items: 1
        })
      };
    }
    if (urlText.includes('/updates/org-1?')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ packageId: 'pkg-1', versionId: 'ver-1', security_severity: 'Important', update_sla_status: 'Overdue' }],
          from: 0,
          total_items: 1
        })
      };
    }
    if (urlText.includes('/updates/org-1/pkg-1/versions/ver-1/endpoints')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ id: 'ep-1' }],
          from: 0,
          total_items: 1
        })
      };
    }
    if (urlText.includes('/automations/instances/org-1?')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ id: 'inst-1', end_time: '2026-06-20_00-00-00', action_name: 'Patch' }],
          from: 0,
          total_items: 1
        })
      };
    }
    if (urlText.includes('/automations/instances/org-1/inst-1/endpoint-results')) {
      return {
        ok: true,
        headers: { get() { return 'application/json'; } },
        text: async () => JSON.stringify({
          items: [{ id: 'ep-1', status: 'Error', description: 'Failed to patch' }],
          from: 0,
          total_items: 1
        })
      };
    }
    throw new Error(`Unexpected fetch during scaffold contract: ${urlText}`);
  };

  try {
    const syncLogs = [];
    let assetsProcessed = null;
    const syncResult = await actions.sync(
      {
        settings: {
          async all() {
            return {};
          },
          async get() {
            return '';
          }
        },
        db: {
          async all() {
            return [];
          }
        }
      },
      {
        settings: {},
        trigger: 'test',
        run: {
          appendLog: async (message) => syncLogs.push(message),
          setAssetsProcessed: async (value) => {
            assetsProcessed = value;
          }
        }
      }
    );

    assert(syncResult && typeof syncResult === 'object', 'sync should return an object');
    assert.strictEqual(syncResult.ok, false, 'sync should fail safely when required run prerequisites are missing');
    assert.strictEqual(syncResult.assetsProcessed, 0, 'sync without mappings should report zero processed assets');
    assert.strictEqual(assetsProcessed, 0, 'sync without mappings should set Marketplace processed assets to zero');
    assert.strictEqual(
      syncResult.message.includes('requires at least one enabled Action1 organization mapping') ||
        syncLogs.some((message) => String(message).includes('no Jira project mappings are configured')) ||
        syncResult.message.includes('Jira Cloud sync is not ready') ||
        syncLogs.some((message) => String(message).includes('JiraCloudSiteUrl is required')),
      true,
      'sync should log safe missing-prerequisite guidance'
    );
    assert.strictEqual(
      String(syncResult.details || '').includes('JIRA_CLOUD_SYNC_SUMMARY_BEGIN'),
      true,
      'sync should emit an explicit summary block'
    );
  } finally {
    global.fetch = originalFetch;
  }

  const packageFiles = listFiles(integrationDir)
    .filter((filePath) => /\.(js|jsx|json|md|sql)$/i.test(filePath));
  const packageSources = packageFiles.map((filePath) => ({
    filePath,
    text: read(filePath)
  }));
  const runtimeSources = packageSources.filter((entry) => !entry.filePath.includes(`${path.sep}tests${path.sep}`));
  const runtimeCombinedSource = runtimeSources.map((entry) => entry.text).join('\n');

  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'jiraApi.js')), true, 'jiraApi.js should exist in Slice 3');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'validate.js')), true, 'validate.js should exist in Slice 3');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'action1Api.js')), true, 'action1Api.js should exist in Slice 3 for Action1 organization discovery');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'mappingActions.js')), true, 'mappingActions.js should exist in Slice 3');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'mappingStore.js')), true, 'mappingStore.js should exist in Slice 3');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'runtimeConfig.js')), true, 'runtimeConfig.js should exist in Slice 4');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'stage4CandidatePipeline.js')), true, 'stage4CandidatePipeline.js should exist in Slice 4');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'syncAction.js')), true, 'syncAction.js should exist in Slice 4');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'issuePayloadBuilder.js')), true, 'issuePayloadBuilder.js should exist in Slice 5');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'ticketContentBuilder.js')), true, 'ticketContentBuilder.js should exist in Slice 5');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'groupedTicketContentBuilder.js')), true, 'groupedTicketContentBuilder.js should exist in Slice 5');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'correlationStore.js')), true, 'correlationStore.js should exist in Slice 6');
  assert.strictEqual(fs.existsSync(path.join(integrationDir, 'lifecycle')), true, 'lifecycle implementation should exist in Slice 6');
  assert.strictEqual(/createIssue\s*\(/.test(runtimeCombinedSource), true, 'createIssue methods should exist in Slice 6');
  assert.strictEqual(/updateIssue\s*\(/.test(runtimeCombinedSource), true, 'updateIssue methods should exist in Slice 6');
  assert.strictEqual(/getIssue\s*\(/.test(runtimeCombinedSource), true, 'getIssue methods should exist in Slice 6');
  assert.strictEqual(/transitionIssue\s*\(/i.test(runtimeCombinedSource), false, 'transition behavior should not exist in Slice 6');
  assert.strictEqual(/\/rest\/api\/3\/issue\/[^"'`\s]+\/transitions/i.test(runtimeCombinedSource), false, 'transition endpoints should not exist in Slice 6');
  assert.strictEqual(/updateResolution\s*\(/i.test(runtimeCombinedSource), false, 'resolution mutation behavior should not exist in Slice 6');
  assert.strictEqual(/\/rest\/api\/3\/issue\/[^"'`\s]+\/resolution/i.test(runtimeCombinedSource), false, 'resolution mutation endpoints should not exist in Slice 6');
  assert.strictEqual(/setTicketStatus\s*\(/.test(runtimeCombinedSource), false, 'close or status lifecycle methods should not exist in Slice 6');
  assert.strictEqual(/details_html/.test(runtimeCombinedSource), false, 'Jira payload generation should not carry Halo HTML fields into runtime output');

  for (const entry of runtimeSources) {
    assert.strictEqual(hasForgeImportLikePattern(entry.text), false, `Forge imports or Forge SDK patterns should not exist in ${path.relative(integrationDir, entry.filePath)}`);
    assert.strictEqual(entry.text.includes("require('../database')"), false, `Marketplace backend database imports should not exist in ${path.relative(integrationDir, entry.filePath)}`);
    assert.strictEqual(entry.text.includes("require('./nvdService')"), false, `Marketplace backend service imports should not exist in ${path.relative(integrationDir, entry.filePath)}`);
    assert.strictEqual(entry.text.includes('context.legacy'), false, `legacy Marketplace runtime access should not exist in ${path.relative(integrationDir, entry.filePath)}`);
    assert.strictEqual(entry.text.includes('context.db.tables'), false, `Marketplace table helpers should not exist in ${path.relative(integrationDir, entry.filePath)}`);
  }

  assert(Array.isArray(settingsSchema), 'ui/settingsSchema.json should export an array');
  assert.strictEqual(
    settingsSchema.every((row) => String(row.key || '').startsWith('JiraCloud')),
    true,
    'every Jira Cloud scaffold setting key should start with JiraCloud'
  );
  assert.strictEqual(
    settingsSchema.some((row) => /^Action1/i.test(String(row.key || ''))),
    false,
    'ui/settingsSchema.json should not declare Action1 credential settings'
  );
  assert.strictEqual(
    settingsSchema.some((row) => /project|issuetype|issue type|mapping/i.test(`${row.key} ${row.label} ${row.helpText || ''}`)),
    false,
    'ui/settingsSchema.json should not declare project, issue type, or mapping settings in Slice 1'
  );
  assert.strictEqual(fetchCalls.some((url) => url.includes('/rest/api/3/issue')), false, 'missing-mapping scaffolding should not call Jira issue APIs');

  const uiIndexSource = read(path.join(integrationDir, 'ui', 'index.jsx'));
  assert(Array.isArray(display.navigation) && display.navigation.length > 0, 'display.json should define navigation');
  for (const route of display.navigation) {
    const routePath = String(route.path || '').trim();
    assert(routePath, 'every display.json route should define a path');
    assert(
      new RegExp(`\\b${routePath}\\s*:`).test(uiIndexSource),
      `ui/index.jsx should export a matching view for display route ${routePath}`
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
