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
const { createDbMappingStore } = require('./mappingStore');
const { INITIAL_PROVIDER_ID } = require('./providerRegistry');
const { createMarketplaceRunLogger } = require('./runtimeLogging');

function createShortFailureMessage(operation) {
  if (operation === 'action1_org_discovery') {
    return 'Action1 organization discovery failed.';
  }

  if (operation === 'halo_client_discovery') {
    return 'Action1 Ticketing client discovery failed. Check Action1 Ticketing client-read access and retry.';
  }

  return 'Unable to load mapping options.';
}

function buildFailureDiagnostics(operation, tokenAcquired, error, extras = {}) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object' ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object' ? diagnostic.request : {};
  const response = diagnostic.response && typeof diagnostic.response === 'object' ? diagnostic.response : {};

  return {
    actionId: operation === 'action1_org_discovery' ? 'discover-action1-mapping-options' : 'discover-ticketing-mapping-options',
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

async function logDiscoveryFailure(context, diagnostics) {
  const message = `Action1 Ticketing mapping discovery diagnostic ${JSON.stringify(diagnostics)}`;
  const logger = createMarketplaceRunLogger({ integrationId: 'action1-ticketing', logDir: context?.env?.HALO_PSA_LOG_DIR, env: context?.env || process.env });
  await logger.warn(message);
}

async function listHaloOrgClientMappings(context) {
  const mappings = await createDbMappingStore(context, INITIAL_PROVIDER_ID).list();
  return {
    ok: true,
    mappings
  };
}

async function saveHaloOrgClientMapping(context, request = {}) {
  try {
    const store = createDbMappingStore(context, INITIAL_PROVIDER_ID);
    const saved = await store.save(request.payload || {});
    return {
      ok: true,
      message: 'Mapping saved.',
      mapping: saved,
      mappings: await store.list()
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
    const store = createDbMappingStore(context, INITIAL_PROVIDER_ID);
    const result = await store.delete(request.payload?.id);
    return {
      ok: true,
      message: result.deleted ? 'Mapping deleted.' : 'Mapping was already absent.',
      deleted: result.deleted,
      mapping: result.mapping,
      mappings: await store.list()
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
    const action1Organizations = await discoverAction1Organizations(accessToken, credentials.baseUrl);
    return {
      ok: true,
      message: 'Loaded Action1 organization options.',
      action1Organizations
    };
  } catch (error) {
    const diagnostics = buildFailureDiagnostics('action1_org_discovery', tokenAcquired, error);
    await logDiscoveryFailure(context, diagnostics);
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
    resolvedResourceServer = settings.TicketingResourceServer || '';
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required Action1 Ticketing settings: ${missing.join(', ')}`,
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
    await logDiscoveryFailure(context, diagnostics);
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
