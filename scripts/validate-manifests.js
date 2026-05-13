const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'integrations');
const requiredTopLevel = ['id', 'name', 'vendor', 'description', 'category', 'capabilities', 'settings'];
let failures = 0;

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
  const manifestPath = path.join(root, entry.name, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`${entry.name}: missing manifest.json`);
    failures += 1;
    continue;
  }

  let manifest;
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

  if (!Array.isArray(manifest.capabilities)) {
    console.error(`${entry.name}: capabilities must be an array`);
    failures += 1;
  }

  if (!Array.isArray(manifest.settings)) {
    console.error(`${entry.name}: settings must be an array`);
    failures += 1;
    continue;
  }

  const seenSettings = new Set();
  for (const setting of manifest.settings) {
    if (!setting.key || !setting.label || !setting.type) {
      console.error(`${entry.name}: each setting requires key, label, and type`);
      failures += 1;
      continue;
    }
    if (seenSettings.has(setting.key)) {
      console.error(`${entry.name}: duplicate setting key ${setting.key}`);
      failures += 1;
    }
    seenSettings.add(setting.key);
  }
}

if (failures > 0) {
  console.error(`Manifest validation failed with ${failures} error(s).`);
  process.exit(1);
}

console.log('Integration manifests validated.');
