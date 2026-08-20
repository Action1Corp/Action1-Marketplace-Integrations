export function buildPoliciesPath(integration) {
  return `/apps/${encodeURIComponent(integration)}/policies`;
}

function buildSearchPath(integration, searchParams) {
  const query = new URLSearchParams(searchParams || '').toString();
  return `${buildPoliciesPath(integration)}${query ? `?${query}` : ''}`;
}

export function buildPolicyDetailsPath(integration, policyId, currentSearch = '') {
  const params = new URLSearchParams(currentSearch || '');
  params.set('policyId', String(policyId));
  return buildSearchPath(integration, params);
}

export function buildPoliciesListPath(integration, currentSearch = '') {
  const params = new URLSearchParams(currentSearch || '');
  params.delete('policyId');
  return buildSearchPath(integration, params);
}

export function getPolicyIdFromSearch(search) {
  const policyId = new URLSearchParams(search || '').get('policyId');
  return policyId ? policyId.trim() : null;
}
