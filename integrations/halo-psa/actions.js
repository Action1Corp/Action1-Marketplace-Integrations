const { validate } = require('./validate');
const { discover } = require('./discoverSettingsOptions');
const {
  deleteHaloOrgClientMapping,
  discoverAction1MappingOptions,
  discoverHaloMappingOptions,
  listHaloOrgClientMappings,
  saveHaloOrgClientMapping
} = require('./mappingActions');
const { runHaloPsaSync } = require('./syncAction');

async function validateConfiguration(context, request = {}) {
  const run = request.run || null;
  await run?.appendLog('Starting HaloPSA configuration validation.');
  const result = await validate(context, request);
  await run?.appendLog(result.message);
  return result;
}

async function sync(context, request = {}) {
  return runHaloPsaSync(context, request);
}

module.exports = {
  actions: {
    'delete-halo-org-client-mapping': deleteHaloOrgClientMapping,
    'discover-action1-mapping-options': discoverAction1MappingOptions,
    'discover-halo-mapping-options': discoverHaloMappingOptions,
    'discover-halo-settings-options': discover,
    'list-halo-org-client-mappings': listHaloOrgClientMappings,
    'save-halo-org-client-mapping': saveHaloOrgClientMapping,
    'validate-configuration': validateConfiguration,
    sync
  }
};
