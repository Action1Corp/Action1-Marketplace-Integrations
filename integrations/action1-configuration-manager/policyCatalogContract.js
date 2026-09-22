const { loadControlPackArtifacts } = require('./controlPackResolver');

let cachedContract = null;

const SUPPORTED_PARAMETER_TYPES = new Set(['boolean', 'integer', 'enum', 'string', 'multiline-string', 'time']);

function normalizeInteger(value, label) {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(normalized)) {
    throw new Error(`${label} must be a whole number.`);
  }
  return normalized;
}

function normalizeParameterValues(control, rawParameters, options = {}) {
  if (!rawParameters || typeof rawParameters !== 'object' || Array.isArray(rawParameters)) {
    throw new Error('Control Pack contract error: parameters must be an object.');
  }

  const parameters = control.parameters || [];
  const parameterById = Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter]));
  for (const parameterId of Object.keys(rawParameters)) {
    if (!parameterById[parameterId]) {
      throw new Error(`Control Pack contract error: unknown parameter ID ${parameterId}.`);
    }
  }

  const normalized = {};
  for (const parameter of parameters) {
    if (!SUPPORTED_PARAMETER_TYPES.has(parameter.type)) {
      throw new Error(`Control Pack contract error: unsupported parameter type ${parameter.type}.`);
    }

    const hasValue = Object.prototype.hasOwnProperty.call(rawParameters, parameter.id);
    if (!hasValue && options.requireAllDeclared) {
      throw new Error(`Control Pack contract error: missing parameter ${parameter.id}.`);
    }
    const rawValue = hasValue ? rawParameters[parameter.id] : parameter.defaultValue;
    if (rawValue === undefined || (parameter.required && rawValue === null)) {
      throw new Error(`Control Pack contract error: missing required parameter ${parameter.id}.`);
    }

    if (parameter.type === 'boolean') {
      if (typeof rawValue !== 'boolean') throw new Error(`Control Pack contract error: ${parameter.id} must be boolean.`);
      normalized[parameter.id] = rawValue;
    } else if (parameter.type === 'integer') {
      const value = normalizeInteger(rawValue, parameter.id);
      if (parameter.minimum !== undefined && value < parameter.minimum) throw new Error(`Control Pack contract error: ${parameter.id} is below minimum.`);
      if (parameter.maximum !== undefined && value > parameter.maximum) throw new Error(`Control Pack contract error: ${parameter.id} is above maximum.`);
      if (parameter.minimum !== undefined && parameter.step !== undefined && (value - parameter.minimum) % parameter.step !== 0) {
        throw new Error(`Control Pack contract error: ${parameter.id} is not aligned to step.`);
      }
      normalized[parameter.id] = value;
    } else if (parameter.type === 'enum') {
      if (typeof rawValue !== 'string' || !(parameter.options || []).some((option) => option.value === rawValue)) {
        throw new Error(`Control Pack contract error: ${parameter.id} must use a released enum value.`);
      }
      normalized[parameter.id] = rawValue;
    } else if (parameter.type === 'string' || parameter.type === 'multiline-string') {
      if (typeof rawValue !== 'string') throw new Error(`Control Pack contract error: ${parameter.id} must be text.`);
      if (parameter.required && rawValue.trim() === '') throw new Error(`Control Pack contract error: ${parameter.id} is required.`);
      if (parameter.minimumLength !== undefined && rawValue.length < parameter.minimumLength) throw new Error(`Control Pack contract error: ${parameter.id} is too short.`);
      if (parameter.maximumLength !== undefined && rawValue.length > parameter.maximumLength) throw new Error(`Control Pack contract error: ${parameter.id} is too long.`);
      if (parameter.pattern !== undefined && !(new RegExp(parameter.pattern)).test(rawValue)) throw new Error(`Control Pack contract error: ${parameter.id} has an invalid format.`);
      normalized[parameter.id] = rawValue;
    } else if (parameter.type === 'time') {
      if (typeof rawValue !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rawValue)) throw new Error(`Control Pack contract error: ${parameter.id} must use HH:mm.`);
      normalized[parameter.id] = rawValue;
    }
  }

  return normalized;
}

function validateBaselineRecommendation(contract, baselineId, controlId, rawParameters) {
  const baseline = (contract.baselines || []).find((entry) => entry.id === baselineId);
  if (!baseline) throw new Error(`Control Pack contract error: unknown baseline ${baselineId}.`);
  const mapping = (baseline.controls || []).find((entry) => entry.controlId === controlId);
  if (!mapping) throw new Error(`Control Pack contract error: Control ${controlId} is not mapped to baseline ${baselineId}.`);
  const control = contract.controlsById[controlId];
  if (!control) throw new Error(`Control Pack contract error: unknown Control ${controlId}.`);
  return normalizeParameterValues(control, rawParameters, { requireAllDeclared: true });
}

function loadPolicyCatalogContract(options = {}) {
  if (cachedContract) {
    return cachedContract;
  }

  const resolved = loadControlPackArtifacts(options);
  const catalog = resolved.catalog;
  const baselines = resolved.baselinesArtifact.baselines || [];
  cachedContract = {
    packId: resolved.packId,
    packVersion: resolved.packVersion,
    releaseRoot: resolved.releaseRoot,
    catalog,
    baselines,
    controlsById: Object.fromEntries((catalog.controls || []).map((control) => [control.controlId, control])),
    controlFamiliesById: Object.fromEntries((catalog.automationGroups || []).map((group) => [group.automationGroupId, group]))
  };

  for (const baseline of baselines) {
    for (const mapping of baseline.controls || []) {
      validateBaselineRecommendation(cachedContract, baseline.id, mapping.controlId, mapping.parameters || {});
    }
  }

  return cachedContract;
}

module.exports = {
  loadPolicyCatalogContract,
  normalizeParameterValues,
  validateBaselineRecommendation
};
