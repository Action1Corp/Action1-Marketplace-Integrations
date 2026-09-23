const GRAPH_BASE = 'https://graph.microsoft.com/beta';
const { hasSavedActionConfiguration } = require('./action1Automation');
const ASSIGNMENT_MODE_ALL_DEVICES = 'allDevices';
const ASSIGNMENT_MODE_SELECTED_GROUPS = 'selectedGroups';
const DEFAULT_ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';

function action1BaseUrl(credentials = {}) {
  return String(credentials.baseUrl || DEFAULT_ACTION1_BASE_URL).replace(/\/+$/, '');
}

function parseSelectedGroupIds(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).map(item => item.trim()).filter(Boolean);
  } catch {}
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeAssignmentMode(value) {
  return value === ASSIGNMENT_MODE_SELECTED_GROUPS ? ASSIGNMENT_MODE_SELECTED_GROUPS : ASSIGNMENT_MODE_ALL_DEVICES;
}

async function getGraphToken(settings) {
  const tenantId = settings.IntuneTenantId;
  const clientId = settings.IntuneClientId;
  const clientSecret = settings.IntuneClientSecret;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Intune tenant ID, client ID, or client secret');
  }
  if (clientSecret === '***') {
    throw new Error('Client secret is masked but no stored secret was found. Enter the client secret again, save settings, then validate.');
  }

  const tokenBody = new URLSearchParams();
  tokenBody.append('client_id', clientId);
  tokenBody.append('scope', 'https://graph.microsoft.com/.default');
  tokenBody.append('client_secret', clientSecret);
  tokenBody.append('grant_type', 'client_credentials');

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
  }
  return data.access_token;
}

async function graphGet(token, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.error_description || data.error || `HTTP ${response.status}`;
    const code = data.error?.code || '';
    if (response.status === 403 || code === 'Authorization_RequestDenied') {
      throw new Error(`${message} Required Microsoft Graph application permissions include DeviceManagementApps.ReadWrite.All and Group.Read.All or Directory.Read.All, with admin consent granted.`);
    }
    throw new Error(message);
  }
  return data;
}

async function graphGetAll(token, url) {
  const rows = [];
  let nextUrl = url;
  while (nextUrl) {
    const data = await graphGet(token, nextUrl);
    rows.push(...(data.value || []));
    nextUrl = data['@odata.nextLink'] || '';
  }
  return rows;
}

function action1Items(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.items || payload?.data || payload?.results || payload?.rows || payload?.organizations || payload?.endpoint_groups || payload?.groups || [];
}

async function getAction1Token(credentials) {
  const apiKey = credentials?.apiKey;
  const apiSecret = credentials?.apiSecret;
  const baseUrl = action1BaseUrl(credentials);
  if (!apiKey || !apiSecret) throw new Error('Action1 API key and secret are required.');

  const tokenBody = new URLSearchParams();
  tokenBody.append('grant_type', 'client_credentials');
  tokenBody.append('client_id', apiKey);
  tokenBody.append('client_secret', apiSecret);

  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Action1 authentication failed with HTTP ${response.status}.`);
  }
  return data.access_token;
}

async function action1Get(token, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error_description || data.error || `Action1 request failed with HTTP ${response.status}.`);
  }
  return data;
}

async function action1GetAll(token, firstUrl, baseUrl = DEFAULT_ACTION1_BASE_URL) {
  const rows = [];
  let url = firstUrl;
  let pages = 0;
  while (url && pages < 50) {
    const data = await action1Get(token, url);
    const items = action1Items(data);
    rows.push(...items);
    pages += 1;

    const nextUrl = data.next || data.next_link || data.nextLink || '';
    if (nextUrl) {
      url = String(nextUrl).startsWith('http') ? nextUrl : `${baseUrl}${nextUrl}`;
      continue;
    }

    const from = Number(data.from);
    const total = Number(data.total_items ?? data.totalItems ?? data.total);
    if (Number.isFinite(from) && Number.isFinite(total) && from + items.length < total && items.length > 0) {
      const nextFrom = from + items.length;
      url = firstUrl.replace(/([?&])from=\d+/, `$1from=${nextFrom}`);
      if (url === firstUrl && !/[?&]from=/.test(url)) url += `${url.includes('?') ? '&' : '?'}from=${nextFrom}`;
      continue;
    }

    break;
  }
  return rows;
}

function normalizeAction1Organization(row) {
  const id = String(row?.id || row?.org_id || row?.organizationId || row?.organization_id || '').trim();
  const name = String(row?.name || row?.org_name || row?.organizationName || row?.organization_name || '').trim();
  const agentId = String(
    row?.agent_id ||
    row?.agentId ||
    row?.installer_id ||
    row?.installerId ||
    row?.download_id ||
    row?.downloadId ||
    row?.agent_download_id ||
    row?.agentDownloadId ||
    ''
  ).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    agentId
  };
}

function extractAgentIdFromDownloadUrl(downloadUrl) {
  const match = String(downloadUrl || '').match(/\/agent\/([^/]+)\//i);
  return match ? decodeURIComponent(match[1]) : '';
}

function extractAgentDownloadOrgNameFromDownloadUrl(downloadUrl) {
  const match = String(downloadUrl || '').match(/\/Windows\/agent\(([^)]+)\)\.msi(?:$|[?#])/i);
  return match ? decodeURIComponent(match[1]) : '';
}

async function getAction1AgentInstallerForOrganization(token, baseUrl, organizationId) {
  if (!organizationId) return { agentId: '', agentDownloadOrgName: '' };
  try {
    const data = await action1Get(
      token,
      `${baseUrl}/endpoints/agent-installation/${encodeURIComponent(organizationId)}/windowsMSI`
    );
    const downloadUrl = data.download_URL || data.downloadUrl || data.url || '';
    return {
      agentId: extractAgentIdFromDownloadUrl(downloadUrl),
      agentDownloadOrgName: extractAgentDownloadOrgNameFromDownloadUrl(downloadUrl)
    };
  } catch {
    return { agentId: '', agentDownloadOrgName: '' };
  }
}

async function listAction1Organizations(credentials) {
  const baseUrl = action1BaseUrl(credentials);
  const token = await getAction1Token(credentials);
  const organizations = await action1GetAll(
    token,
    `${baseUrl}/organizations?limit=500&from=0`,
    baseUrl
  );
  const seen = new Set();
  const normalizedOrganizations = organizations
    .map(normalizeAction1Organization)
    .filter(Boolean)
    .filter(organization => {
      if (seen.has(organization.id)) return false;
      seen.add(organization.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(normalizedOrganizations.map(async organization => {
    const installer = await getAction1AgentInstallerForOrganization(token, baseUrl, organization.id);
    return {
      ...organization,
      agentId: organization.agentId || installer.agentId,
      agentDownloadOrgName: installer.agentDownloadOrgName || organization.name
    };
  }));
}

async function findAction1App(token) {
  const apps = await graphGetAll(
    token,
    `${GRAPH_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')`
  );
  return apps.find(app => app.displayName && app.displayName.toLowerCase().includes('action1')) || null;
}

function normalizeAssignment(assignment) {
  const target = assignment.target || {};
  const type = String(target['@odata.type'] || '').toLowerCase();
  const groupId = target.groupId || '';
  return {
    id: assignment.id,
    intent: assignment.intent || '',
    targetType: type.includes('alldevices') ? 'allDevices' : type.includes('group') ? 'group' : 'other',
    groupId
  };
}

async function getAppAssignments(token, appId) {
  const assignments = await graphGetAll(
    token,
    `${GRAPH_BASE}/deviceAppManagement/mobileApps/${encodeURIComponent(appId)}/assignments`
  );
  return assignments.map(normalizeAssignment);
}

async function listDeviceGroups(settings) {
  const token = await getGraphToken(settings);
  const groups = await graphGetAll(
    token,
    'https://graph.microsoft.com/v1.0/groups?$select=id,displayName,description,securityEnabled,mailEnabled,groupTypes,membershipRule'
  );
  return groups
    .filter(group => group.securityEnabled || (group.groupTypes || []).includes('DynamicMembership'))
    .map(group => ({
      id: group.id,
      displayName: group.displayName || group.id,
      description: group.description || '',
      dynamic: (group.groupTypes || []).includes('DynamicMembership') || Boolean(group.membershipRule),
      mailEnabled: Boolean(group.mailEnabled),
      securityEnabled: Boolean(group.securityEnabled)
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function listAction1EndpointGroups(credentials) {
  const organizationId = credentials?.organizationId;
  if (!organizationId) throw new Error('Action1 organization ID is required.');

  const baseUrl = action1BaseUrl(credentials);
  const token = await getAction1Token(credentials);
  const groups = await action1GetAll(
    token,
    `${baseUrl}/endpoints/groups/${encodeURIComponent(organizationId)}?limit=500&from=0`,
    baseUrl
  );

  return groups
    .map(group => ({
      id: String(group.id || group.group_id || group.groupId || group.name || '').trim(),
      name: String(group.name || group.displayName || group.display_name || group.id || '').trim(),
      description: String(group.description || '').trim(),
      endpointCount: null
    }))
    .filter(group => group.id && group.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeAction1GroupIds(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => String(item?.id || item?.group_id || item?.groupId || '').trim())
    .filter(Boolean);
}

function normalizeAction1AutomationSchedule(schedule) {
  return {
    id: String(schedule.id || schedule.schedule_id || schedule.scheduleId || schedule.name || '').trim(),
    name: String(schedule.name || schedule.displayName || schedule.display_name || schedule.id || '').trim(),
    enabled: schedule.enabled !== false && !/^DISABLED\b/i.test(String(schedule.settings || '')),
    configurationReady: hasSavedActionConfiguration(schedule),
    endpointGroupIds: normalizeAction1GroupIds(schedule.endpoints || schedule.endpoint_groups || schedule.endpointGroups || schedule.targets),
    templateIds: (Array.isArray(schedule.actions) ? schedule.actions : [])
      .map(action => String(action.template_id || action.templateId || '').trim())
      .filter(Boolean)
  };
}

async function listAction1AutomationSchedules(credentials) {
  const organizationId = credentials?.organizationId;
  if (!organizationId) throw new Error('Action1 organization ID is required.');

  const baseUrl = action1BaseUrl(credentials);
  const token = await getAction1Token(credentials);
  const schedules = await action1GetAll(
    token,
    `${baseUrl}/automations/schedules/${encodeURIComponent(organizationId)}?limit=500&from=0`,
    baseUrl
  );

  return schedules
    .map(normalizeAction1AutomationSchedule)
    .filter(schedule => schedule.id && schedule.name);
}

async function validateAssignments(settings) {
  const token = await getGraphToken(settings);
  const mode = normalizeAssignmentMode(settings.IntuneAssignmentTargetMode);
  const selectedGroupIds = parseSelectedGroupIds(settings.IntuneDeviceGroupIds);

  if (mode === ASSIGNMENT_MODE_SELECTED_GROUPS && selectedGroupIds.length === 0) {
    return {
      ok: false,
      message: 'Selected device groups mode requires at least one group.',
      mode,
      selectedGroupIds,
      missingGroupIds: selectedGroupIds,
      staleGroupIds: []
    };
  }

  const app = await findAction1App(token);
  if (!app) {
    return {
      ok: false,
      message: 'No Action1 Agent Win32 app was found in Intune.',
      mode,
      selectedGroupIds,
      missingGroupIds: selectedGroupIds,
      staleGroupIds: []
    };
  }

  const assignments = await getAppAssignments(token, app.id);
  const requiredAssignments = assignments.filter(assignment => assignment.intent === 'required');
  const hasAllDevices = requiredAssignments.some(assignment => assignment.targetType === 'allDevices');
  const assignedGroupIds = requiredAssignments
    .filter(assignment => assignment.targetType === 'group' && assignment.groupId)
    .map(assignment => assignment.groupId);
  const assignedGroupSet = new Set(assignedGroupIds);
  const selectedGroupSet = new Set(selectedGroupIds);
  const missingGroupIds = selectedGroupIds.filter(groupId => !assignedGroupSet.has(groupId));
  const staleGroupIds = assignedGroupIds.filter(groupId => !selectedGroupSet.has(groupId));

  const ok = mode === ASSIGNMENT_MODE_ALL_DEVICES ? hasAllDevices : missingGroupIds.length === 0;
  const message = ok
    ? (mode === ASSIGNMENT_MODE_ALL_DEVICES ? 'Action1 Agent App is configured for All Devices' : 'Action1 Agent is assigned to all selected device groups.')
    : (mode === ASSIGNMENT_MODE_ALL_DEVICES ? 'Action1 Agent is not assigned to All devices as required.' : `Missing ${missingGroupIds.length} selected group assignment${missingGroupIds.length === 1 ? '' : 's'}.`);

  return {
    ok,
    message,
    app: {
      id: app.id,
      displayName: app.displayName,
      displayVersion: app.displayVersion || app.committedContentVersion || ''
    },
    mode,
    selectedGroupIds,
    hasAllDevices,
    assignedGroupIds,
    missingGroupIds,
    staleGroupIds
  };
}

async function validateIntune(settings) {
  try {
    await getGraphToken(settings);
    return { ok: true, message: 'Connected - token acquired' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validate({ settings }) {
  return {
    intune: await validateIntune(settings)
  };
}

module.exports = {
  listAction1AutomationSchedules,
  normalizeAction1AutomationSchedule,
  listAction1EndpointGroups,
  listAction1Organizations,
  listDeviceGroups,
  validate,
  validateAssignments
};
