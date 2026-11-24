export const INITIAL_PROVIDER_ID = 'connectwise-psa';
import ConnectWiseConnectionFields from './providers/ConnectWiseConnectionFields.jsx';

/**
 * Provider DestinationMappingFields receive the current bounded page as `options` and the
 * relationship's retained `selectedOption` separately. They own the provider's customer
 * terminology and control rendering, but must call `onSearch(query)` for directory search
 * and `onLoadMore()` for the next page; filtering only `options` is not full-directory search.
 * `hasMore`, `nextPageToken`, `searchSupported`, `paginationSupported`, `complete`,
 * `destinationLoading`, and `error` describe the current provider/query result state.
 */

const CONNECTWISE_SETTING_KEYS = Object.freeze([
  'TicketingProvider_connectwise_psa_ApiRegion',
  'TicketingProvider_connectwise_psa_CustomServer',
  'TicketingProvider_connectwise_psa_CompanyId',
  'TicketingProvider_connectwise_psa_PublicApiKey',
  'TicketingProvider_connectwise_psa_PrivateApiKey'
]);

const CONNECTWISE = Object.freeze({
  providerId: INITIAL_PROVIDER_ID,
  label: 'ConnectWise PSA',
  contractMajor: 1,
  available: true,
  configured: false,
  ConnectionFields: ConnectWiseConnectionFields,
  RoutingFields: null,
  DestinationMappingFields: null,
  settingKeys: CONNECTWISE_SETTING_KEYS
});

export const UI_PROVIDER_REGISTRY = Object.freeze({
  [INITIAL_PROVIDER_ID]: CONNECTWISE
});

export function listSelectableProviders(registry = UI_PROVIDER_REGISTRY) {
  return Object.values(registry).filter((provider) => isUiProviderAvailable(provider));
}

export function isUiProviderAvailable(provider) {
  return provider?.available === true && provider.contractMajor === 1;
}

export function resolveUiProvider(providerId, registry = UI_PROVIDER_REGISTRY) {
  return registry[providerId] || null;
}

