const { isDeepStrictEqual } = require('node:util');

const AUTOMATION_TYPES = Object.freeze({
  'deploy-software': {
    label: 'Deploy Software',
    templateId: 'deploy_package',
    route: 'deploy-package',
    params: {
      display_summary: '',
      packages: [{ '': '' }],
      reboot_options: { auto_reboot: 'no' }
    }
  },
  'deploy-updates': {
    label: 'Deploy Updates',
    templateId: 'deploy_update',
    route: 'deploy-update',
    params: {
      require_update_approval: 'yes',
      scope: 'All',
      display_summary: 'All',
      excluded_updates: [],
      reboot_options: { auto_reboot: 'no' }
    }
  },
  reboot: {
    label: 'Reboot',
    templateId: 'reboot',
    route: 'reboot',
    params: {
      display_summary: 'without showing message',
      reboot_options: {
        show_message: 'no',
        message_text: '',
        timeout: 240
      }
    }
  },
  'run-script': {
    label: 'Run Script',
    templateId: 'run_script',
    route: 'run-script',
    params: {
      display_summary: '',
      condition_script_text: '',
      condition_script_language: 'PowerShell',
      run_script_params: [],
      run_script_text: '',
      run_script_language: 'PowerShell',
      platform: 'Windows',
      reboot_exit_codes: '',
      reboot_options: { auto_reboot: 'no' }
    }
  },
  'uninstall-software': {
    label: 'Uninstall Software',
    templateId: 'uninstall_program',
    route: 'uninstall-program',
    params: {
      display_summary: '',
      packages: [{ '': '' }],
      reboot_options: { auto_reboot: 'no' }
    }
  }
});

const CREATABLE_AUTOMATION_TYPE_IDS = Object.freeze(['deploy-software', 'deploy-updates', 'run-script']);

function automationType(typeId) {
  const type = AUTOMATION_TYPES[String(typeId || '').trim()];
  if (!type) throw new Error('Select a supported Action1 automation type.');
  return type;
}

function automationListItem(schedule, baseUrl, organizationId) {
  const templateIds = [...new Set(schedule.templateIds || [])];
  if (!templateIds.length || templateIds.includes('update_ring')) return null;
  const types = templateIds.map(templateId =>
    Object.entries(AUTOMATION_TYPES).find(([, type]) => type.templateId === templateId)
  );
  if (types.some(type => !type)) return null;

  return {
    id: schedule.id,
    name: schedule.name,
    typeLabel: types.map(([, type]) => type.label).join(', '),
    enabled: schedule.enabled,
    configurationReady: schedule.configurationReady,
    endpointGroupIds: schedule.endpointGroupIds,
    editUrl: buildAutomationEditUrl(baseUrl, organizationId, schedule.id, types[0][0])
  };
}

function normalizeEndpointGroupIds(endpointGroupIds) {
  return [...new Set((Array.isArray(endpointGroupIds) ? endpointGroupIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))];
}

function hourlyScheduleSettings(enabled, now = new Date()) {
  const timestamp = now.toISOString();
  const startTime = enabled ? timestamp.slice(11, 19).replace(/:/g, '-') : '00-00-00';
  return `${enabled ? 'ENABLED' : 'DISABLED'} EVERY:60 AT:${startTime} DATE:${timestamp.slice(0, 10)}`;
}

function hasConfiguredAction(schedule) {
  return (Array.isArray(schedule?.actions) ? schedule.actions : []).some(action => {
    const params = action?.params || {};
    if (action.template_id === 'deploy_package' || action.template_id === 'uninstall_program') {
      return (Array.isArray(params.packages) ? params.packages : []).some(pkg =>
        pkg && typeof pkg === 'object' && Object.entries(pkg).some(([id, version]) =>
          String(id).trim() && String(version || '').trim()
        )
      );
    }
    if (action.template_id === 'run_script') {
      return Boolean(String(params.run_script_id || params.run_script_text || '').trim());
    }
    if (action.template_id === 'deploy_update') {
      if (params.scope === 'All') return true;
      if (params.scope === 'MatchingFilters') return Array.isArray(params.filters) && params.filters.length > 0;
      if (params.scope === 'Specified') return Array.isArray(params.packages) && params.packages.some(pkg =>
        pkg && typeof pkg === 'object' && Object.keys(pkg).some(id => String(id).trim())
      );
      return false;
    }
    if (action.template_id === 'reboot') return Boolean(params.reboot_options && params.display_summary);
    return false;
  });
}

function hasSavedActionConfiguration(schedule) {
  if (!hasConfiguredAction(schedule)) return false;
  const settings = String(schedule?.settings || '');
  if (!/^DISABLED EVERY:60 AT:00-00-00 DATE:\d{4}-\d{2}-\d{2}$/.test(settings)) return true;

  const actions = schedule.actions || [];
  if (actions.length > 1) return true;
  return actions.some(action => {
    const draftType = Object.values(AUTOMATION_TYPES).find(type => type.templateId === action.template_id);
    return draftType && !isDeepStrictEqual(action.params || {}, draftType.params);
  });
}

function buildAutomationPayload({ name, typeId, endpointGroupIds, platform = 'windows' }) {
  const automationName = String(name || '').trim();
  if (!automationName) throw new Error('Automation name is required.');

  const type = automationType(typeId);
  if (!CREATABLE_AUTOMATION_TYPE_IDS.includes(typeId)) throw new Error('Select a supported Action1 automation type.');
  const groupIds = normalizeEndpointGroupIds(endpointGroupIds);
  if (!groupIds.length) throw new Error('Select at least one Action1 provisioning group before creating an automation.');

  const params = JSON.parse(JSON.stringify(type.params));
  if (typeId === 'run-script') {
    const action1Platform = { windows: 'Windows', macos: 'Mac', linux: 'Linux' }[platform];
    if (!action1Platform) throw new Error('Select a supported script platform.');
    params.platform = action1Platform;
    params.run_script_language = platform === 'windows' ? 'PowerShell' : 'Bash';
    params.condition_script_language = params.run_script_language;
  }

  return {
    name: automationName,
    endpoints: groupIds.map(id => ({ id, type: 'EndpointGroup' })),
    actions: [{
      name: type.label,
      template_id: type.templateId,
      params
    }],
    settings: hourlyScheduleSettings(false),
    settings_timezone: 'UTC',
    retry_minutes: '60'
  };
}

function action1ConsoleBase(baseUrl) {
  return String(baseUrl || 'https://app.action1.com/api/3.0')
    .replace(/\/+$/, '')
    .replace(/\/api\/3\.0$/i, '');
}

function buildAutomationEditUrl(baseUrl, organizationId, automationId, typeId) {
  const type = automationType(typeId);
  const params = new URLSearchParams({
    id: String(automationId || '').trim(),
    org: String(organizationId || '').trim()
  });
  return `${action1ConsoleBase(baseUrl)}/console/new-policy-${type.route}/step-1?${params.toString()}`;
}

module.exports = {
  AUTOMATION_TYPES,
  CREATABLE_AUTOMATION_TYPE_IDS,
  automationListItem,
  buildAutomationEditUrl,
  buildAutomationPayload,
  hasConfiguredAction,
  hasSavedActionConfiguration,
  hourlyScheduleSettings
};
