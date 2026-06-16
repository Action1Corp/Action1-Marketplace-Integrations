const {
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage: sanitizeAction1Message
} = require('./action1Api');
const {
  discoverHaloClients,
  loadSettings,
  missingRequiredSettings,
  requestToken,
  sanitizeMessage
} = require('./haloApi');
const { deleteMapping, listMappings, saveMapping } = require('./mappingStore');

function createShortFailureMessage(operation) {
  if (operation === 'action1_org_discovery') {
    return 'Action1 organization discovery failed.';
  }

  if (operation === 'halo_client_discovery') {
    return 'HaloPSA client discovery failed. Check HaloPSA client-read access and retry.';
  }

  return 'Unable to load mapping options.';
}

function buildFailureDiagnostics(operation, tokenAcquired, error, extras = {}) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object' ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object' ? diagnostic.request : {};
  const response = diagnostic.response && typeof diagnostic.response === 'object' ? diagnostic.response : {};

  return {
    actionId: operation === 'action1_org_discovery' ? 'discover-action1-mapping-options' : 'discover-halo-mapping-options',
    operation,
    tokenAcquired: Boolean(tokenAcquired),
    resolvedResourceServer: extras.resolvedResourceServer || diagnostic.resolvedResourceServer || '',
    request: {
      method: request.method || '',
      path: request.path || '',
      query: request.query || ''
    },
    response: {
      status: response.status ?? null,
      contentType: response.contentType || '',
      errorCode: response.errorCode || '',
      errorMessage: response.errorMessage || sanitizeMessage(error?.message) || sanitizeAction1Message(error?.message) || '',
      bodyExcerpt: response.bodyExcerpt || ''
    },
    timestamp: new Date().toISOString()
  };
}

function logDiscoveryFailure(context, diagnostics) {
  const message = `HaloPSA mapping discovery diagnostic ${JSON.stringify(diagnostics)}`;
  if (typeof context?.logger?.warn === 'function') {
    context.logger.warn(message);
    return;
  }

  console.warn(message);
}

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

async function discoverAction1MappingOptions(context) {
  let tokenAcquired = false;

  try {
    const credentials = await loadAction1Credentials(context);
    const accessToken = await requestAction1Token(credentials);
    tokenAcquired = true;
    const action1Organizations = await discoverAction1Organizations(accessToken);
    return {
      ok: true,
      message: 'Loaded Action1 organization options.',
      action1Organizations
    };
  } catch (error) {
    const diagnostics = buildFailureDiagnostics('action1_org_discovery', tokenAcquired, error);
    logDiscoveryFailure(context, diagnostics);
    return {
      ok: false,
      message: `Failed: ${createShortFailureMessage('action1_org_discovery')}`,
      diagnostics,
      action1Organizations: []
    };
  }
}

async function discoverHaloMappingOptions(context, request = {}) {
  let tokenAcquired = false;
  let resolvedResourceServer = '';

  try {
    const settings = await loadSettings(context, request);
    resolvedResourceServer = settings.HaloPsaResourceServer || '';
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required HaloPSA settings: ${missing.join(', ')}`,
        haloClients: []
      };
    }

    const accessToken = await requestToken(settings);
    tokenAcquired = true;
    const haloClients = await discoverHaloClients(settings, accessToken);
    return {
      ok: true,
      message: 'Loaded Halo client options.',
      haloClients
    };
  } catch (error) {
    const diagnostics = buildFailureDiagnostics('halo_client_discovery', tokenAcquired, error, {
      resolvedResourceServer
    });
    logDiscoveryFailure(context, diagnostics);
    return {
      ok: false,
      message: `Failed: ${createShortFailureMessage('halo_client_discovery')}`,
      diagnostics,
      haloClients: []
    };
  }
}

module.exports = {
  deleteHaloOrgClientMapping,
  discoverAction1MappingOptions,
  discoverHaloMappingOptions,
  listHaloOrgClientMappings,
  saveHaloOrgClientMapping
};
