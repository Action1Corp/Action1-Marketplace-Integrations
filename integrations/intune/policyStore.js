const POLICY_SETTINGS_KEY = 'IntuneEnrollmentPolicies';
const LEGACY_POLICY_ID = 'ENR-000001';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trim(value) {
  return String(value || '').trim();
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  const text = trim(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(item => trim(item)).filter(Boolean);
  const parsed = parseJson(value, null);
  if (Array.isArray(parsed)) return normalizeStringArray(parsed);
  return trim(value).split(',').map(item => trim(item)).filter(Boolean);
}

const SUPPORTED_PLATFORMS = ['windows', 'macos', 'linux'];

function normalizePlatforms(value) {
  const selected = normalizeStringArray(value).map(item => item.toLowerCase());
  return SUPPORTED_PLATFORMS.filter(platform => selected.includes(platform));
}

function normalizeStringMap(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function nextPolicyId(policies) {
  const max = policies.reduce((current, policy) => {
    const match = trim(policy.policyId).match(/^ENR-(\d+)$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `ENR-${String(max + 1).padStart(6, '0')}`;
}

function normalizePolicy(input = {}, fallbackId = '') {
  const now = new Date().toISOString();
  const policyId = trim(input.policyId || fallbackId);
  const organizationId = trim(input.organizationId || input.IntuneAction1OrgId);
  const organizationName = trim(input.organizationName || input.IntuneOrgName);
  const legacyHasProvisioning = input.provisioningEnabled === true || input.configurationManagementEnabled === true || normalizeStringArray(input.monitoredAction1GroupIds ?? input.IntuneProvisioningAction1GroupIds).length > 0;
  const profileType = input.profileType === 'enrollmentOnly'
    ? 'enrollmentOnly'
    : input.profileType === 'enrollmentAndProvisioning' || legacyHasProvisioning
      ? 'enrollmentAndProvisioning'
      : 'enrollmentOnly';
  const assignmentMode = input.assignmentMode === 'selectedGroups' ? 'selectedGroups' : 'allDevices';
  const intuneDeviceGroupIds = normalizeStringArray(input.intuneDeviceGroupIds ?? input.IntuneDeviceGroupIds);
  const intuneDeviceGroupMap = normalizeStringMap(input.intuneDeviceGroupMap ?? input.IntuneDeviceGroupMap);
  const monitoredAction1GroupIds = profileType === 'enrollmentOnly' ? [] : normalizeStringArray(input.monitoredAction1GroupIds ?? input.IntuneProvisioningAction1GroupIds);
  const monitoredAction1GroupMap = profileType === 'enrollmentOnly' ? {} : normalizeStringMap(input.monitoredAction1GroupMap ?? input.IntuneProvisioningAction1GroupMap);
  const name = trim(input.name) || (organizationName ? `${organizationName} enrollment` : 'Enrollment profile');
  const platforms = input.platforms == null ? ['windows'] : normalizePlatforms(input.platforms);
  const installerIds = normalizeStringMap(input.agentIds);

  return {
    policyId,
    name,
    description: trim(input.description),
    enabled: input.enabled === false ? false : true,
    organizationId,
    organizationName,
    agentId: trim(input.agentId || input.IntuneAgentId),
    agentIds: { macos: trim(installerIds.macos), deb: trim(installerIds.deb), rpm: trim(installerIds.rpm) },
    agentDownloadOrgName: trim(input.agentDownloadOrgName || input.IntuneAgentDownloadOrgName || input.IntuneOrgName || organizationName),
    platforms,
    profileType,
    assignmentMode,
    intuneDeviceGroupIds,
    intuneDeviceGroupMap,
    provisioningEnabled: profileType !== 'enrollmentOnly',
    configurationManagementEnabled: profileType !== 'enrollmentOnly',
    monitoredAction1GroupIds,
    monitoredAction1GroupMap,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function validatePolicy(policy) {
  if (!policy.name) throw new Error('Profile name is required.');
  if (!policy.organizationId) throw new Error('Action1 organization is required.');
  if (!policy.organizationName) throw new Error('Action1 organization name is required.');
  if (policy.platforms.includes('windows') && !policy.agentId) throw new Error('Action1 Windows MSI installer is required.');
  if (policy.platforms.includes('macos') && !policy.agentIds.macos) throw new Error('Action1 macOS PKG installer is unavailable for this organization. Refresh organizations and try again.');
  if (policy.platforms.includes('linux') && (!policy.agentIds.deb || !policy.agentIds.rpm)) throw new Error('Action1 Linux DEB and RPM installers are required. Refresh organizations and try again.');
  if (policy.platforms.length === 0) throw new Error('Select at least one device platform.');
  if (policy.assignmentMode === 'selectedGroups' && policy.intuneDeviceGroupIds.length === 0) {
    throw new Error('Select at least one Intune device group, or choose all devices.');
  }
  if ((policy.provisioningEnabled || policy.configurationManagementEnabled) && policy.monitoredAction1GroupIds.length === 0) {
    throw new Error('Select at least one Action1 endpoint group to monitor, or choose Enrollment only.');
  }
}

function legacyPolicyFromSettings(settings = {}) {
  const organizationId = trim(settings.IntuneAction1OrgId);
  const organizationName = trim(settings.IntuneOrgName);
  const agentId = trim(settings.IntuneAgentId);
  if (!organizationId && !organizationName && !agentId) return null;
  return normalizePolicy({
    policyId: LEGACY_POLICY_ID,
    name: organizationName ? `${organizationName} enrollment` : 'Enrollment profile',
    organizationId,
    organizationName,
    agentId,
    agentDownloadOrgName: settings.IntuneAgentDownloadOrgName || organizationName,
    assignmentMode: settings.IntuneAssignmentTargetMode,
    intuneDeviceGroupIds: settings.IntuneDeviceGroupIds,
    intuneDeviceGroupMap: settings.IntuneDeviceGroupMap,
    provisioningEnabled: normalizeStringArray(settings.IntuneProvisioningAction1GroupIds).length > 0,
    monitoredAction1GroupIds: settings.IntuneProvisioningAction1GroupIds,
    monitoredAction1GroupMap: settings.IntuneProvisioningAction1GroupMap,
    createdAt: settings.IntunePolicyCreatedAt,
    updatedAt: settings.IntunePolicyUpdatedAt
  }, LEGACY_POLICY_ID);
}

async function readAllSettings(context) {
  const keys = [
    'IntuneAction1OrgId',
    'IntuneAgentId',
    'IntuneAgentDownloadOrgName',
    'IntuneOrgName',
    'IntuneAssignmentTargetMode',
    'IntuneDeviceGroupIds',
    'IntuneDeviceGroupMap',
    'IntuneProvisioningAction1GroupIds',
    'IntuneProvisioningAction1GroupMap'
  ];
  const entries = await Promise.all(keys.map(async key => [key, await context.settings.get(key)]));
  return Object.fromEntries(entries);
}

function createIntunePolicyStore(context) {
  async function listPolicies() {
    const raw = await context.settings.get(POLICY_SETTINGS_KEY);
    const parsed = parseJson(raw, []);
    if (trim(raw)) {
      const policies = Array.isArray(parsed) ? parsed.map(policy => normalizePolicy(policy)).filter(policy => policy.policyId) : [];
      return policies.sort((a, b) => a.name.localeCompare(b.name));
    }

    const legacy = legacyPolicyFromSettings(await readAllSettings(context));
    return legacy ? [legacy] : [];
  }

  async function writePolicies(policies) {
    await context.settings.set(POLICY_SETTINGS_KEY, JSON.stringify(policies.map(policy => normalizePolicy(policy))));
  }

  return {
    async listPolicies() {
      return listPolicies();
    },
    async getPolicy(policyId) {
      return (await listPolicies()).find(policy => policy.policyId === policyId) || null;
    },
    async savePolicy(input, beforeSave) {
      const policies = await listPolicies();
      const existingIndex = policies.findIndex(policy => policy.policyId === input.policyId);
      const now = new Date().toISOString();
      const policy = normalizePolicy({
        ...input,
        policyId: input.policyId || nextPolicyId(policies),
        createdAt: existingIndex >= 0 ? policies[existingIndex].createdAt : now,
        updatedAt: now
      });
      validatePolicy(policy);
      const endpointGroupIds = new Set(policy.monitoredAction1GroupIds.map(id => id.toLowerCase()));
      const overlappingEndpointPolicy = policies.find(existing =>
        existing.policyId !== policy.policyId &&
        existing.monitoredAction1GroupIds.some(id => endpointGroupIds.has(id.toLowerCase()))
      );
      if (overlappingEndpointPolicy) {
        throw new Error(`One or more selected Action1 endpoint groups are already assigned to profile "${overlappingEndpointPolicy.name}".`);
      }
      if (policy.assignmentMode === 'selectedGroups') {
        const selectedGroupIds = new Set(policy.intuneDeviceGroupIds.map(id => id.toLowerCase()));
        const overlappingPolicy = policies.find(existing =>
          existing.policyId !== policy.policyId &&
          existing.assignmentMode === 'selectedGroups' &&
          existing.intuneDeviceGroupIds.some(id => selectedGroupIds.has(id.toLowerCase()))
        );
        if (overlappingPolicy) {
          throw new Error(`One or more selected Intune device groups are already assigned to profile "${overlappingPolicy.name}".`);
        }
      }
      if (beforeSave) await beforeSave(policy);
      const nextPolicies = clone(policies);
      if (existingIndex >= 0) nextPolicies[existingIndex] = policy;
      else nextPolicies.push(policy);
      await writePolicies(nextPolicies);
      return policy;
    },
    async deletePolicy(policyId) {
      const policies = await listPolicies();
      const nextPolicies = policies.filter(policy => policy.policyId !== policyId);
      if (nextPolicies.length === policies.length) throw new Error('Profile was not found.');
      await writePolicies(nextPolicies);
      return { policyId };
    }
  };
}

module.exports = {
  POLICY_SETTINGS_KEY,
  LEGACY_POLICY_ID,
  createIntunePolicyStore,
  legacyPolicyFromSettings,
  normalizePolicy
};
