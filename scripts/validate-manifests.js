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
  'category'
];
const supportedMarketplaceApiVersions = new Set(['1.0']);
const supportedSettingTypes = new Set(['text', 'url', 'secret', 'select', 'number', 'checkbox']);
const supportedActionPlacements = new Set(['settings']);
let failures = 0;

function isMarketplaceOwnedSetting(key) {
  return /^Action1[A-Za-z0-9_]*$/.test(key);
}

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
    console.error(`${entry.name}: capabilities are no longer declared in manifest.json`);
    failures += 1;
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'marketplaceActions')) {
    console.error(`${entry.name}: marketplaceActions are no longer declared in manifest.json`);
    failures += 1;
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'hostServices')) {
    console.error(`${entry.name}: hostServices are inferred from integration handlers and UI files; remove hostServices from manifest.json`);
    failures += 1;
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'settings')) {
    console.error(`${entry.name}: move integration settings to ui/settingsSchema.json`);
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
    for (const key of Object.keys(display)) {
      if (key !== 'navigation') {
        console.error(`${entry.name}: display.json should only define marketplace navigation; move ${key} UI metadata into integration React views`);
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
          console.error(`${entry.name}: display.navigation should not declare Marketplace capabilities`);
          failures += 1;
        }
        if (item.marketplaceAction) {
          console.error(`${entry.name}: display.navigation should not declare marketplaceAction`);
          failures += 1;
        }
        if (item.hostService) {
          console.error(`${entry.name}: display.navigation should not declare hostService`);
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

    if (settingsSchema.length > 0 && !display.navigation.some(item => item.id === 'settings' || item.path === 'settings')) {
      console.error(`${entry.name}: display.navigation must include settings`);
      failures += 1;
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
    if (isMarketplaceOwnedSetting(setting.key)) {
      console.error(`${entry.name}: Marketplace-level Action1 settings must not be declared by an integration`);
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
