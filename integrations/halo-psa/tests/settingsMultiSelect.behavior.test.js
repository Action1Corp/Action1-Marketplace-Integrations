const assert = require('assert');

const settingsSchema = require('../ui/settingsSchema.json');
const {
  getEffectiveSettingValue,
  serializeSettingValue,
  updateCsvSelection
} = require('../ui/settingsValueHelpers');

const GROUPS = [
  {
    key: 'HaloPsaVulnerabilitySeverities',
    options: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
  },
  {
    key: 'HaloPsaUpdateSeverities',
    options: ['CRITICAL', 'IMPORTANT', 'MODERATE', 'LOW', 'UNSPECIFIED']
  },
  {
    key: 'HaloPsaVulnerabilityRemediationStatuses',
    options: ['OVERDUE', 'DUE_SOON']
  },
  {
    key: 'HaloPsaUpdateRemediationStatuses',
    options: ['OVERDUE', 'DUE_SOON']
  }
];

function parseCsv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function getSetting(key) {
  return settingsSchema.find((setting) => setting.key === key);
}

function runGroupRemovalTest(group) {
  let settings = {
    [group.key]: group.options.join(','),
    [`${group.key}Explicit`]: 'false'
  };

  for (const option of group.options) {
    settings = {
      ...settings,
      [group.key]: updateCsvSelection(settings[group.key], option, false),
      [`${group.key}Explicit`]: 'true'
    };
    const selected = new Set(parseCsv(settings[group.key]));
    const rendered = group.options.map((value) => selected.has(value));
    const expected = group.options.map((value) => value !== option && selected.has(value));
    assert.deepStrictEqual(rendered, expected, `${group.key} should render the updated selection after removing ${option}`);
  }

  assert.strictEqual(settings[group.key], '', `${group.key} should retain an empty final selection`);
  assert.strictEqual(
    getEffectiveSettingValue({ key: group.key }, settings, { settingsSchema }),
    '',
    `${group.key} should render empty after the final option is removed`
  );
  assert.strictEqual(
    serializeSettingValue(getSetting(group.key), settings, { settingsSchema }),
    '',
    `${group.key} should serialize the empty selection`
  );
}

for (const group of GROUPS) {
  runGroupRemovalTest(group);
}

console.log('HaloPSA multi-select behavior tests passed.');
