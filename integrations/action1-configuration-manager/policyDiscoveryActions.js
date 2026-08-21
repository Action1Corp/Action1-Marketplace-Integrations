const { createAction1DiscoveryClient, sanitizeMessage } = require('./action1DiscoveryClient');
const { createDbPolicyStore } = require('./policyStore');
const { getDefaultAction1RuntimeLogger } = require('./runtimeLogging');

const action1TokenCache = new Map();

function getPayload(request) {
  return request && typeof request === 'object' ? request.payload || {} : {};
}

function createFailureMessage(kind) {
  if (kind === 'endpoint-groups') {
    return 'Unable to load Action1 endpoint groups.';
  }
  return 'Unable to load Action1 organizations.';
}

function logDiscoveryFailure(context, kind, error) {
  const diagnostics = error?.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {};
  context.logger?.warn?.({
    event: 'action1-policy-discovery-failure',
    stage: sanitizeMessage(diagnostics.phase || diagnostics.operation || 'discovery'),
    resource: kind,
    category: sanitizeMessage(error?.name || 'discovery-failure'),
    message: sanitizeMessage(error?.message || ''),
    requestPath: sanitizeMessage(diagnostics.requestPath || ''),
    requestMethod: sanitizeMessage(diagnostics.requestMethod || ''),
    statusCode: diagnostics.statusCode || null,
    responseExcerpt: sanitizeMessage(diagnostics.responseExcerpt || ''),
    errorCode: sanitizeMessage(diagnostics.errorCode || ''),
    errorMessage: sanitizeMessage(diagnostics.errorMessage || '')
  });
  const runtimeLogger = context?.action1ConfigurationManagerRuntimeLogger || getDefaultAction1RuntimeLogger();
  Promise.resolve(runtimeLogger.error(`Failed to load Action1 ${kind}: ${diagnostics.statusCode ? `HTTP ${diagnostics.statusCode}` : sanitizeMessage(error?.message || 'discovery failure')}`)).catch(() => {});
}

async function discoverPolicyOrganizationsAction(context) {
  context.logger?.info?.({
    event: 'action1-policy-discovery-action-start',
    action: 'discover-policy-organizations',
    organizationId: ''
  });
  try {
    const client = createAction1DiscoveryClient(context, { tokenCache: action1TokenCache });
    const organizations = await client.listOrganizations();
    context.logger?.info?.({
      event: 'action1-policy-discovery-action-complete',
      action: 'discover-policy-organizations',
      organizationsDiscovered: organizations.length
    });
    const runtimeLogger = context?.action1ConfigurationManagerRuntimeLogger || getDefaultAction1RuntimeLogger();
    Promise.resolve(runtimeLogger.info(`Loaded ${organizations.length} Action1 organizations`)).catch(() => {});
    return {
      ok: true,
      organizations
    };
  } catch (error) {
    logDiscoveryFailure(context, 'organizations', error);
    return {
      ok: false,
      message: createFailureMessage('organizations')
    };
  }
}

async function discoverPolicyEndpointGroupsAction(context, request = {}) {
  const payload = getPayload(request);
  const requestedOrganizationId = String(payload.organizationId || '').trim();
  context.logger?.info?.({
    event: 'action1-policy-discovery-action-start',
    action: 'discover-policy-endpoint-groups',
    organizationId: requestedOrganizationId
  });
  try {
    const organizationId = requestedOrganizationId;
    if (!organizationId) {
      throw new Error('Organization id is required.');
    }

    const client = createAction1DiscoveryClient(context, { tokenCache: action1TokenCache });
    const store = createDbPolicyStore(context);
    const [availability, endpointGroups] = await Promise.all([
      store.getOrganizationTargetAvailability(organizationId, { excludePolicyId: payload.policyId }),
      client.listEndpointGroups(organizationId)
    ]);

    const projectedEndpointGroups = availability.organizationBlockedByAllEndpoints
      ? []
      : endpointGroups.map((entry) => ({
        ...entry,
        reserved: Boolean(availability.reservedPolicyIdByEndpointGroupId[String(entry.endpointGroupId || '').trim()])
      }));
    context.logger?.info?.({
      event: 'action1-policy-discovery-action-complete',
      action: 'discover-policy-endpoint-groups',
      organizationId,
      endpointGroupsDiscovered: projectedEndpointGroups.length,
      allEndpointsAvailable: availability.allEndpointsAvailable
    });
    const runtimeLogger = context?.action1ConfigurationManagerRuntimeLogger || getDefaultAction1RuntimeLogger();
    Promise.resolve(runtimeLogger.info(`Loaded ${projectedEndpointGroups.length} endpoint groups for organization ${organizationId}`)).catch(() => {});
    return {
      ok: true,
      organizationId,
      allEndpointsAvailable: availability.allEndpointsAvailable,
      organizationBlockedByAllEndpoints: availability.organizationBlockedByAllEndpoints,
      hasAnyGroupReservations: availability.hasAnyGroupReservations,
      reservedEndpointGroupIds: availability.reservedEndpointGroupIds,
      endpointGroups: projectedEndpointGroups
    };
  } catch (error) {
    logDiscoveryFailure(context, 'endpoint-groups', error);
    return {
      ok: false,
      message: createFailureMessage('endpoint-groups')
    };
  }
}

module.exports = {
  discoverPolicyEndpointGroupsAction,
  discoverPolicyOrganizationsAction
};
