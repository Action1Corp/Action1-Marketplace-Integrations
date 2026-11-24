const PROVIDER_ADAPTER_CONTRACT_MAJOR = 1;
const PROVIDER_ADAPTER_OPERATIONS = Object.freeze([
  'validateConfiguration',
  'testConnection',
  'discover',
  'prepareTicket',
  'getTicket',
  'createTicket',
  'updateTicket'
]);

const MAX_REFERENCE_ID_LENGTH = 512;
const MAX_REFERENCE_DISPLAY_ID_LENGTH = 160;
const MAX_REFERENCE_URL_LENGTH = 2048;
const MAX_REFERENCE_METADATA_BYTES = 4096;
const MAX_REFERENCE_METADATA_DEPTH = 4;
const MAX_REFERENCE_METADATA_KEYS = 32;
const MAX_DISCOVERY_QUERY_LENGTH = 200;
const MAX_DISCOVERY_PAGE_SIZE = 500;
const MAX_DISCOVERY_TOKEN_LENGTH = 1024;
const SENSITIVE_METADATA_KEY = /(?:secret|token|password|authorization|credential|header|raw.?payload|request.?body|response.?body)/i;

class ProviderContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderContractError';
    this.code = code;
    Object.assign(this, details);
  }
}

function assertProviderId(value) {
  const providerId = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId)) {
    throw new ProviderContractError('provider_unavailable', 'The requested ticketing system is not available in this version.');
  }
  return providerId;
}

function validateProviderAdapter(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new ProviderContractError('provider_incompatible', 'The ticketing system adapter is not compatible with this version.');
  }
  assertProviderId(descriptor.providerId);
  if (descriptor.contractMajor !== PROVIDER_ADAPTER_CONTRACT_MAJOR) {
    throw new ProviderContractError('provider_incompatible', 'The ticketing system is not available in this version.');
  }
  const adapter = descriptor.adapter;
  if (!adapter || typeof adapter !== 'object') {
    throw new ProviderContractError('provider_unavailable', `${safeProviderLabel(descriptor.label)} is not available in this version.`);
  }
  for (const operation of PROVIDER_ADAPTER_OPERATIONS) {
    if (typeof adapter[operation] !== 'function') {
      throw new ProviderContractError('provider_incompatible', 'The ticketing system is not available in this version.');
    }
  }
  return adapter;
}

function normalizeExternalTicketReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderContractError('invalid_external_ticket_reference', 'The provider returned an invalid ticket reference.');
  }
  if (typeof value.id !== 'string' || !value.id.trim() || value.id.trim().length > MAX_REFERENCE_ID_LENGTH) {
    throw new ProviderContractError('invalid_external_ticket_reference', 'The provider returned an invalid ticket reference.');
  }

  const displayId = optionalBoundedString(value.displayId, MAX_REFERENCE_DISPLAY_ID_LENGTH, 'display identifier');
  const url = optionalBoundedString(value.url, MAX_REFERENCE_URL_LENGTH, 'ticket URL');
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new ProviderContractError('invalid_external_ticket_reference', 'The provider returned an invalid ticket URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new ProviderContractError('invalid_external_ticket_reference', 'The provider returned an invalid ticket URL.');
    }
    if ([...parsed.searchParams.keys()].some((key) => SENSITIVE_METADATA_KEY.test(key))) {
      throw new ProviderContractError('invalid_external_ticket_reference', 'The provider returned an invalid ticket URL.');
    }
  }

  const metadata = normalizeMetadata(value.metadata);
  return {
    id: value.id.trim(),
    ...(displayId ? { displayId } : {}),
    ...(url ? { url } : {}),
    ...(metadata ? { metadata } : {})
  };
}

function optionalBoundedString(value, maxLength, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ProviderContractError('invalid_external_ticket_reference', `The provider returned an invalid ${label}.`);
  }
  return value.trim();
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderContractError('invalid_provider_metadata', 'The provider returned invalid ticket metadata.');
  }
  const normalized = sanitizeMetadataValue(value, 0);
  if (Object.keys(normalized).length > MAX_REFERENCE_METADATA_KEYS || Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_REFERENCE_METADATA_BYTES) {
    throw new ProviderContractError('invalid_provider_metadata', 'The provider returned ticket metadata that exceeds the supported limit.');
  }
  return normalized;
}

function sanitizeMetadataValue(value, depth) {
  if (depth > MAX_REFERENCE_METADATA_DEPTH) {
    throw new ProviderContractError('invalid_provider_metadata', 'The provider returned ticket metadata that exceeds the supported limit.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.length > MAX_REFERENCE_DISPLAY_ID_LENGTH) throw new ProviderContractError('invalid_provider_metadata', 'The provider returned ticket metadata that exceeds the supported limit.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_REFERENCE_METADATA_KEYS) throw new ProviderContractError('invalid_provider_metadata', 'The provider returned ticket metadata that exceeds the supported limit.');
    return value.map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ProviderContractError('invalid_provider_metadata', 'The provider returned invalid ticket metadata.');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_REFERENCE_METADATA_KEYS) throw new ProviderContractError('invalid_provider_metadata', 'The provider returned ticket metadata that exceeds the supported limit.');
  const result = {};
  for (const [key, item] of entries) {
    if (SENSITIVE_METADATA_KEY.test(key)) throw new ProviderContractError('invalid_provider_metadata', 'Sensitive provider metadata cannot be stored.');
    result[key] = sanitizeMetadataValue(item, depth + 1);
  }
  return result;
}

function normalizeProviderError(error, operation) {
  const safeOperation = PROVIDER_ADAPTER_OPERATIONS.includes(operation) ? operation : 'providerOperation';
  const inputCode = String(error?.code || '').trim();
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(inputCode) ? inputCode : 'PROVIDER_OPERATION_FAILED';
  return {
    code,
    message: 'The ticketing system could not complete this operation.',
    operation: safeOperation,
    retryable: error?.retryable === true,
    ambiguous: error?.ambiguous === true
  };
}

function normalizeDiscoveryQuery(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ProviderContractError('provider_input_invalid', 'The discovery search is invalid.');
  const query = value.trim().replace(/\s+/g, ' ');
  if (query.length > MAX_DISCOVERY_QUERY_LENGTH) throw new ProviderContractError('provider_input_invalid', 'The discovery search is too long.');
  return query;
}

function validateMappingDiscoveryInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.kind !== 'mapping-destinations') {
    throw new ProviderContractError('provider_input_invalid', 'The destination discovery request is invalid.');
  }
  const query = normalizeDiscoveryQuery(input.query);
  const pageSize = input.pageSize === undefined ? 50 : input.pageSize;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_DISCOVERY_PAGE_SIZE) {
    throw new ProviderContractError('provider_input_invalid', 'The destination discovery page size is invalid.');
  }
  const continuationToken = input.continuationToken ?? null;
  if (continuationToken !== null && (typeof continuationToken !== 'string' || continuationToken.length > MAX_DISCOVERY_TOKEN_LENGTH || !continuationToken.trim() || /[\u0000-\u001f\u007f]/.test(continuationToken))) {
    throw new ProviderContractError('provider_input_invalid', 'The destination discovery continuation token is invalid.');
  }
  if (input.settings !== undefined && (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))) {
    throw new ProviderContractError('provider_input_invalid', 'The destination discovery settings are invalid.');
  }
  return { ...input, kind: 'mapping-destinations', query, pageSize, continuationToken };
}

function validateProviderOperationResult(operation, result, input = {}) {
  if (!PROVIDER_ADAPTER_OPERATIONS.includes(operation) || !result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned an invalid response.', { operation });
  }
  if (operation === 'createTicket') {
    return { externalTicketRef: normalizeExternalTicketReference(result.externalTicketRef) };
  }
  if (operation === 'getTicket') {
    if (result.state === 'missing' && result.confirmed === true) return { state: 'missing', confirmed: true };
    if (result.state === 'found' && ['open', 'closed'].includes(result.openState)) {
      return {
        state: 'found',
        openState: result.openState,
        externalTicketRef: normalizeExternalTicketReference(result.externalTicketRef),
        ...(typeof result.comparisonValue === 'string' ? { comparisonValue: result.comparisonValue } : {}),
        ...(typeof result.comparisonVersion === 'string' ? { comparisonVersion: result.comparisonVersion } : {}),
        ...(result.observedStatusId ? { observedStatusId: optionalBoundedString(result.observedStatusId, MAX_REFERENCE_DISPLAY_ID_LENGTH, 'status identifier') } : {}),
        ...(result.observedStatusName ? { observedStatusName: optionalBoundedString(result.observedStatusName, MAX_REFERENCE_DISPLAY_ID_LENGTH, 'status name') } : {})
      };
    }
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned an unknown or unconfirmed ticket state.', { operation });
  }
  if (operation === 'updateTicket' && result.ok !== true) {
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system did not confirm the ticket update.', { operation });
  }
  if (operation === 'prepareTicket' && (!Object.prototype.hasOwnProperty.call(result, 'payload') || typeof result.comparisonValue !== 'string' || typeof result.comparisonVersion !== 'string' || !result.comparisonVersion.trim())) {
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned an invalid prepared ticket.', { operation });
  }
  if (operation === 'discover' && !Array.isArray(result.options)) {
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned invalid discovery options.', { operation });
  }
  if (operation === 'discover') {
    if (result.options.length > 500) throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned too many discovery options.', { operation });
    const seenOptionIds = new Set();
    const options = result.options.map((option) => {
        if (!option || typeof option.id !== 'string' || !option.id.trim() || option.id.length > MAX_REFERENCE_ID_LENGTH || typeof option.label !== 'string' || !option.label.trim() || option.label.length > MAX_REFERENCE_DISPLAY_ID_LENGTH) {
          throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned invalid discovery options.', { operation });
        }
        const id = option.id.trim();
        if (/[\u0000-\u001f\u007f]/.test(id) || seenOptionIds.has(id)) throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned invalid or duplicate discovery option identifiers.', { operation });
        seenOptionIds.add(id);
        return { id, label: option.label.trim(), ...(option.metadata === undefined ? {} : { metadata: normalizeMetadata(option.metadata) }) };
    });
    if (input?.kind !== 'mapping-destinations') return { options };
    const metadataKeys = ['hasMore', 'nextPageToken', 'complete', 'searchSupported', 'paginationSupported'];
    if (metadataKeys.every((key) => result[key] === undefined)) {
      return { options, hasMore: false, nextPageToken: null, complete: false, searchSupported: false, paginationSupported: false };
    }
    const token = result.nextPageToken;
    if (typeof result.hasMore !== 'boolean' || typeof result.complete !== 'boolean' || typeof result.searchSupported !== 'boolean' || typeof result.paginationSupported !== 'boolean' || !Object.prototype.hasOwnProperty.call(result, 'nextPageToken') ||
        (token !== null && token !== undefined && (typeof token !== 'string' || !token.trim() || token.length > MAX_DISCOVERY_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/.test(token))) ||
        result.hasMore !== Boolean(token) || (result.complete && result.hasMore) || (result.hasMore && !result.paginationSupported) ||
        (input.continuationToken && token === input.continuationToken)) {
      throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned invalid discovery page metadata.', { operation });
    }
    return { options, hasMore: result.hasMore, nextPageToken: token || null, complete: result.complete, searchSupported: result.searchSupported, paginationSupported: result.paginationSupported };
  }
  if (operation === 'testConnection' && typeof result.ok !== 'boolean') {
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned an invalid connection result.', { operation });
  }
  if (operation === 'testConnection') {
    const message = typeof result.message === 'string' ? result.message.trim() : '';
    if (message.length > 240 || /(?:bearer\s+|(?:access.?token|token|client.?secret|secret|password|authorization)\s*[:=])/i.test(message)) {
      throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned an unsafe connection message.', { operation });
    }
    return { ok: result.ok, ...(message ? { message } : {}), ...(typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.code) ? { code: result.code } : {}) };
  }
  if (operation === 'validateConfiguration' && (typeof result.ok !== 'boolean' || !Array.isArray(result.errors || []))) {
    throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned invalid configuration validation.', { operation });
  }
  if (operation === 'validateConfiguration') {
    const errors = result.errors || [];
    if (errors.length > 100) throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned too many configuration errors.', { operation });
    return {
      ok: result.ok,
      errors: errors.map((item) => {
        if (!item || typeof item !== 'object' || typeof item.field !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(item.field)) {
          throw new ProviderContractError('invalid_provider_result', 'The ticketing system returned invalid configuration errors.', { operation });
        }
        return { field: item.field, message: 'Check this provider field.' };
      })
    };
  }
  if (operation === 'updateTicket' && result.externalTicketRef !== undefined) {
    return { ok: true, externalTicketRef: normalizeExternalTicketReference(result.externalTicketRef) };
  }
  if (operation === 'updateTicket') return { ok: true };
  return result;
}

function safeProviderLabel(value) {
  const label = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return label || 'This ticketing system';
}

module.exports = {
  PROVIDER_ADAPTER_CONTRACT_MAJOR,
  PROVIDER_ADAPTER_OPERATIONS,
  MAX_DISCOVERY_PAGE_SIZE,
  MAX_DISCOVERY_QUERY_LENGTH,
  MAX_DISCOVERY_TOKEN_LENGTH,
  ProviderContractError,
  assertProviderId,
  normalizeExternalTicketReference,
  normalizeProviderError,
  validateProviderAdapter,
  normalizeDiscoveryQuery,
  validateMappingDiscoveryInput,
  validateProviderOperationResult
};
