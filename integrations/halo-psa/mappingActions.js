const {
  discoverHaloClients,
  loadSettings,
  missingRequiredSettings,
  requestToken,
  sanitizeMessage
} = require('./haloApi');
const { deleteMapping, listMappings, saveMapping } = require('./mappingStore');

async function listHaloOrgClientMappings(context) {
  const mappings = await listMappings(context);
  return {
    ok: true,
    mappings
  };
}

async function saveHaloOrgClientMapping(context, request = {}) {
  try {
    const saved = await saveMapping(context, request.payload || {});
    return {
      ok: true,
      message: 'Mapping saved.',
      mapping: saved,
      mappings: await listMappings(context)
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed: ${sanitizeMessage(error?.message) || 'Unable to save mapping.'}`
    };
  }
}

async function deleteHaloOrgClientMapping(context, request = {}) {
  try {
    const result = await deleteMapping(context, request.payload?.id);
    return {
      ok: true,
      message: result.deleted ? 'Mapping deleted.' : 'Mapping was already absent.',
      deleted: result.deleted,
      mapping: result.mapping,
      mappings: await listMappings(context)
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed: ${sanitizeMessage(error?.message) || 'Unable to delete mapping.'}`
    };
  }
}

async function discoverHaloMappingOptions(context, request = {}) {
  try {
    const settings = await loadSettings(context, request);
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required HaloPSA settings: ${missing.join(', ')}`,
        haloClients: []
      };
    }

    const accessToken = await requestToken(settings);
    const haloClients = await discoverHaloClients(settings, accessToken);
    return {
      ok: true,
      message: 'Loaded Halo client options.',
      haloClients
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed: ${sanitizeMessage(error?.message) || 'Unable to load Halo client options.'}`,
      haloClients: []
    };
  }
}

module.exports = {
  deleteHaloOrgClientMapping,
  discoverHaloMappingOptions,
  listHaloOrgClientMappings,
  saveHaloOrgClientMapping
};
