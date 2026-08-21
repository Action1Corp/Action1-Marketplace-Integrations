export function buildPolicyScopeAvailability({
  allEndpointsAvailable = true,
  organizationBlockedByAllEndpoints = false,
  hasAnyGroupReservations = false,
  endpointGroups = []
} = {}) {
  const normalizedGroups = Array.isArray(endpointGroups) ? endpointGroups : [];
  const selectableEndpointGroups = organizationBlockedByAllEndpoints
    ? []
    : normalizedGroups.filter((entry) => entry?.reserved !== true);

  function targetError(scopeType, endpointGroupId) {
    if (organizationBlockedByAllEndpoints) {
      return 'This organization is already covered by an All endpoints Policy.';
    }
    if (scopeType === 'ALL_ENDPOINTS' && !allEndpointsAvailable) {
      return 'All endpoints is unavailable because this organization already has group-scoped Policies.';
    }
    if (scopeType === 'ENDPOINT_GROUP' && endpointGroupId) {
      const selected = normalizedGroups.find((entry) => entry.endpointGroupId === endpointGroupId);
      if (selected?.reserved === true) {
        return 'This endpoint group is already used by another Policy.';
      }
    }
    if (scopeType === 'ENDPOINT_GROUP' && !endpointGroupId && selectableEndpointGroups.length === 0 && hasAnyGroupReservations) {
      return 'No endpoint groups are available for a new Policy in this organization.';
    }
    return '';
  }

  return {
    allEndpointsAvailable: Boolean(allEndpointsAvailable) && !organizationBlockedByAllEndpoints,
    endpointGroupModeAvailable: !organizationBlockedByAllEndpoints,
    selectableEndpointGroups,
    targetError
  };
}
