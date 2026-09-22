export function buildPoliciesPath(integration) {
  return `/apps/${encodeURIComponent(integration)}/policies`;
}

function buildSearchPath(integration, searchParams) {
  const query = new URLSearchParams(searchParams || '').toString();
  return `${buildPoliciesPath(integration)}${query ? `?${query}` : ''}`;
}

export function buildPolicyDetailsPath(integration, policyId, currentSearch = '') {
  const params = new URLSearchParams(currentSearch || '');
  params.delete('mode');
  params.delete('policyName');
  params.set('policyId', String(policyId));
  return buildSearchPath(integration, params);
}

export function buildPoliciesListPath(integration, currentSearch = '') {
  const params = new URLSearchParams(currentSearch || '');
  params.delete('policyId');
  params.delete('mode');
  params.delete('policyName');
  return buildSearchPath(integration, params);
}

export function getPolicyIdFromSearch(search) {
  const policyId = new URLSearchParams(search || '').get('policyId');
  return policyId?.trim() || null;
}

export function buildPolicyEditPath(integration, policyId, currentSearch = '') {
  return `${buildPolicyDetailsPath(integration, policyId, currentSearch)}&mode=edit`;
}

export function buildPolicyCreatePath(integration, currentSearch = '') {
  const params = new URLSearchParams(currentSearch || '');
  params.delete('policyId');
  params.delete('policyName');
  params.set('mode', 'create');
  return buildSearchPath(integration, params);
}

export function getPolicyRouteFromSearch(search) {
  const params = new URLSearchParams(search || '');
  const policyId = getPolicyIdFromSearch(search);
  if (params.get('mode') === 'create') {
    return { kind: 'create', policyId: null, policyName: params.get('policyName') || '' };
  }
  if (params.get('mode') === 'edit') {
    return { kind: policyId ? 'edit' : 'invalid', policyId };
  }
  return { kind: policyId ? 'details' : 'list', policyId };
}
