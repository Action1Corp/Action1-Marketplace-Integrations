const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'integrations'),
  path.join(__dirname, '..', 'developer', 'examples')
];
const requiredTopLevel = [
  'id',
  'name',
  'vendor',
  'version',
  'marketplaceApiVersion',
  'minimumMarketplaceVersion',
  'description',
  'category',
  'marketplaceActions',
  'settings'
];
const supportedMarketplaceApiVersions = new Set(['1.0']);
const supportedMarketplaceActions = new Set(['settings', 'validate', 'sync', 'history', 'schedule']);
const supportedSettingTypes = new Set(['text', 'url', 'secret', 'select', 'number', 'checkbox']);
const supportedDisplaySections = new Set(['navigation', 'dashboard', 'endpoints', 'vulnerabilities', 'history', 'settings']);
const supportedColumnTypes = new Set([
  'strong',
  'number',
  'syncStatus',
  'nistLink',
  'severityBadgeDynamic',
  'runId',
  'datetime',
  'runStatus',
  'historyActions',
  'text',
  'badge',
  'boolean',
  'monospace',
  'severityBadge',
  'muted',
  'patchStatus'
]);
const supportedDashboardComponents = new Set(['metric-dashboard', 'intune-agent-status']);
let failures = 0;

function validateMigrations(entryName, integrationDir) {
  const migrationsDir = path.join(integrationDir, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isFile());
  const seen = new Set();
  for (const file of files) {
    if (!/^\d{3,}_[a-z0-9_]+\.sql$/.test(file.name)) {
      console.error(`${entryName}: migration ${file.name} must use format 001_description.sql`);
      failures += 1;
    }
    if (seen.has(file.name)) {
      console.error(`${entryName}: duplicate migration ${file.name}`);
      failures += 1;
    }
    seen.add(file.name);

    const sql = fs.readFileSync(path.join(migrationsDir, file.name), 'utf8').trim();
    if (!sql) {
      console.error(`${entryName}: migration ${file.name} is empty`);
      failures += 1;
    }
  }
}

function readMigrationSql(integrationDir) {
  const migrationsDir = path.join(integrationDir, 'migrations');
  if (!fs.existsSync(migrationsDir)) return '';
  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => fs.readFileSync(path.join(migrationsDir, entry.name), 'utf8'))
    .join('\n');
}

function validateDisplaySection(entryName, display, section, requirement) {
  if (!display[section] || typeof display[section] !== 'object') {
    console.error(`${entryName}: ${requirement} requires display.${section}`);
    failures += 1;
    return;
  }

  if (section === 'dashboard') {
    if (!display.dashboard.component) {
      console.error(`${entryName}: display.dashboard must declare component`);
      failures += 1;
    } else if (!supportedDashboardComponents.has(display.dashboard.component)) {
      console.error(`${entryName}: unsupported dashboard component ${display.dashboard.component}`);
      failures += 1;
    }
    return;
  }

  if (!Array.isArray(display[section].columns) || display[section].columns.length === 0) {
    console.error(`${entryName}: display.${section} must declare columns`);
    failures += 1;
    return;
  }

  for (const column of display[section].columns) {
    if (!column.key || !column.label) {
      console.error(`${entryName}: display.${section}.columns entries require key and label`);
      failures += 1;
    }
    if (column.type && !supportedColumnTypes.has(column.type)) {
      console.error(`${entryName}: unsupported display column type ${column.type}`);
      failures += 1;
    }
  }
}

for (const root of roots) {
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
  const manifestPath = path.join(root, entry.name, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`${entry.name}: missing manifest.json`);
    failures += 1;
    continue;
  }

  let manifest;
  const integrationDir = path.join(root, entry.name);
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`${entry.name}: invalid JSON - ${error.message}`);
    failures += 1;
    continue;
  }

  for (const key of requiredTopLevel) {
    if (manifest[key] === undefined || manifest[key] === '') {
      console.error(`${entry.name}: missing required manifest field ${key}`);
      failures += 1;
    }
  }

  if (manifest.id !== entry.name) {
    console.error(`${entry.name}: manifest id must match folder name`);
    failures += 1;
  }

  if (!supportedMarketplaceApiVersions.has(manifest.marketplaceApiVersion)) {
    console.error(`${entry.name}: unsupported marketplaceApiVersion ${manifest.marketplaceApiVersion}`);
    failures += 1;
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'capabilities')) {
    console.error(`${entry.name}: use marketplaceActions instead of capabilities`);
    failures += 1;
  }

  if (!Array.isArray(manifest.marketplaceActions)) {
    console.error(`${entry.name}: marketplaceActions must be an array`);
    failures += 1;
  } else {
    const seenActions = new Set();
    for (const action of manifest.marketplaceActions) {
      if (!supportedMarketplaceActions.has(action)) {
        console.error(`${entry.name}: unsupported marketplaceAction ${action}`);
        failures += 1;
      }
      if (seenActions.has(action)) {
        console.error(`${entry.name}: duplicate marketplaceAction ${action}`);
        failures += 1;
      }
      seenActions.add(action);
    }
    if (manifest.marketplaceActions.includes('schedule') && !manifest.marketplaceActions.includes('sync')) {
      console.error(`${entry.name}: schedule marketplaceAction requires sync marketplaceAction`);
      failures += 1;
    }
  }

  const hasHandler = fs.existsSync(path.join(root, entry.name, manifest.entry || 'index.js'));
  if (manifest.marketplaceActions?.includes('sync') && !hasHandler) {
    console.error(`${entry.name}: declares sync but has no handler`);
    failures += 1;
  }
  if (manifest.marketplaceActions?.includes('validate') && !hasHandler) {
    console.error(`${entry.name}: declares validate but has no handler`);
    failures += 1;
  }

  if (!Array.isArray(manifest.settings)) {
    console.error(`${entry.name}: settings must be an array`);
    failures += 1;
    continue;
  }

  const displayPath = path.join(root, entry.name, 'display.json');
  let display = null;
  const migrationSql = readMigrationSql(integrationDir);
  if (fs.existsSync(displayPath)) {
    if (!fs.existsSync(displayPath)) {
      console.error(`${entry.name}: display.json is required for integration UI views`);
      failures += 1;
    } else {
      try {
        display = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
      } catch (error) {
        console.error(`${entry.name}: invalid display.json - ${error.message}`);
        failures += 1;
      }
    }
  }

  if (display) {
    for (const key of Object.keys(display)) {
      if (!supportedDisplaySections.has(key)) {
        console.error(`${entry.name}: unsupported display section ${key}`);
        failures += 1;
      }
    }

    if (!Array.isArray(display.navigation) || display.navigation.length === 0) {
      console.error(`${entry.name}: display.json must define navigation entries`);
      failures += 1;
    } else {
      for (const item of display.navigation) {
        if (!item.id || !item.label || !item.path) {
          console.error(`${entry.name}: display.navigation entries require id, label, and path`);
          failures += 1;
        }
        if (item.capability) {
          console.error(`${entry.name}: display.navigation uses deprecated capability; use marketplaceAction`);
          failures += 1;
        }
        if (item.marketplaceAction && !supportedMarketplaceActions.has(item.marketplaceAction)) {
          console.error(`${entry.name}: display.navigation uses unsupported marketplaceAction ${item.marketplaceAction}`);
          failures += 1;
        }
        if (item.marketplaceAction && supportedMarketplaceActions.has(item.marketplaceAction) && !manifest.marketplaceActions?.includes(item.marketplaceAction) && item.marketplaceAction !== 'settings') {
          console.error(`${entry.name}: display.navigation references undeclared marketplaceAction ${item.marketplaceAction}`);
          failures += 1;
        }
      }
    }

    if (display.dashboard) validateDisplaySection(entry.name, display, 'dashboard', 'dashboard view');
    if (display.endpoints) validateDisplaySection(entry.name, display, 'endpoints', 'endpoints view');
    if (display.vulnerabilities) validateDisplaySection(entry.name, display, 'vulnerabilities', 'vulnerabilities view');
    if (display.history) validateDisplaySection(entry.name, display, 'history', 'history view');

    const tablePrefix = manifest.id.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    if ((display.endpoints || display.dashboard?.component === 'metric-dashboard') && !migrationSql.includes(`${tablePrefix}_endpoints`)) {
      console.error(`${entry.name}: standard endpoint/dashboard views require ${tablePrefix}_endpoints in migrations`);
      failures += 1;
    }
    if ((display.vulnerabilities || display.dashboard?.component === 'metric-dashboard') && !migrationSql.includes(`${tablePrefix}_endpoint_cves`)) {
      console.error(`${entry.name}: standard vulnerability/dashboard views require ${tablePrefix}_endpoint_cves in migrations`);
      failures += 1;
    }

    const visibleViews = ['dashboard', 'endpoints', 'vulnerabilities', 'history'].filter(view => display[view]);
    for (const view of visibleViews) {
      if (!display.navigation.some(item => item.id === view || item.path === view)) {
        console.error(`${entry.name}: display.navigation must include ${view}`);
        failures += 1;
      }
    }
    if (manifest.settings?.length > 0 && !display.navigation.some(item => item.id === 'settings' || item.marketplaceAction === 'settings')) {
      console.error(`${entry.name}: display.navigation must include settings`);
      failures += 1;
    }
  }

  const seenSettings = new Set();
  for (const setting of manifest.settings) {
    if (!setting.key || !setting.label || !setting.type) {
      console.error(`${entry.name}: each setting requires key, label, and type`);
      failures += 1;
      continue;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(setting.key)) {
      console.error(`${entry.name}: setting key ${setting.key} must be alphanumeric and start with a letter`);
      failures += 1;
    }
    if (!supportedSettingTypes.has(setting.type)) {
      console.error(`${entry.name}: unsupported setting type ${setting.type}`);
      failures += 1;
    }
    if (setting.type === 'select' && (!Array.isArray(setting.options) || setting.options.length === 0)) {
      console.error(`${entry.name}: select setting ${setting.key} requires options`);
      failures += 1;
    }
    if (seenSettings.has(setting.key)) {
      console.error(`${entry.name}: duplicate setting key ${setting.key}`);
      failures += 1;
    }
    seenSettings.add(setting.key);
  }

  validateMigrations(entry.name, integrationDir);
}
}

if (failures > 0) {
  console.error(`Manifest validation failed with ${failures} error(s).`);
  process.exit(1);
}

console.log('Integration manifests validated.');
