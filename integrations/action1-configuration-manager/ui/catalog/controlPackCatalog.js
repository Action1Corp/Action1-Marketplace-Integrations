import releasedCatalog from '../../control-packs/windows-endpoint-configuration/0.5.0/control-catalog.json' with { type: 'json' };
import releasedBaselinesArtifact from '../../control-packs/windows-endpoint-configuration/0.5.0/baselines.json' with { type: 'json' };

function byDisplayOrder(left, right) {
  return Number(left?.displayOrder || 0) - Number(right?.displayOrder || 0);
}

export function buildDefaultParameters(control) {
  return (Array.isArray(control?.parameters) ? control.parameters : []).reduce((defaults, parameter) => {
    defaults[parameter.id] = parameter.defaultValue;
    return defaults;
  }, {});
}

export function countSelectedControlFamilies(selectedControls) {
  return new Set(
    (Array.isArray(selectedControls) ? selectedControls : [])
      .map((control) => control?.automationGroupId)
      .filter(Boolean)
  ).size;
}

export function countExpectedAutomations(selectedControls) {
  return countSelectedControlFamilies(selectedControls);
}

export function loadReleasedBaselines() {
  return [...(releasedBaselinesArtifact.baselines || [])];
}

export function findBaselineById(baselines, baselineId) {
  return (Array.isArray(baselines) ? baselines : []).find((baseline) => baseline.id === baselineId) || null;
}

export function getBaselineOptions(baselines) {
  return (Array.isArray(baselines) ? baselines : []).map((baseline) => ({
    id: baseline.id,
    name: baseline.name,
    provider: baseline.provider,
    version: baseline.version,
    tag: baseline.tag
  }));
}

export function getBaselineMembershipByControlId(baselines) {
  const lookup = {};

  for (const baseline of Array.isArray(baselines) ? baselines : []) {
    for (const controlEntry of Array.isArray(baseline.controls) ? baseline.controls : []) {
      if (!lookup[controlEntry.controlId]) {
        lookup[controlEntry.controlId] = [];
      }

      lookup[controlEntry.controlId].push({
        baselineId: baseline.id,
        baselineName: baseline.name,
        provider: baseline.provider,
        version: baseline.version,
        tag: baseline.tag
      });
    }
  }

  return lookup;
}

export function getRecommendedParametersForBaselineControl(baselines, baselineId, controlId) {
  const baseline = findBaselineById(baselines, baselineId);
  if (!baseline) {
    return null;
  }

  const controlEntry = (baseline.controls || []).find((entry) => entry.controlId === controlId);
  if (!controlEntry) {
    return null;
  }

  return { ...(controlEntry.parameters || {}) };
}

export function loadReleasedControlCatalog() {
  const families = [...releasedCatalog.families].sort(byDisplayOrder);
  const controlFamilies = [...releasedCatalog.automationGroups].sort(byDisplayOrder);
  const controls = [...releasedCatalog.controls].sort(byDisplayOrder);
  const baselines = loadReleasedBaselines();

  return {
    packId: releasedCatalog.packId,
    packVersion: releasedCatalog.packVersion,
    families,
    controlFamilies,
    controls,
    baselines,
    baselineOptions: getBaselineOptions(baselines),
    baselineMembershipByControlId: getBaselineMembershipByControlId(baselines),
    controlsById: controls.reduce((lookup, control) => {
      lookup[control.controlId] = control;
      return lookup;
    }, {}),
    controlFamiliesById: controlFamilies.reduce((lookup, controlFamily) => {
      lookup[controlFamily.automationGroupId] = controlFamily;
      return lookup;
    }, {})
  };
}
