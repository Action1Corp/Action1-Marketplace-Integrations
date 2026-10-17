const {
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage: sanitizeAction1Message
} = require('./action1Api');
const { deleteMapping, listMappings, saveMapping } = require('./mappingStore');

function buildFailureDiagnostics(operation, tokenAcquired, error) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object' ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object' ? diagnostic.request : {};
  const response = diagnostic.response && typeof diagnostic.response === 'object' ? diagnostic.response : {};

  return {
    actionId: 'discover-action1-mapping-options',
    operation,
    tokenAcquired: Boolean(tokenAcquired),
    request: {
      method: request.method || '',
      path: request.path || '',
      query: request.query || ''
    },
    response: {
      status: response.status ?? null,
      contentType: response.contentType || '',
      errorCode: response.errorCode || '',
      errorMessage: response.errorMessage || sanitizeAction1Message(error?.message) || '',
      bodyExcerpt: response.bodyExcerpt || ''
    },
    timestamp: new Date().toISOString()
  };
}

function logDiscoveryFailure(context, diagnostics) {
  const message = `Entra mapping discovery diagnostic ${JSON.stringify(diagnostics)}`;
  if (typeof context?.logger?.warn === 'function') {
    context.logger.warn(message);
    return;
  }

  console.warn(message);
}

async function listEntraOrgMappings(context) {
  const mappings = await listMappings(context);
  return {
    ok: true,
    mappings
  };
}

async function saveEntraOrgMapping(context, request = {}) {
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
      message: `Failed: ${sanitizeAction1Message(error?.message) || 'Unable to save mapping.'}`
    };
  }
}

async function deleteEntraOrgMapping(context, request = {}) {
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
      message: `Failed: ${sanitizeAction1Message(error?.message) || 'Unable to delete mapping.'}`
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
    logDiscoveryFailure(context, diagnostics);
    return {
      ok: false,
      message: 'Failed: Action1 organization discovery failed.',
      diagnostics,
      action1Organizations: []
    };
  }
}

module.exports = {
  deleteEntraOrgMapping,
  discoverAction1MappingOptions,
  listEntraOrgMappings,
  saveEntraOrgMapping
};
