const { validate } = require('./validate');
const { discover } = require('./discoverSettingsOptions');
const {
  deleteHaloOrgClientMapping,
  discoverHaloMappingOptions,
  listHaloOrgClientMappings,
  saveHaloOrgClientMapping
} = require('./mappingActions');

async function validateConfiguration(context, request = {}) {
  const run = request.run || null;
  await run?.appendLog('Starting HaloPSA configuration validation.');
  const result = await validate(context, request);
  await run?.appendLog(result.message);
  return result;
}

async function sync(context, request = {}) {
  const run = request.run || null;
  await run?.appendLog('HaloPSA sync stub invoked. External API calls are not implemented yet.');
  await run?.setAssetsProcessed(0);

  return {
    ok: false,
    message: 'HaloPSA sync is not implemented yet.'
  };
}

module.exports = {
  actions: {
    'delete-halo-org-client-mapping': deleteHaloOrgClientMapping,
    'discover-halo-mapping-options': discoverHaloMappingOptions,
    'discover-halo-settings-options': discover,
    'list-halo-org-client-mappings': listHaloOrgClientMappings,
    'save-halo-org-client-mapping': saveHaloOrgClientMapping,
    'validate-configuration': validateConfiguration,
    sync
  }
};
