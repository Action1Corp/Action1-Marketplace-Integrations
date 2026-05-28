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
  'hostServices'
];
const supportedMarketplaceApiVersions = new Set(['1.0']);
const supportedHostServices = new Set(['settings', 'validate', 'sync', 'history', 'schedule']);
const supportedSettingTypes = new Set(['text', 'url', 'secret', 'select', 'number', 'checkbox']);
const supportedActionPlacements = new Set(['settings']);
const marketplaceOwnedSettings = new Set(['Action1APIKey', 'Action1APISecret', 'Action1OrgID']);
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

function readUiViewKeys(integrationDir) {
  const uiEntryPath = path.join(integrationDir, 'ui', 'index.jsx');
  if (!fs.existsSync(uiEntryPath)) return null;
  const source = fs.readFileSync(uiEntryPath, 'utf8');
  const directMatch = source.match(/export\s+const\s+views\s*=\s*{([\s\S]*?)}/m);
  if (directMatch) {
    return new Set(
      Array.from(directMatch[1].matchAll(/['"]?([a-z][a-z0-9-]*)['"]?\s*:/g))
        .map(match => match[1])
    );
  }
  return new Set();
}

function readSettingsSchema(integrationDir) {
  const settingsPath = path.join(integrationDir, 'ui', 'settingsSchema.json');
  if (!fs.existsSync(settingsPath)) return [];
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!Array.isArray(settings)) {
      console.error(`${path.basename(integrationDir)}: ui/settingsSchema.json must be an array`);
      failures += 1;
      return [];
    }
    return settings;
  } catch (error) {
    console.error(`${path.basename(integrationDir)}: invalid ui/settingsSchema.json - ${error.message}`);
    failures += 1;
    return [];
  }
}

function validateDisplaySection(entryName, display, section, requirement) {
  if (!display[section] || typeof display[section] !== 'object') {
    console.error(`${entryName}: ${requirement} requires display.${section}`);
    failures += 1;
    return;
  }

  if (section === 'dashboard') {
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
    console.error(`${entry.name}: use hostServices instead of capabilities`);
    failures += 1;
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'marketplaceActions')) {
    console.error(`${entry.name}: use hostServices instead of marketplaceActions`);
    failures += 1;
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'settings')) {
    console.error(`${entry.name}: move integration settings to ui/settingsSchema.json`);
    failures += 1;
  }

  if (!Array.isArray(manifest.hostServices)) {
    console.error(`${entry.name}: hostServices must be an array`);
    failures += 1;
  } else {
    const seenServices = new Set();
    for (const service of manifest.hostServices) {
      if (!supportedHostServices.has(service)) {
        console.error(`${entry.name}: unsupported hostService ${service}`);
        failures += 1;
      }
      if (seenServices.has(service)) {
        console.error(`${entry.name}: duplicate hostService ${service}`);
        failures += 1;
      }
      seenServices.add(service);
    }
    if (manifest.hostServices.includes('schedule') && !manifest.hostServices.includes('sync')) {
      console.error(`${entry.name}: schedule hostService requires sync hostService`);
      failures += 1;
    }
  }

  const hasHandler = fs.existsSync(path.join(root, entry.name, manifest.entry || 'index.js'));
  if (manifest.hostServices?.includes('sync') && !hasHandler) {
    console.error(`${entry.name}: declares sync but has no handler`);
    failures += 1;
  }
  if (manifest.hostServices?.includes('validate') && !hasHandler) {
    console.error(`${entry.name}: declares validate but has no handler`);
    failures += 1;
  }

  const displayPath = path.join(root, entry.name, 'display.json');
  const settingsSchema = readSettingsSchema(integrationDir);
  const uiViewKeys = readUiViewKeys(integrationDir);
  if (!uiViewKeys) {
    console.error(`${entry.name}: integration-owned UI requires ui/index.jsx`);
    failures += 1;
  }
  let display = null;
  const availableActionPlacements = new Set(supportedActionPlacements);
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
          console.error(`${entry.name}: display.navigation uses deprecated capability; use hostService`);
          failures += 1;
        }
        if (item.marketplaceAction) {
          console.error(`${entry.name}: display.navigation uses deprecated marketplaceAction; use hostService`);
          failures += 1;
        }
        if (item.hostService && !supportedHostServices.has(item.hostService)) {
          console.error(`${entry.name}: display.navigation uses unsupported hostService ${item.hostService}`);
          failures += 1;
        }
        if (item.hostService && supportedHostServices.has(item.hostService) && !manifest.hostServices?.includes(item.hostService) && item.hostService !== 'settings') {
          console.error(`${entry.name}: display.navigation references undeclared hostService ${item.hostService}`);
          failures += 1;
        }
        if (uiViewKeys && item.path && !uiViewKeys.has(item.path)) {
          console.error(`${entry.name}: ui/index.jsx must export a view for navigation path ${item.path}`);
          failures += 1;
        }
        if (item.path) {
          availableActionPlacements.add(item.path);
        }
      }
    }

    if (display.dashboard) validateDisplaySection(entry.name, display, 'dashboard', 'dashboard view');
    if (display.endpoints) validateDisplaySection(entry.name, display, 'endpoints', 'endpoints view');
    if (display.vulnerabilities) validateDisplaySection(entry.name, display, 'vulnerabilities', 'vulnerabilities view');
    if (display.history) validateDisplaySection(entry.name, display, 'history', 'history view');

    const visibleViews = ['dashboard', 'endpoints', 'vulnerabilities', 'history'].filter(view => display[view]);
    for (const view of visibleViews) {
      if (!display.navigation.some(item => item.id === view || item.path === view)) {
        console.error(`${entry.name}: display.navigation must include ${view}`);
        failures += 1;
      }
    }
    if (settingsSchema.length > 0 && !display.navigation.some(item => item.id === 'settings' || item.hostService === 'settings')) {
      console.error(`${entry.name}: display.navigation must include settings`);
      failures += 1;
    }

    if (display.customScreens !== undefined) {
      if (!display.customScreens || typeof display.customScreens !== 'object' || Array.isArray(display.customScreens)) {
        console.error(`${entry.name}: display.customScreens must be an object keyed by screen path`);
        failures += 1;
      } else {
        for (const [screenId, screen] of Object.entries(display.customScreens)) {
          if (!/^[a-z][a-z0-9-]*$/.test(screenId)) {
            console.error(`${entry.name}: custom screen ${screenId} must use lowercase kebab-case`);
            failures += 1;
          }
          if (!screen.title) {
            console.error(`${entry.name}: custom screen ${screenId} requires title`);
            failures += 1;
          }
          if (screen.actions !== undefined && !Array.isArray(screen.actions)) {
            console.error(`${entry.name}: custom screen ${screenId} actions must be an array`);
            failures += 1;
          }
          if (!display.navigation.some(item => item.path === screenId || item.id === screenId)) {
            console.error(`${entry.name}: display.navigation must include custom screen ${screenId}`);
            failures += 1;
          }
          availableActionPlacements.add(screenId);
        }
      }
    }
  }

  if (manifest.actions !== undefined) {
    if (!Array.isArray(manifest.actions)) {
      console.error(`${entry.name}: actions must be an array`);
      failures += 1;
    } else {
      const seenIntegrationActions = new Set();
      const actionIds = new Set();
      for (const action of manifest.actions) {
        if (!action.id || !/^[a-z][a-z0-9-]*$/.test(action.id)) {
          console.error(`${entry.name}: action id must use lowercase kebab-case`);
          failures += 1;
        }
        if (!action.label) {
          console.error(`${entry.name}: action ${action.id || '<missing>'} requires label`);
          failures += 1;
        }
        if (action.id && seenIntegrationActions.has(action.id)) {
          console.error(`${entry.name}: duplicate action ${action.id}`);
          failures += 1;
        }
        if (action.placement && !availableActionPlacements.has(action.placement)) {
          console.error(`${entry.name}: action ${action.id} uses unsupported placement ${action.placement}`);
          failures += 1;
        }
        if (action.id) {
          seenIntegrationActions.add(action.id);
          actionIds.add(action.id);
        }
      }

      for (const [screenId, screen] of Object.entries(display?.customScreens || {})) {
        for (const actionId of screen.actions || []) {
          if (!actionIds.has(actionId)) {
            console.error(`${entry.name}: custom screen ${screenId} references unknown action ${actionId}`);
            failures += 1;
          }
        }
      }
    }
  }

  const seenSettings = new Set();
  for (const setting of settingsSchema) {
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
    if (marketplaceOwnedSettings.has(setting.key)) {
      console.error(`${entry.name}: ${setting.key} is a Marketplace-level setting and must not be declared by an integration`);
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
