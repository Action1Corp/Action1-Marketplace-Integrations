const {
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage: sanitizeAction1Message
} = require('./action1Api');
const { createDbMappingStore } = require('./mappingStore');
const { createProviderDispatcher, PROVIDER_REGISTRY, resolveProvider } = require('./providerRegistry');
const {
  PROVIDER_UI_DEFINITIONS,
  buildProviderSettingKey,
  readSettings
} = require('./providerSettings');
const { createMarketplaceRunLogger } = require('./runtimeLogging');

function safeProviderFailure(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const sanitized = sanitizeAction1Message(message);
  return sanitized && sanitized.length <= 240 ? sanitized : 'The requested ticketing system is not available in this version.';
}

function resolveMappingProvider(request, registry, definitions) {
  const providerId = typeof request?.providerId === 'string' ? request.providerId.trim() : '';
  const resolved = resolveProvider(providerId, registry);
  if (!resolved.ok) return { ok: false, message: resolved.error.message };
  const definition = definitions[providerId];
  if (!definition || definition.available !== true) {
    return { ok: false, message: `${definition?.label || resolved.descriptor.label} is not available in this version.` };
  }
  return { ok: true, providerId, definition };
}

async function loadProviderDiscoveryValues(context, providerId, definition) {
  const keys = definition.fields.map((field) => buildProviderSettingKey(providerId, field.key));
  const saved = await readSettings(context, keys);
  const connection = {};
  const settings = {};
  for (const field of definition.fields) {
    const key = buildProviderSettingKey(providerId, field.key);
    const value = saved[key] ?? '';
    if (field.type === 'secret') connection[field.key] = value;
    else settings[field.key] = value;
  }
  return { connection, settings };
}

function createMappingActionHandlers(dependencies = {}) {
  const registry = dependencies.registry || PROVIDER_REGISTRY;
  const definitions = dependencies.definitions || PROVIDER_UI_DEFINITIONS;
  const dispatcher = dependencies.dispatcher || createProviderDispatcher(registry);

  function withProvider(request) {
    return resolveMappingProvider(request, registry, definitions);
  }

  async function listMappings(context, request = {}) {
    const selected = withProvider(request);
    if (!selected.ok) return { ok: false, message: selected.message, mappings: [] };
    try {
      return { ok: true, mappings: await createDbMappingStore(context, selected.providerId).list() };
    } catch {
      return { ok: false, message: 'Unable to load mappings for this ticketing system.', mappings: [] };
    }
  }

  async function saveMapping(context, request = {}) {
    const selected = withProvider(request);
    if (!selected.ok) return { ok: false, message: selected.message };
    try {
      const store = createDbMappingStore(context, selected.providerId);
      const saved = await store.save(request.payload || {});
      return { ok: true, message: 'Mapping saved.', mapping: saved, mappings: await store.list() };
    } catch (error) {
      return { ok: false, message: `Failed: ${safeProviderFailure(error)}` };
    }
  }

  async function deleteMapping(context, request = {}) {
    const selected = withProvider(request);
    if (!selected.ok) return { ok: false, message: selected.message, deleted: false };
    try {
      const store = createDbMappingStore(context, selected.providerId);
      const result = await store.delete(request.payload?.id);
      return {
        ok: true,
        message: result.deleted ? 'Mapping deleted.' : 'Mapping was already absent.',
        deleted: result.deleted,
        mapping: result.mapping,
        mappings: await store.list()
      };
    } catch (error) {
      return { ok: false, message: `Failed: ${safeProviderFailure(error)}`, deleted: false };
    }
  }

  async function discoverAction1MappingOptions(context) {
    let tokenAcquired = false;
    try {
      const credentials = await loadAction1Credentials(context);
      const accessToken = await requestAction1Token(credentials);
      tokenAcquired = true;
      const action1Organizations = await discoverAction1Organizations(accessToken, credentials.baseUrl);
      return { ok: true, message: 'Loaded Action1 organization options.', action1Organizations };
    } catch (error) {
      await logDiscoveryFailure(context, 'action1_org_discovery', error, tokenAcquired);
      return {
        ok: false,
        message: 'Failed: Action1 organization discovery failed.',
        diagnostics: buildFailureDiagnostics('action1_org_discovery', tokenAcquired, error),
        action1Organizations: []
      };
    }
  }

  async function discoverDestinationOptions(context, request = {}) {
    const selected = withProvider(request);
    if (!selected.ok) return { ok: false, message: selected.message, destinationOptions: [] };
    try {
      const { connection, settings } = await loadProviderDiscoveryValues(context, selected.providerId, selected.definition);
      const result = await dispatcher.invoke({
        providerId: selected.providerId,
        operation: 'discover',
        input: { kind: 'mapping-destinations', settings },
        connection,
        transport: context?.http,
        logger: context?.logger
      });
      return {
        ok: true,
        message: 'Loaded destination options.',
        destinationOptions: result.options.map((option) => ({ id: option.id, name: option.label }))
      };
    } catch (error) {
      return { ok: false, message: safeProviderFailure(error), destinationOptions: [] };
    }
  }

  return Object.freeze({
    deleteHaloOrgClientMapping: deleteMapping,
    discoverAction1MappingOptions,
    discoverHaloMappingOptions: discoverDestinationOptions,
    listHaloOrgClientMappings: listMappings,
    saveHaloOrgClientMapping: saveMapping
  });
}

function buildFailureDiagnostics(operation, tokenAcquired, error) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object' ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object' ? diagnostic.request : {};
  const response = diagnostic.response && typeof diagnostic.response === 'object' ? diagnostic.response : {};
  return {
    actionId: 'discover-action1-mapping-options',
    operation,
    tokenAcquired: Boolean(tokenAcquired),
    request: { method: request.method || '', path: request.path || '', query: request.query || '' },
    response: {
      status: response.status ?? null,
      contentType: response.contentType || '',
      errorCode: response.errorCode || '',
      errorMessage: response.errorMessage || safeProviderFailure(error),
      bodyExcerpt: response.bodyExcerpt || ''
    },
    timestamp: new Date().toISOString()
  };
}

async function logDiscoveryFailure(context, operation, error, tokenAcquired = false) {
  const diagnostics = buildFailureDiagnostics(operation, tokenAcquired, error);
  const logger = createMarketplaceRunLogger({ integrationId: 'action1-ticketing', logDir: context?.env?.HALO_PSA_LOG_DIR, env: context?.env || process.env });
  await logger.warn(`Action1 Ticketing mapping discovery diagnostic ${JSON.stringify(diagnostics)}`);
}

const productionHandlers = createMappingActionHandlers();
module.exports = { ...productionHandlers, createMappingActionHandlers };
