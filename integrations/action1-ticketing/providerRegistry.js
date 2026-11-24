const {
  PROVIDER_ADAPTER_CONTRACT_MAJOR,
  PROVIDER_ADAPTER_OPERATIONS,
  ProviderContractError,
  assertProviderId,
  normalizeProviderError,
  validateProviderAdapter,
  validateMappingDiscoveryInput,
  validateProviderOperationResult
} = require('./providerAdapterContract');

const INITIAL_PROVIDER_ID = 'connectwise-psa';

// ConnectWise remains unavailable until its provider Blueprint and implementation are approved.
// No fake or Halo adapter is present in this production registry.
const PROVIDER_REGISTRY = Object.freeze({
  [INITIAL_PROVIDER_ID]: Object.freeze({
    providerId: INITIAL_PROVIDER_ID,
    label: 'ConnectWise PSA',
    contractMajor: PROVIDER_ADAPTER_CONTRACT_MAJOR,
    adapter: null
  })
});

function resolveProvider(providerId, registry = PROVIDER_REGISTRY) {
  let key;
  try { key = assertProviderId(providerId); } catch (error) { return { ok: false, error: safeError(error) }; }
  const descriptor = registry && Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : null;
  if (!descriptor) {
    return { ok: false, error: { code: 'provider_unavailable', message: 'The requested ticketing system is not available in this version.' } };
  }
  if (descriptor.contractMajor !== PROVIDER_ADAPTER_CONTRACT_MAJOR) {
    return { ok: false, error: { code: 'provider_incompatible', message: `${safeLabel(descriptor.label)} is not available in this version.` } };
  }
  if (!descriptor.adapter) {
    return { ok: false, error: { code: 'provider_unavailable', message: `${safeLabel(descriptor.label)} is not available in this version.` } };
  }
  try {
    validateProviderAdapter(descriptor);
    return { ok: true, descriptor };
  } catch (error) {
    return { ok: false, error: { code: error.code || 'provider_incompatible', message: `${safeLabel(descriptor.label)} is not available in this version.` } };
  }
}

function createProviderDispatcher(registry = PROVIDER_REGISTRY) {
  return Object.freeze({
    async invoke(request = {}) {
      const { providerId, operation } = request;
      const resolved = resolveProvider(providerId, registry);
      if (!resolved.ok) throw createSafeError(resolved.error);
      if (!PROVIDER_ADAPTER_OPERATIONS.includes(operation)) {
        throw new ProviderContractError('provider_operation_unsupported', 'The ticketing system operation is not supported.');
      }
      const allowedKeys = new Set(['providerId', 'operation', 'input', 'connection', 'transport', 'logger']);
      if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
        throw new ProviderContractError('provider_input_invalid', 'The ticketing system request contains unsupported fields.');
      }
      const operationInput = {
        input: operation === 'discover' && request.input?.kind === 'mapping-destinations'
          ? validateMappingDiscoveryInput(request.input)
          : request.input,
        connection: request.connection,
        transport: request.transport,
        logger: request.logger
      };
      try {
        const result = await resolved.descriptor.adapter[operation](operationInput);
        return validateProviderOperationResult(operation, result, operationInput.input);
      } catch (error) {
        if (error instanceof ProviderContractError) throw error;
        throw createSafeError(normalizeProviderError(error, operation));
      }
    }
  });
}

function createSafeError(details) {
  return Object.assign(new Error(details.message), {
    code: details.code,
    ...(details.operation ? { operation: details.operation } : {}),
    ...(details.retryable !== undefined ? { retryable: details.retryable } : {}),
    ...(details.ambiguous !== undefined ? { ambiguous: details.ambiguous } : {})
  });
}

function safeError(error) {
  return { code: error?.code || 'provider_unavailable', message: 'The requested ticketing system is not available in this version.' };
}

function safeLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'This ticketing system';
}

module.exports = { INITIAL_PROVIDER_ID, PROVIDER_REGISTRY, createProviderDispatcher, resolveProvider };
