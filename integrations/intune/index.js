const { listAction1EndpointGroups, listAction1Organizations, listDeviceGroups, validate, validateAssignments } = require('./validate');
const { sync } = require('./sync');

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

async function listDeviceGroupsAction(context, request) {
  const groups = await listDeviceGroups(request.settings || {});
  return {
    ok: true,
    message: `Loaded ${groups.length} Intune device group${groups.length === 1 ? '' : 's'}.`,
    groups
  };
}

async function validateAssignmentsAction(context, request) {
  const result = await validateAssignments(request.settings || {});
  return {
    ...result,
    details: result
  };
}

async function listAction1EndpointGroupsAction(context, request) {
  const credentials = await context.action1.getCredentials();
  const selectedOrganizationId = String(request.settings?.IntuneAction1OrgId || '').trim();
  if (selectedOrganizationId) credentials.organizationId = selectedOrganizationId;
  const groups = await listAction1EndpointGroups(credentials);
  return {
    ok: true,
    message: `Loaded ${groups.length} Action1 endpoint group${groups.length === 1 ? '' : 's'}.`,
    groups
  };
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
  const selectedOrganizationId = String(await context.settings.get('IntuneAction1OrgId') || credentials.organizationId || '').trim();
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
    'list-device-groups': listDeviceGroupsAction,
    'validate-assignments': validateAssignmentsAction,
    'mark-provisioning-complete': markProvisioningCompleteAction,
    sync: syncAction
  }
};
