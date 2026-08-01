function normalizeInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }

  return null;
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function addFieldError(fieldErrors, fieldName, message) {
  if (!fieldErrors[fieldName]) {
    fieldErrors[fieldName] = message;
  }
}

function validateParameter(fieldErrors, control, parameter, value) {
  const fieldName = `${control.controlId}.${parameter.id}`;

  if (parameter.type === 'boolean') {
    if (typeof value !== 'boolean') {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must be true or false.`);
    }
    return;
  }

  if (parameter.type === 'integer') {
    const normalized = normalizeInteger(value);
    if (normalized === null) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must be a whole number.`);
      return;
    }
    if (parameter.minimum !== undefined && normalized < parameter.minimum) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must be at least ${parameter.minimum}.`);
    }
    if (parameter.maximum !== undefined && normalized > parameter.maximum) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must be at most ${parameter.maximum}.`);
    }
    return;
  }

  if (parameter.type === 'enum') {
    const options = Array.isArray(parameter.options) ? parameter.options.map((option) => option.value) : [];
    if (!options.includes(value)) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must use a supported option.`);
    }
    return;
  }

  if (parameter.type === 'string' || parameter.type === 'multiline-string') {
    if (typeof value !== 'string') {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must be text.`);
      return;
    }
    if (parameter.required && value.trim() === '') {
      addFieldError(fieldErrors, fieldName, `${parameter.label} is required.`);
      return;
    }
    if (parameter.minimumLength !== undefined && value.length < parameter.minimumLength) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} is too short.`);
    }
    if (parameter.maximumLength !== undefined && value.length > parameter.maximumLength) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} is too long.`);
    }
    return;
  }

  if (parameter.type === 'time') {
    if (!isValidTime(value)) {
      addFieldError(fieldErrors, fieldName, `${parameter.label} must use HH:mm.`);
    }
    return;
  }

  addFieldError(fieldErrors, fieldName, `Unsupported parameter type: ${parameter.type}`);
}

export function validatePolicyDraft(draft, catalog) {
  const fieldErrors = {};
  const sectionErrors = [];
  let blockingMessage = '';

  const trimmedBaseName = String(draft.baseName || '').trim();
  if (!trimmedBaseName) {
    addFieldError(fieldErrors, 'baseName', 'Policy name is required.');
  }

  if (draft.mode === 'create' && !draft.organizationId) {
    addFieldError(fieldErrors, 'organizationId', 'Organization is required.');
  }

  if (!draft.scopeType) {
    addFieldError(fieldErrors, 'scopeType', 'Scope is required.');
  }

  if (draft.scopeType === 'ENDPOINT_GROUP' && !draft.endpointGroupId) {
    addFieldError(fieldErrors, 'endpointGroupId', 'Endpoint group is required.');
  }

  const runEveryHours = normalizeInteger(draft.runSchedule?.runEveryHours);
  if (runEveryHours === null || runEveryHours <= 0) {
    addFieldError(fieldErrors, 'runEveryHours', 'Run every must be a positive number of hours.');
  }

  if (!draft.runSchedule?.startDate) {
    addFieldError(fieldErrors, 'startDate', 'Start date is required.');
  }

  if (!isValidTime(draft.runSchedule?.startTime)) {
    addFieldError(fieldErrors, 'startTime', 'Start time must use HH:mm.');
  }

  if (!draft.runSchedule?.timezone) {
    addFieldError(fieldErrors, 'timezone', 'Timezone is required.');
  }

  const completionDeadlineMinutes = normalizeInteger(draft.completionDeadlineMinutes);
  if (completionDeadlineMinutes === null || completionDeadlineMinutes <= 0) {
    addFieldError(fieldErrors, 'completionDeadlineMinutes', 'Completion deadline must be a positive number of minutes.');
  }

  if (!Array.isArray(draft.selectedControls) || draft.selectedControls.length === 0) {
    addFieldError(fieldErrors, 'selectedControls', 'Select at least one Control.');
  }

  if (Array.isArray(draft.unsupportedParameterTypes) && draft.unsupportedParameterTypes.length > 0) {
    blockingMessage = `Unsupported parameter type: ${draft.unsupportedParameterTypes[0].type}`;
  }

  for (const selectedControl of draft.selectedControls || []) {
    const control = catalog.controlsById[selectedControl.controlId];
    if (!control) {
      addFieldError(fieldErrors, `selectedControl.${selectedControl.controlId}`, 'Selected Control is not available in the released catalog.');
      continue;
    }

    for (const parameter of control.parameters || []) {
      validateParameter(fieldErrors, control, parameter, selectedControl.parameters?.[parameter.id]);
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    sectionErrors.push('Resolve the highlighted Policy fields before saving.');
  }

  return {
    fieldErrors,
    sectionErrors,
    blockingMessage
  };
}
