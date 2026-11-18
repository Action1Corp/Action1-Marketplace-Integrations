const UNAVAILABLE_CONNECTWISE = Object.freeze({
  providerId: 'connectwise-psa',
  label: 'ConnectWise PSA',
  contractMajor: 1,
  available: false,
  configured: false,
  ConnectionFields: null,
  RoutingFields: null,
  DestinationMappingFields: null,
  settingKeys: Object.freeze([])
});

export const UI_PROVIDER_REGISTRY = Object.freeze({
  'connectwise-psa': UNAVAILABLE_CONNECTWISE
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

