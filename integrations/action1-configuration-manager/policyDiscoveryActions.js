const { createAction1DiscoveryClient, sanitizeMessage } = require('./action1DiscoveryClient');
const { createDbPolicyStore } = require('./policyStore');
const { writeAction1RuntimeLog } = require('./runtimeLogging');

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
  writeAction1RuntimeLog(context, 'error', `Failed to load Action1 ${kind} | ${sanitizeMessage(diagnostics.statusCode ? `HTTP ${diagnostics.statusCode}` : error?.message || 'discovery failure')}`);
}

async function discoverPolicyOrganizationsAction(context) {
  try {
    const client = createAction1DiscoveryClient(context, { tokenCache: action1TokenCache });
    const organizations = await client.listOrganizations();
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
