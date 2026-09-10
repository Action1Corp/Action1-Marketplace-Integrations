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

export function loadReleasedBaselines(rawBaselines = []) {
  return [...(Array.isArray(rawBaselines) ? rawBaselines : [])];
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

export function buildControlPackCatalog({ packId, packVersion, catalog, baselines = [] }) {
  const families = [...(catalog?.families || [])].sort(byDisplayOrder);
  const controlFamilies = [...(catalog?.automationGroups || [])].sort(byDisplayOrder);
  const controls = [...(catalog?.controls || [])].sort(byDisplayOrder);
  const releasedBaselines = loadReleasedBaselines(baselines);

  return {
    packId,
    packVersion,
    families,
    controlFamilies,
    controls,
    baselines: releasedBaselines,
    baselineOptions: getBaselineOptions(releasedBaselines),
    baselineMembershipByControlId: getBaselineMembershipByControlId(releasedBaselines),
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

export function loadReleasedControlCatalog(packData) {
  return buildControlPackCatalog(packData);
}
