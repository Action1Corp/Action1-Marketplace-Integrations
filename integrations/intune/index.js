const { listAction1AutomationSchedules, listAction1EndpointGroups, listAction1Organizations, listDeviceGroups, validate, validateAssignments } = require('./validate');
const { sync } = require('./sync');
const { createIntunePolicyStore } = require('./policyStore');

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
  return {
    ok: true,
    message: `Loaded ${groups.length} Action1 endpoint group${groups.length === 1 ? '' : 's'}.`,
    groups
  };
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
      .map(schedule => ({
        id: schedule.id,
        name: schedule.name,
        enabled: schedule.enabled
      }))
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
    const policy = await store.savePolicy(request.payload?.policy || request.payload || {});
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
    'list-action1-endpoint-group-details': listAction1EndpointGroupDetailsAction,
    'list-device-groups': listDeviceGroupsAction,
    'validate-assignments': validateAssignmentsAction,
    'list-policies': listPoliciesAction,
    'get-policy': getPolicyAction,
    'save-policy': savePolicyAction,
    'delete-policy': deletePolicyAction,
    'mark-provisioning-complete': markProvisioningCompleteAction,
    sync: syncAction
  }
};
