const UPDATE_CONSOLE_UPDATE_TYPES = 'Regular Updates,Critical - Non-Security,Definition Updates,Feature Updates,Security Updates,Service Packs,Tools,Update Rollups,Upgrades,Unknown';

function buildAction1EndpointUrl(apiBaseUrl, orgId, endpointId, endpointName) {
  const origin = getOrigin(apiBaseUrl);
  const org = asTrimmedString(orgId);
  const endpoint = asTrimmedString(endpointId);
  const filterValue = asTrimmedString(endpointName) || endpoint;
  if (!origin || !org || !filterValue) return '';
  return `${origin}/console/endpoints?limit=20&from=0&org=${encodeURIComponent(org)}&filter=${encodeURIComponent(filterValue)}`;
}

function buildAction1UpdatesConsoleUrl(apiBaseUrl, orgId, updateName) {
  const origin = getOrigin(apiBaseUrl);
  const org = asTrimmedString(orgId);
  const filterValue = asTrimmedString(updateName);
  if (!origin || !org || !filterValue) return '';

  const params = new URLSearchParams({
    limit: '200',
    from: '0',
    only_latest: 'yes',
    update_type: UPDATE_CONSOLE_UPDATE_TYPES,
    org,
    ent: 'no',
    filter: encodeURIComponent(filterValue)
  });
  return `${origin}/console/updates?${params.toString()}`;
}

function getOrigin(baseUrl) {
  try {
    const u = new URL(String(baseUrl || ''));
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

module.exports = {
  buildAction1EndpointUrl,
  buildAction1UpdatesConsoleUrl,
  getOrigin
};
