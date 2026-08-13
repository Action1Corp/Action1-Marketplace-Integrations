const pack = require('./control-packs/windows-endpoint-configuration/0.5.0/pack.json');
const catalog = require('./control-packs/windows-endpoint-configuration/0.5.0/control-catalog.json');
const baselines = require('./control-packs/windows-endpoint-configuration/0.5.0/baselines.json');

let cachedContract = null;

function loadPolicyCatalogContract() {
  if (cachedContract) {
    return cachedContract;
  }

  cachedContract = {
    packId: pack.packId,
    packVersion: pack.packVersion,
    controlsById: Object.fromEntries((catalog.controls || []).map((control) => [control.controlId, control])),
    controlFamiliesById: Object.fromEntries((catalog.automationGroups || []).map((group) => [group.automationGroupId, group])),
    baselines
  };

  return cachedContract;
}

module.exports = {
  loadPolicyCatalogContract
};
