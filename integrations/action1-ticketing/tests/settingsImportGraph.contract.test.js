const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSource(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', 'ui', fileName), 'utf8').replace(/\r\n/g, '\n');
}

function run() {
  const settingsSource = readSource('Settings.jsx');
  const helperSource = readSource('settingsValueHelpers.js');

  assert(
    settingsSource.includes("import {\n  getEffectiveSettingValue as resolveEffectiveSettingValue,\n  serializeSettingValue as resolveSerializedSettingValue,\n  updateCsvSelection\n} from './settingsValueHelpers';"),
    'Settings.jsx should use explicit named ESM imports for settingsValueHelpers'
  );
  assert(
    !settingsSource.includes("import settingsValueHelpers from './settingsValueHelpers';"),
    'Settings.jsx should not use a default import for settingsValueHelpers'
  );

  for (const exportName of [
    'buildSettingsSchemaIndex',
    'resolveSettingDefinition',
    'isUnsetHostValueForDefaultedSetting',
    'getEffectiveSettingValue',
    'serializeSettingValue',
    'updateCsvSelection'
  ]) {
    assert(
      helperSource.includes(`export function ${exportName}`),
      `settingsValueHelpers.js should export ${exportName} as a browser-safe named ESM export`
    );
  }

  assert(
    !helperSource.includes('module.exports'),
    'settingsValueHelpers.js should not use CommonJS module.exports in the browser import graph'
  );
  assert(
    !helperSource.includes('require('),
    'settingsValueHelpers.js should not use CommonJS require in the browser import graph'
  );
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
