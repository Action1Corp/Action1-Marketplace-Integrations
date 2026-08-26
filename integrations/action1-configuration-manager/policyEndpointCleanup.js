const { buildAutomationDisplayName } = require('./automationNaming');
const { buildRunPowerShellParams } = require('./action1RunScript');

const POLICY_STATE_ROOT = 'C:\\Windows\\Action1\\ConfigurationManager';
const CLEANUP_RETRY_MINUTES = 10080;
const SAFE_POLICY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_CONTROL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validatePolicyId(policyId) {
  const normalized = String(policyId || '').trim();
  if (!SAFE_POLICY_ID.test(normalized)) throw new Error('Policy id is invalid for endpoint cleanup.');
  return normalized;
}

function validateControlId(controlId) {
  const normalized = String(controlId || '').trim();
  if (!SAFE_CONTROL_ID.test(normalized)) throw new Error('Control id is invalid for endpoint cleanup.');
  return normalized;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPolicyEndpointCleanupScript(policyId) {
  const id = validatePolicyId(policyId);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$baseDirectory = ${quotePowerShell(POLICY_STATE_ROOT)}`,
    `$policyId = ${quotePowerShell(id)}`,
    '$policyDirectory = Join-Path $baseDirectory $policyId',
    'if (Test-Path -LiteralPath $policyDirectory -PathType Container) {',
    '    Remove-Item `',
    '        -LiteralPath $policyDirectory `',
    '        -Recurse `',
    '        -Force `',
    '        -ErrorAction Stop',
    '}'
  ].join('\n');
}

function buildPolicyEndpointCleanupInstance(policy) {
  const policyId = validatePolicyId(policy?.policyId);
  const organizationId = String(policy?.organizationId || '').trim();
  if (!organizationId) throw new Error('Action1 organization id is required for endpoint cleanup.');
  const endpoint = policy.scopeType === 'ALL_ENDPOINTS'
    ? { id: 'ALL', type: 'EndpointGroup' }
    : { id: String(policy?.endpointGroupId || '').trim(), type: 'EndpointGroup' };
  if (!endpoint.id) throw new Error('Policy endpoint group is required for endpoint cleanup.');
  const name = buildAutomationDisplayName({
    policyId,
    policyName: policy.baseName || policy.displayName || 'Policy',
    controlFamilyName: 'State Cleanup'
  });
  return {
    organizationId,
    name,
    payload: {
      name,
      endpoints: [endpoint],
      actions: [{
        name: 'Run PowerShell',
        template_id: 'run_script',
        params: buildRunPowerShellParams(buildPolicyEndpointCleanupScript(policyId))
      }],
      retry_minutes: String(CLEANUP_RETRY_MINUTES)
    }
  };
}

function buildDeselectedControlCleanupScript(policyId, controlIds) {
  const id = validatePolicyId(policyId);
  if (!Array.isArray(controlIds) || controlIds.length === 0) {
    throw new Error('At least one removed Control id is required for endpoint cleanup.');
  }

  const normalizedControlIds = [...new Set(controlIds.map(validateControlId))];
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$baseDirectory = ${quotePowerShell(POLICY_STATE_ROOT)}`,
    `$policyId = ${quotePowerShell(id)}`,
    '$policyDirectory = Join-Path $baseDirectory $policyId',
    'if (Test-Path -LiteralPath $policyDirectory -PathType Container) {',
    `    $removedControlIds = @(${normalizedControlIds.map(quotePowerShell).join(', ')})`,
    '    foreach ($controlId in $removedControlIds) {',
    "        $targetPath = Join-Path $policyDirectory ($controlId + '.json')",
    '        if (Test-Path -LiteralPath $targetPath -PathType Leaf) {',
    '            Remove-Item -LiteralPath $targetPath -Force -ErrorAction Stop',
    '        }',
    '    }',
    '}'
  ];
  return lines.join('\n');
}

function buildDeselectedControlCleanupInstance(policy, controlIds) {
  const policyId = validatePolicyId(policy?.policyId);
  const organizationId = String(policy?.organizationId || '').trim();
  if (!organizationId) throw new Error('Action1 organization id is required for endpoint cleanup.');
  const endpoint = policy.scopeType === 'ALL_ENDPOINTS'
    ? { id: 'ALL', type: 'EndpointGroup' }
    : { id: String(policy?.endpointGroupId || '').trim(), type: 'EndpointGroup' };
  if (!endpoint.id) throw new Error('Policy endpoint group is required for endpoint cleanup.');
  const name = buildAutomationDisplayName({
    policyId,
    policyName: policy.baseName || policy.displayName || 'Policy',
    controlFamilyName: 'Control State Cleanup'
  });
  return {
    organizationId,
    name,
    payload: {
      name,
      endpoints: [endpoint],
      actions: [{
        name: 'Run PowerShell',
        template_id: 'run_script',
        params: buildRunPowerShellParams(buildDeselectedControlCleanupScript(policyId, controlIds))
      }],
      retry_minutes: String(CLEANUP_RETRY_MINUTES)
    }
  };
}

module.exports = {
  CLEANUP_RETRY_MINUTES,
  POLICY_STATE_ROOT,
  buildPolicyEndpointCleanupInstance,
  buildPolicyEndpointCleanupScript,
  buildDeselectedControlCleanupInstance,
  buildDeselectedControlCleanupScript,
  validateControlId,
  validatePolicyId
};
