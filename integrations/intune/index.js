const { listAction1AutomationSchedules, listAction1EndpointGroups, listAction1Organizations, listDeviceGroups, normalizeAction1AutomationSchedule, validate, validateAssignments } = require('./validate');
const { sync } = require('./sync');
const { createIntunePolicyStore } = require('./policyStore');
const { automationListItem, buildAutomationEditUrl, buildAutomationPayload, hasSavedActionConfiguration, hourlyScheduleSettings } = require('./action1Automation');

const ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE = 'Action1 Provisioning Status';
const ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE = 'Completed';
const DEFAULT_ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';

function action1BaseUrl(credentials = {}) {
  return String(credentials.baseUrl || DEFAULT_ACTION1_BASE_URL).replace(/\/+$/, '');
}

function summarizeValidationResult(result) {
  const checks = Object.values(result || {}).filter(value => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ok'));
  const ok = checks.length > 0 ? checks.every(check => check.ok !== false) : true;
  const message = checks.map(check => check.message).filter(Boolean).join(' | ') || (ok ? 'Validation completed.' : 'Validation failed.');
  return { ok, message, details: result };
}

function normalizeComparableName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolvePolicyOrganization(policy, organizations) {
  const policyOrganizationId = String(policy.organizationId || '').trim();
  const policyOrganizationName = normalizeComparableName(policy.organizationName);
  const policyAgentId = String(policy.agentId || '').trim().toLowerCase();
  return organizations.find(organization => {
    const organizationId = String(organization.id || '').trim();
    const organizationName = normalizeComparableName(organization.name);
    const agentId = String(organization.agentId || '').trim().toLowerCase();
    return (
      (policyOrganizationId && organizationId === policyOrganizationId) ||
      (policyAgentId && agentId && policyAgentId === agentId) ||
      (policyOrganizationName && organizationName && policyOrganizationName === organizationName)
    );
  }) || null;
}

async function hydratePoliciesWithAction1Organizations(context, policies) {
  if (!policies.length) return policies;
  try {
    const credentials = await context.action1.getCredentials();
    const organizations = await listAction1Organizations(credentials);
    const store = createIntunePolicyStore(context);
    const hydrated = [];
    let changed = false;

    for (const policy of policies) {
      const organization = resolvePolicyOrganization(policy, organizations);
      if (!organization) {
        hydrated.push(policy);
        continue;
      }

      const nextPolicy = {
        ...policy,
        organizationId: organization.id || policy.organizationId,
        organizationName: organization.name || policy.organizationName,
        agentId: organization.agentId || policy.agentId,
        agentDownloadOrgName: organization.agentDownloadOrgName || policy.agentDownloadOrgName || policy.organizationName
      };
      changed = changed ||
        nextPolicy.organizationId !== policy.organizationId ||
        nextPolicy.organizationName !== policy.organizationName ||
        nextPolicy.agentId !== policy.agentId ||
        nextPolicy.agentDownloadOrgName !== policy.agentDownloadOrgName;
      hydrated.push(nextPolicy);
    }

    if (changed) {
      for (const policy of hydrated) await store.savePolicy(policy);
      return await store.listPolicies();
    }

    return hydrated;
  } catch (error) {
    context.logger?.warn?.('[Intune] Unable to hydrate policy organization details:', error.message || error);
    return policies;
  }
}

async function validateConfiguration(context, request) {
  const result = await validate({
    settings: request.settings || {},
    action1: context.action1,
    logger: context.logger
  });
  return summarizeValidationResult(result);
}

async function syncAction(context) {
  await sync(context);
  const latestRun = await context.db.get(
    'SELECT id, status, details, assets_processed FROM sync_history WHERE integration_id = ? ORDER BY id DESC LIMIT 1',
    [context.integrationId]
  );
  const failed = latestRun?.status === 'Failed' || latestRun?.status === 'Interrupted';
  return {
    ok: !failed,
    message: failed ? 'Sync failed.' : 'Sync completed.',
    details: latestRun?.details || '',
    runId: latestRun?.id || null,
    assetsProcessed: latestRun?.assets_processed || 0
  };
}

async function storedIntuneSettings(context, overrides = {}) {
  const keys = ['IntuneTenantId', 'IntuneClientId', 'IntuneClientSecret'];
  const entries = await Promise.all(keys.map(async key => [key, overrides[key] || await context.settings.get(key)]));
  return { ...Object.fromEntries(entries), ...overrides };
}

async function listDeviceGroupsAction(context, request) {
  const groups = await listDeviceGroups(await storedIntuneSettings(context, request.settings || {}));
  return {
    ok: true,
    message: `Loaded ${groups.length} Intune device group${groups.length === 1 ? '' : 's'}.`,
    groups
  };
}

async function validateAssignmentsAction(context, request) {
  const result = await validateAssignments(await storedIntuneSettings(context, request.settings || {}));
  return {
    ...result,
    details: result
  };
}

async function listAction1EndpointGroupsAction(context, request) {
  const credentials = await context.action1.getCredentials();
  const selectedOrganizationId = String(
    request.payload?.organizationId ||
    request.settings?.organizationId ||
    request.settings?.IntuneAction1OrgId ||
    ''
  ).trim();
  if (selectedOrganizationId) credentials.organizationId = selectedOrganizationId;
  const groups = await listAction1EndpointGroups(credentials);
  const token = await getAction1Token(context, credentials);
  const headers = { Authorization: `Bearer ${token}` };
  const enrichedGroups = [];
  for (let start = 0; start < groups.length; start += 5) {
    const batch = await Promise.all(groups.slice(start, start + 5).map(async group => {
      let endpointCount = null;
      try {
        const url = `${action1BaseUrl(credentials)}/endpoints/groups/${encodeURIComponent(credentials.organizationId)}/${encodeURIComponent(group.id)}/contents?limit=1&from=0`;
        const response = await context.http.get(url, { headers });
        const total = response.data?.total_items;
        const parsed = Number(total);
        if (total != null && Number.isFinite(parsed) && parsed >= 0) endpointCount = parsed;
      } catch (error) {
        context.logger?.warn?.('[Intune] Unable to load Action1 endpoint group count:', error.message || error);
      }
      return {
        ...group,
        endpointCount,
        editable: !isProtectedAction1EndpointGroup(group),
        editUrl: action1EndpointGroupEditUrl(credentials, credentials.organizationId, group.id)
      };
    }));
    enrichedGroups.push(...batch);
  }
  return {
    ok: true,
    message: `Loaded ${enrichedGroups.length} Action1 endpoint group${enrichedGroups.length === 1 ? '' : 's'}.`,
    groups: enrichedGroups
  };
}

function isProtectedAction1EndpointGroup(group) {
  return String(group?.name || '').trim().toLowerCase() === 'new endpoints';
}

function action1EndpointGroupEditUrl(credentials, organizationId, groupId) {
  return `${action1BaseUrl(credentials).replace(/\/api\/3\.0$/i, '')}/console/endpoints/groups/${encodeURIComponent(groupId)}/settings?org=${encodeURIComponent(organizationId)}`;
}

async function createAction1EndpointGroupAction(context, request = {}) {
  const organizationId = String(request.payload?.organizationId || '').trim();
  const name = String(request.payload?.name || '').trim();
  if (!organizationId) throw new Error('Choose an Action1 organization before creating a group.');
  if (!name) throw new Error('Endpoint group name is required.');

  const credentials = await context.action1.getCredentials();
  if (!credentials.apiKey || !credentials.apiSecret) throw new Error('Action1 API credentials are required.');
  const token = await getAction1Token(context, credentials);
  let response;
  try {
    response = await context.http.post(
      `${action1BaseUrl(credentials)}/endpoints/groups/${encodeURIComponent(organizationId)}`,
      { name },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    throw new Error(error.response?.data?.user_message || error.response?.data?.developer_message || error.message);
  }
  const created = response.data || {};
  const id = String(created.id || '').trim();
  if (!id) throw new Error('Action1 created the group but did not return its ID. Refresh the group list before trying again.');
  return {
    ok: true,
    groupUrl: action1EndpointGroupEditUrl(credentials, organizationId, id),
    group: {
      id,
      name: String(created.name || name).trim(),
      description: String(created.description || '').trim(),
      endpointCount: null,
      editable: true,
      editUrl: action1EndpointGroupEditUrl(credentials, organizationId, id)
    }
  };
}

async function deleteAction1EndpointGroupAction(context, request = {}) {
  const organizationId = String(request.payload?.organizationId || '').trim();
  const groupId = String(request.payload?.groupId || '').trim();
  if (!organizationId || !groupId) throw new Error('Action1 organization and endpoint group are required.');

  const store = createIntunePolicyStore(context);
  const profiles = await store.listPolicies();
  const assignedProfiles = profiles.filter(profile => profile.organizationId === organizationId && profile.monitoredAction1GroupIds?.includes(groupId));
  const profileId = String(request.payload?.profileId || '').trim();
  const profile = assignedProfiles.length === 1 && assignedProfiles[0].policyId === profileId ? assignedProfiles[0] : null;
  if (assignedProfiles.length && !profile) {
    throw new Error('This group belongs to a saved profile. Edit that profile and deselect the group before deleting it.');
  }

  const selectedGroupIds = Array.isArray(request.payload?.selectedGroupIds) ? request.payload.selectedGroupIds.map(String) : [];
  if (profile && selectedGroupIds.includes(groupId)) throw new Error('Deselect this group from the profile before deleting it.');
  if (profile && !selectedGroupIds.length) throw new Error('Select another provisioning group before deleting this one.');
  const selectedGroupMap = request.payload?.selectedGroupMap || {};

  const credentials = await context.action1.getCredentials();
  const token = await getAction1Token(context, credentials);
  const url = `${action1BaseUrl(credentials)}/endpoints/groups/${encodeURIComponent(organizationId)}/${encodeURIComponent(groupId)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const removeGroup = async () => {
    try {
      const response = await context.http.get(url, { headers });
      if (isProtectedAction1EndpointGroup(response.data)) throw new Error('The Action1 New Endpoints group cannot be deleted.');
      await context.http.delete(url, { headers });
    } catch (error) {
      throw new Error(error.response?.data?.user_message || error.response?.data?.developer_message || error.message);
    }
  };
  if (profile) {
    await store.savePolicy({
      ...profile,
      monitoredAction1GroupIds: selectedGroupIds,
      monitoredAction1GroupMap: Object.fromEntries(selectedGroupIds.map(id => [id, selectedGroupMap[id] || profile.monitoredAction1GroupMap?.[id] || id]))
    }, async candidate => {
      await ensureProvisioningGroupFilters(context, candidate);
      await removeGroup();
    });
  } else {
    await removeGroup();
  }
  return { ok: true, groupId };
}

function isConfigurationPolicyAutomation(name) {
  return /^A1CM\b/i.test(String(name || '').trim());
}

async function listConfigurationPoliciesByEndpointGroup(context, organizationId) {
  try {
    const rows = await context.db.all(
      `SELECT policy_id, base_name, display_name, endpoint_group_id, endpoint_group_name_snapshot
         FROM action1_configuration_manager_policies
        WHERE organization_id = ?
          AND enabled = 1
          AND scope_type = 'ENDPOINT_GROUP'`,
      [organizationId]
    );
    const byGroupId = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const groupId = String(row.endpoint_group_id || '').trim();
      if (!groupId) continue;
      if (!byGroupId.has(groupId)) byGroupId.set(groupId, []);
      byGroupId.get(groupId).push({
        id: String(row.policy_id || '').trim(),
        name: String(row.base_name || row.display_name || row.policy_id || '').trim(),
        displayName: String(row.display_name || row.base_name || row.policy_id || '').trim(),
        endpointGroupName: String(row.endpoint_group_name_snapshot || '').trim()
      });
    }
    return byGroupId;
  } catch {
    return new Map();
  }
}

async function listAction1EndpointGroupDetailsAction(context, request) {
  const credentials = await context.action1.getCredentials();
  const selectedOrganizationId = String(
    request.payload?.organizationId ||
    request.settings?.organizationId ||
    request.settings?.IntuneAction1OrgId ||
    ''
  ).trim();
  if (selectedOrganizationId) credentials.organizationId = selectedOrganizationId;

  const groups = await listAction1EndpointGroups(credentials);
  let schedules = [];
  let scheduleWarning = '';
  try {
    schedules = await listAction1AutomationSchedules(credentials);
  } catch (error) {
    scheduleWarning = 'Action1 automation schedules could not be loaded. Configuration Management policies are still shown.';
    context.logger?.warn?.('[Intune] Unable to load Action1 automation schedules for endpoint group details:', error.message || error);
  }
  const configurationPoliciesByGroup = await listConfigurationPoliciesByEndpointGroup(context, credentials.organizationId);
  const groupDetails = {};

  for (const group of groups) {
    const provisioningAutomations = schedules
      .filter(schedule => schedule.endpointGroupIds.includes(group.id))
      .filter(schedule => !isConfigurationPolicyAutomation(schedule.name))
      .map(schedule => automationListItem(schedule, action1BaseUrl(credentials), credentials.organizationId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const configurationPolicies = (configurationPoliciesByGroup.get(group.id) || [])
      .sort((a, b) => a.name.localeCompare(b.name));

    groupDetails[group.id] = {
      provisioningAutomations,
      configurationPolicies
    };
  }

  return {
    ok: true,
    message: scheduleWarning || `Loaded monitoring details for ${groups.length} Action1 endpoint group${groups.length === 1 ? '' : 's'}.`,
    groupDetails,
    scheduleWarning
  };
}

async function listPoliciesAction(context) {
  const store = createIntunePolicyStore(context);
  const policies = await store.listPolicies();
  return {
    ok: true,
    policies: await hydratePoliciesWithAction1Organizations(context, policies)
  };
}

async function getPolicyAction(context, request = {}) {
  const policyId = String(request.payload?.policyId || '').trim();
  if (!policyId) return { ok: false, message: 'Profile id is required.' };
  const store = createIntunePolicyStore(context);
  const policy = await store.getPolicy(policyId);
  return policy ? { ok: true, policy } : { ok: false, message: 'Profile was not found.' };
}

async function savePolicyAction(context, request = {}) {
  try {
    const store = createIntunePolicyStore(context);
    const policy = await store.savePolicy(request.payload?.policy || request.payload || {}, async candidate => {
      if (candidate.provisioningEnabled) await ensureProvisioningGroupFilters(context, candidate);
    });
    return { ok: true, message: 'Profile saved.', policy };
  } catch (error) {
    return { ok: false, message: error.message || 'Unable to save profile.' };
  }
}

async function deletePolicyAction(context, request = {}) {
  try {
    const policyId = String(request.payload?.policyId || '').trim();
    if (!policyId) throw new Error('Profile id is required.');
    const store = createIntunePolicyStore(context);
    await store.deletePolicy(policyId);
    return { ok: true, message: 'Profile deleted.', policyId };
  } catch (error) {
    return { ok: false, message: error.message || 'Unable to delete profile.' };
  }
}

async function listAction1OrganizationsAction(context) {
  const credentials = await context.action1.getCredentials();
  const organizations = await listAction1Organizations(credentials);
  return {
    ok: true,
    message: `Loaded ${organizations.length} Action1 organization${organizations.length === 1 ? '' : 's'}.`,
    organizations,
    selectedOrganizationId: credentials.organizationId || ''
  };
}

async function getAction1Token(context, credentials) {
  const response = await context.http.post(
    `${action1BaseUrl(credentials)}/oauth2/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.apiKey,
      client_secret: credentials.apiSecret
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const token = response.data?.access_token;
  if (!token) throw new Error('Action1 authentication did not return an access token.');
  return token;
}

async function ensureProvisioningGroupFilters(context, policy) {
  const credentials = await context.action1.getCredentials();
  if (!credentials.apiKey || !credentials.apiSecret) throw new Error('Action1 API credentials are required.');
  const base = action1BaseUrl(credentials);
  const token = await getAction1Token(context, credentials);
  const headers = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  const attribute = ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE;
  let attributeSetting = null;
  for (let offset = 0; offset < 500; offset += 100) {
    const response = await context.http.get(`${base}/settings/all?limit=100&from=${offset}`, { headers });
    const items = Array.isArray(response.data) ? response.data : response.data?.items || [];
    attributeSetting = items.find(item => item?.template_id === 'endpoint_custom_attributes' ||
      String(item?.name || '').toLowerCase() === 'endpoint custom attributes');
    if (attributeSetting || items.length < 100) break;
  }
  if (attributeSetting) {
    let attributes;
    try {
      attributes = JSON.parse(attributeSetting.value || '[]');
    } catch {
      throw new Error('Action1 endpoint custom attribute settings are invalid.');
    }
    if (!Array.isArray(attributes)) throw new Error('Action1 endpoint custom attribute settings are invalid.');
    if (!attributes.some(item => String(item?.name || '').trim().toLowerCase() === attribute.toLowerCase())) {
      await context.http.patch(`${base}/settings/all/${encodeURIComponent(attributeSetting.id)}`, {
        value: JSON.stringify([...attributes, { name: attribute }]),
        scope: attributeSetting.scope || [{ type: 'Enterprise', object: 'All' }]
      }, { headers: jsonHeaders });
    }
  } else {
    await context.http.post(`${base}/settings/all`, {
      template_id: 'endpoint_custom_attributes',
      value: JSON.stringify([{ name: attribute }]),
      scope: [{ type: 'Enterprise', object: 'All' }]
    }, { headers: jsonHeaders });
  }

  const field = `custom:${attribute}`;
  const value = ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE;
  for (const groupId of [...new Set(policy.monitoredAction1GroupIds)]) {
    const url = `${base}/endpoints/groups/${encodeURIComponent(policy.organizationId)}/${encodeURIComponent(groupId)}`;
    try {
      const response = await context.http.get(url, { headers });
      const group = response.data || {};
      const filters = Array.isArray(group.exclude_filter) ? group.exclude_filter : [];
      const matching = filter => String(filter?.field_name || '').trim().toLowerCase() === field.toLowerCase() &&
        String(filter?.field_value || '').trim().toLowerCase() === value.toLowerCase();
      if (filters.some(filter => matching(filter) && String(filter.mode || '').toLowerCase() === 'include')) continue;
      await context.http.patch(url, {
        exclude_filter: [...filters.filter(filter => !matching(filter)), { field_name: field, field_value: value, mode: 'include' }]
      }, { headers: jsonHeaders });
    } catch (error) {
      const name = policy.monitoredAction1GroupMap?.[groupId] || groupId;
      throw new Error(`Could not add the provisioning exclusion to endpoint group "${name}": ${error.response?.data?.user_message || error.response?.data?.error?.message || error.message}`);
    }
  }
}

async function createAction1AutomationAction(context, request = {}) {
  const organizationId = String(request.payload?.organizationId || '').trim();
  if (!organizationId) throw new Error('Action1 organization is required.');

  const typeId = String(request.payload?.automationType || '').trim();
  const payload = buildAutomationPayload({
    name: request.payload?.name,
    typeId,
    endpointGroupIds: request.payload?.endpointGroupIds
  });
  const credentials = await context.action1.getCredentials();
  if (!credentials.apiKey || !credentials.apiSecret) throw new Error('Action1 API credentials are required.');

  const token = await getAction1Token(context, credentials);
  let response;
  try {
    response = await context.http.post(
      `${action1BaseUrl(credentials)}/automations/schedules/${encodeURIComponent(organizationId)}`,
      payload,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    throw new Error(error.response?.data?.user_message || error.response?.data?.developer_message || error.message);
  }
  const automation = response.data || {};
  const automationId = String(automation.id || '').trim();
  if (!automationId) throw new Error('Action1 created the automation but did not return its ID.');

  return {
    ok: true,
    message: `${payload.name} was created in Action1.`,
    automationId,
    editUrl: buildAutomationEditUrl(action1BaseUrl(credentials), organizationId, automationId, typeId)
  };
}

async function listProvisioningAutomationsAction(context, request = {}) {
  const organizationId = String(request.payload?.organizationId || '').trim();
  const selectedGroupIds = (Array.isArray(request.payload?.endpointGroupIds) ? request.payload.endpointGroupIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
  if (!organizationId) throw new Error('Action1 organization is required.');
  if (!selectedGroupIds.length) return { ok: true, automations: [] };

  const credentials = await context.action1.getCredentials();
  credentials.organizationId = organizationId;
  const schedules = await listAction1AutomationSchedules(credentials);
  const automations = schedules
    .filter(schedule => !isConfigurationPolicyAutomation(schedule.name))
    .filter(schedule => schedule.endpointGroupIds.some(id => selectedGroupIds.includes(id)))
    .map(schedule => automationListItem(schedule, action1BaseUrl(credentials), organizationId))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, automations };
}

async function getProvisioningAutomationForMutation(context, request = {}) {
  const organizationId = String(request.payload?.organizationId || '').trim();
  const automationId = String(request.payload?.automationId || '').trim();
  const selectedGroupIds = (Array.isArray(request.payload?.endpointGroupIds) ? request.payload.endpointGroupIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
  if (!organizationId || !automationId || !selectedGroupIds.length) {
    throw new Error('Automation, organization, and provisioning group are required.');
  }

  const credentials = await context.action1.getCredentials();
  const token = await getAction1Token(context, credentials);
  const url = `${action1BaseUrl(credentials)}/automations/schedules/${encodeURIComponent(organizationId)}/${encodeURIComponent(automationId)}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const response = await context.http.get(url, { headers });
    const schedule = normalizeAction1AutomationSchedule(response.data || {});
    if (schedule.id !== automationId || isConfigurationPolicyAutomation(schedule.name) ||
        !schedule.endpointGroupIds.some(id => selectedGroupIds.includes(id)) ||
        !automationListItem(schedule, action1BaseUrl(credentials), organizationId)) {
      throw new Error('Automation is not linked to the selected provisioning groups.');
    }
    return { url, headers, schedule, rawSchedule: response.data };
  } catch (error) {
    throw new Error(error.response?.data?.user_message || error.response?.data?.developer_message || error.message);
  }
}

async function deleteProvisioningAutomationAction(context, request = {}) {
  const { url, headers } = await getProvisioningAutomationForMutation(context, request);
  try {
    await context.http.delete(url, { headers });
  } catch (error) {
    throw new Error(error.response?.data?.user_message || error.response?.data?.developer_message || error.message);
  }

  const automationId = String(request.payload.automationId).trim();
  return { ok: true, automationId };
}

async function patchHourlySchedule(context, url, headers, rawSchedule, enabledAt) {
  try {
    await context.http.patch(url, {
      name: rawSchedule.name,
      endpoints: rawSchedule.endpoints,
      actions: rawSchedule.actions,
      settings: hourlyScheduleSettings(true, enabledAt),
      settings_timezone: 'UTC',
      retry_minutes: String(rawSchedule.retry_minutes || '60')
    }, { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (error) {
    throw new Error(error.response?.data?.user_message || error.response?.data?.developer_message || error.message);
  }
}

async function enableHourlyProvisioningAutomationAction(context, request = {}) {
  const enabledAt = new Date();
  const { url, headers, schedule, rawSchedule } = await getProvisioningAutomationForMutation(context, request);
  if (schedule.enabled) return { ok: true, automationId: schedule.id, enabled: true };
  if (!hasSavedActionConfiguration(rawSchedule)) {
    throw new Error('Finish configuring and saving at least one action in Action1 before enabling this automation.');
  }
  await patchHourlySchedule(context, url, headers, rawSchedule, enabledAt);

  return { ok: true, automationId: schedule.id, enabled: true };
}

function endpointMatches(endpoint, endpointId, endpointName) {
  const normalizedId = String(endpointId || '').trim();
  const normalizedName = String(endpointName || '').trim().toLowerCase();
  return (
    (normalizedId && String(endpoint?.action1EndpointId || '').trim() === normalizedId) ||
    (normalizedName && String(endpoint?.deviceName || '').trim().toLowerCase() === normalizedName)
  );
}

async function markProvisioningCompleteAction(context, request) {
  const endpointId = String(request.payload?.endpointId || '').trim();
  const endpointName = String(request.payload?.endpointName || '').trim();
  if (!endpointId) throw new Error('Action1 endpoint ID is required.');

  const credentials = await context.action1.getCredentials();
  let selectedOrganizationId = String(request.payload?.organizationId || '').trim();
  if (!selectedOrganizationId) {
    try {
      const rawData = await context.settings.get('IntuneVersionData');
      const data = rawData ? JSON.parse(rawData) : {};
      selectedOrganizationId = String(data.selectedAction1OrgId || '').trim();
    } catch {}
  }
  if (!selectedOrganizationId) {
    selectedOrganizationId = String(await context.settings.get('IntuneAction1OrgId') || credentials.organizationId || '').trim();
  }
  if (!credentials.apiKey || !credentials.apiSecret || !selectedOrganizationId) {
    throw new Error('Action1 credentials and organization are required.');
  }
  credentials.organizationId = selectedOrganizationId;

  const token = await getAction1Token(context, credentials);
  await context.http.patch(
    `${action1BaseUrl(credentials)}/endpoints/managed/${encodeURIComponent(selectedOrganizationId)}/${encodeURIComponent(endpointId)}`,
    { [`custom:${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE}`]: ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  const rawData = await context.settings.get('IntuneVersionData');
  let updated = false;
  if (rawData) {
    try {
      const data = JSON.parse(rawData);
      const endpoints = data.endpointRegistration?.endpoints;
      if (Array.isArray(endpoints)) {
        for (const endpoint of endpoints) {
          if (!endpointMatches(endpoint, endpointId, endpointName)) continue;
          endpoint.provisioningCompletedByAttribute = true;
          endpoint.provisioningManualOverride = true;
          endpoint.provisioningStatus = 'Completed';
          endpoint.provisioningDetail = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} set to ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE} by manual override.`;
          endpoint.provisioningAttributeStatus = 'completed';
          endpoint.provisioningAttributeMessage = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} set to ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE} by manual override.`;
          updated = true;
        }
      }
      if (updated) await context.settings.set('IntuneVersionData', JSON.stringify(data));
    } catch {
      updated = false;
    }
  }

  return {
    ok: true,
    message: endpointName
      ? `${endpointName} was marked as provisioning complete.`
      : 'Endpoint was marked as provisioning complete.',
    endpointId,
    endpointName,
    dashboardUpdated: updated
  };
}

module.exports = {
  actions: {
    'validate-configuration': validateConfiguration,
    'list-action1-organizations': listAction1OrganizationsAction,
    'list-action1-endpoint-groups': listAction1EndpointGroupsAction,
    'create-action1-endpoint-group': createAction1EndpointGroupAction,
    'delete-action1-endpoint-group': deleteAction1EndpointGroupAction,
    'list-action1-endpoint-group-details': listAction1EndpointGroupDetailsAction,
    'list-device-groups': listDeviceGroupsAction,
    'validate-assignments': validateAssignmentsAction,
    'list-policies': listPoliciesAction,
    'get-policy': getPolicyAction,
    'save-policy': savePolicyAction,
    'delete-policy': deletePolicyAction,
    'create-action1-automation': createAction1AutomationAction,
    'list-provisioning-automations': listProvisioningAutomationsAction,
    'delete-provisioning-automation': deleteProvisioningAutomationAction,
    'enable-hourly-provisioning-automation': enableHourlyProvisioningAutomationAction,
    'mark-provisioning-complete': markProvisioningCompleteAction,
    sync: syncAction
  }
};
