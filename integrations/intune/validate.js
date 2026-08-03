const GRAPH_BASE = 'https://graph.microsoft.com/beta';
const ASSIGNMENT_MODE_ALL_DEVICES = 'allDevices';
const ASSIGNMENT_MODE_SELECTED_GROUPS = 'selectedGroups';

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
  listDeviceGroups,
  validate,
  validateAssignments
};
