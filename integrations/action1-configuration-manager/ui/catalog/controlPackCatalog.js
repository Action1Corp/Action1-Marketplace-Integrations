import releasedCatalog from '../../control-packs/windows-endpoint-configuration/0.1.0/control-catalog.json' with { type: 'json' };

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

export function loadReleasedControlCatalog() {
  const families = [...releasedCatalog.families].sort(byDisplayOrder);
  const controlFamilies = [...releasedCatalog.automationGroups].sort(byDisplayOrder);
  const controls = [...releasedCatalog.controls].sort(byDisplayOrder);

  return {
    packId: releasedCatalog.packId,
    packVersion: releasedCatalog.packVersion,
    families,
    controlFamilies,
    controls,
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
