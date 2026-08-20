const EM_DASH = '\u2014';

export function deriveDisplayName(baseName, scopeLabel) {
  const trimmedBaseName = String(baseName || '').trim();
  const trimmedScopeLabel = String(scopeLabel || '').trim();

  if (!trimmedBaseName) {
    return '';
  }

  if (!trimmedScopeLabel) {
    return trimmedBaseName;
  }

  return `${trimmedBaseName} ${EM_DASH} ${trimmedScopeLabel}`;
}

export function formatPolicyStatus(policy) {
  return policy?.enabled === false ? 'Disabled' : 'Enabled';
}

export function formatPolicyMode(policyMode) {
  return policyMode === 'ASSESS_AND_REMEDIATE' ? 'Assess and remediate' : 'Assess only';
}

export function formatPolicyScope(policy) {
  return policy?.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : policy?.endpointGroupNameSnapshot || '';
}

export function formatPolicySchedule(runSchedule = {}) {
  const runEveryHours = Number(runSchedule.runEveryHours || 0);
  return `Every ${runEveryHours} h`;
}

function buildConsoleUrlFromCorrelation(row) {
  const automationName = row.canonicalAutomationName || row.action1AutomationName;
  if (row.canonicalAutomationName && row.action1AutomationSelf && row.action1OrganizationId) {
    try {
      const origin = new URL(row.action1AutomationSelf).origin;
      const url = new URL('/console/automations', origin);
      url.search = new URLSearchParams({
        limit: '200', from: '0', 'add_endpoints-limit': '200', 'add_endpoints-from': '0',
        org: row.action1OrganizationId,
        filter: encodeURIComponent(automationName)
      }).toString();
      return url.toString();
    } catch {
      return '';
    }
  }
  if (row.action1ConsoleUrl) return row.action1ConsoleUrl;
  if (!row.action1AutomationSelf || !automationName || !row.action1OrganizationId) return '';
  try {
    const origin = new URL(row.action1AutomationSelf).origin;
    const url = new URL('/console/automations', origin);
    url.search = new URLSearchParams({
      limit: '200', from: '0', 'add_endpoints-limit': '200', 'add_endpoints-from': '0',
      org: row.action1OrganizationId,
      filter: encodeURIComponent(automationName)
    }).toString();
    return url.toString();
  } catch {
    return '';
  }
}

function formatCountLabel(count, singularLabel, pluralLabel = `${singularLabel}s`) {
  const normalizedCount = Number(count || 0);
  return `${normalizedCount} ${normalizedCount === 1 ? singularLabel : pluralLabel}`;
}

function formatBooleanParameter(parameter, value) {
  if (parameter.label === 'Allowed') {
    return value ? 'Allowed' : 'Not allowed';
  }

  if (parameter.label === 'Enabled') {
    return value ? 'Enabled' : 'Disabled';
  }

  return value ? 'On' : 'Off';
}

export function formatParameterValue(parameter, value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (parameter.type === 'boolean') {
    return formatBooleanParameter(parameter, Boolean(value));
  }

  if (parameter.type === 'enum') {
    const option = (parameter.options || []).find((entry) => entry.value === value);
    return option ? option.label : String(value);
  }

  if (parameter.type === 'integer') {
    const normalizedValue = Number(value);
    if (!Number.isFinite(normalizedValue)) {
      return String(value);
    }

    return parameter.unit ? `${normalizedValue} ${parameter.unit}` : String(normalizedValue);
  }

  return String(value);
}

function buildCompactControlChips(control, selectedControl) {
  return (control.parameters || [])
    .filter((parameter) => Object.prototype.hasOwnProperty.call(selectedControl.parameters || {}, parameter.id))
    .map((parameter) => ({
      label: parameter.label,
      value: formatParameterValue(parameter, selectedControl.parameters?.[parameter.id])
    }))
    .filter((parameter) => parameter.value !== '');
}

export function buildCompactControlFamilyGroups({ selectedControls, action1Automations = [], catalog }) {
  if (!catalog) {
    return [];
  }

  const normalizedAutomationRows = action1Automations.map((automationRow) => ({
    ...automationRow,
    automationId: automationRow.automationId || automationRow.action1AutomationId,
    controlFamilyName: automationRow.controlFamilyName || automationRow.controlFamilyNameSnapshot,
    automationName: automationRow.automationName || automationRow.action1AutomationName,
    action1Url: buildConsoleUrlFromCorrelation(automationRow) || (automationRow.action1Url && !automationRow.action1Url.includes('/api/3.0/') ? automationRow.action1Url : '')
  }));
  const automationRowsByFamilyName = new Map(
    normalizedAutomationRows.map((automationRow) => [automationRow.controlFamilyName, automationRow])
  );
  const automationRowsByFamilyId = new Map(
    normalizedAutomationRows.map((automationRow) => [automationRow.automationGroupId, automationRow])
  );
  const groups = new Map();

  for (const selectedControl of Array.isArray(selectedControls) ? selectedControls : []) {
    const control = catalog.controlsById?.[selectedControl.controlId];
    const controlFamily = catalog.controlFamiliesById?.[selectedControl.automationGroupId];

    if (!control || !controlFamily) {
      continue;
    }

    if (!groups.has(controlFamily.automationGroupId)) {
      groups.set(controlFamily.automationGroupId, {
        automationGroupId: controlFamily.automationGroupId,
        familyId: controlFamily.automationGroupId,
        familyName: controlFamily.name,
        automationLink: automationRowsByFamilyId.get(controlFamily.automationGroupId) || automationRowsByFamilyName.get(controlFamily.name) || null,
        selectedCount: 0,
        controls: []
      });
    }

    const group = groups.get(controlFamily.automationGroupId);
    group.selectedCount += 1;
    group.controls.push({
      controlKey: `${controlFamily.automationGroupId}:${control.name}`,
      controlName: control.name,
      chips: buildCompactControlChips(control, selectedControl)
    });
  }

  return Array.from(groups.values());
}

export function formatPolicyListRow(policy) {
  return {
    policyName: policy.displayName,
    status: formatPolicyStatus(policy),
    targetPrimary: policy.organizationNameSnapshot,
    targetSecondary: formatPolicyScope(policy),
    modeLabel: formatPolicyMode(policy.policyMode),
    scheduleLabel: formatPolicySchedule(policy.runSchedule)
  };
}

export function getPolicyRowActions(policy) {
  const actions = ['openDetails', 'edit'];
  actions.push(policy?.enabled === false ? 'enable' : 'disable');
  actions.push('delete');
  return actions;
}

export function formatPolicyDetails(policy, catalog) {
  const selectedControls = Array.isArray(policy.selectedControls) ? policy.selectedControls : [];
  const action1Automations = Array.isArray(policy.action1Automations) ? policy.action1Automations : [];

  return {
    policyName: policy.displayName,
    statusLabel: formatPolicyStatus(policy),
    organizationLabel: policy.organizationNameSnapshot,
    scopeLabel: formatPolicyScope(policy),
    policyModeLabel: formatPolicyMode(policy.policyMode),
    scheduleLabel: formatPolicySchedule(policy.runSchedule),
    completionDeadlineLabel: `${Number(policy.completionDeadlineMinutes || 0)} minutes`,
    controlsCountLabel: formatCountLabel(selectedControls.length, 'selected Control'),
    controlFamiliesCountLabel: formatCountLabel(policy.selectedFamilyCount || 0, 'Control Family', 'Control Families'),
    automationsCountLabel: formatCountLabel(policy.expectedAutomationCount || 0, 'Action1 automation'),
    automationRows: action1Automations.map((automationRow) => ({
      ...automationRow,
      automationId: automationRow.automationId || automationRow.action1AutomationId,
      controlFamilyName: automationRow.controlFamilyName || automationRow.controlFamilyNameSnapshot,
      automationName: automationRow.automationName || automationRow.action1AutomationName,
      action1Url: buildConsoleUrlFromCorrelation(automationRow) || (automationRow.action1Url && !automationRow.action1Url.includes('/api/3.0/') ? automationRow.action1Url : '')
    })),
    controlFamilyGroups: buildCompactControlFamilyGroups({
      selectedControls,
      action1Automations,
      catalog
    })
  };
}
