const { validate } = require('./validate');
const { discover } = require('./discoverSettingsOptions');
const {
  deleteHaloOrgClientMapping,
  discoverAction1MappingOptions,
  discoverHaloMappingOptions,
  previewAutoMatch,
  applyAutoMatch,
  listHaloOrgClientMappings,
  saveHaloOrgClientMapping
} = require('./mappingActions');
const { runTicketingSync } = require('./syncAction');
const { activateProvider } = require('./activateProvider');
const { saveProviderSettingsAction } = require('./saveProviderSettings');

async function validateConfiguration(context, request = {}) {
  const run = request.run || null;
  await run?.appendLog('Starting Action1 Ticketing configuration validation.');
  const result = await validate(context, request);
  await run?.appendLog(result.message);
  return result;
}

async function sync(context, request = {}) {
  return runTicketingSync(context, request);
}

module.exports = {
  actions: {
    'delete-ticketing-org-destination-mapping': deleteHaloOrgClientMapping,
    'discover-action1-mapping-options': discoverAction1MappingOptions,
    'discover-ticketing-mapping-options': discoverHaloMappingOptions,
    'preview-ticketing-mapping-auto-match': previewAutoMatch,
    'apply-ticketing-mapping-auto-match': applyAutoMatch,
    'discover-ticketing-settings-options': discover,
    'list-ticketing-org-destination-mappings': listHaloOrgClientMappings,
    'save-ticketing-org-destination-mapping': saveHaloOrgClientMapping,
    'validate-configuration': validateConfiguration,
    'save-provider-settings': saveProviderSettingsAction,
    'activate-provider': activateProvider,
    sync
  }
};
