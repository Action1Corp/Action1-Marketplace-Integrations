export function isCurrentProviderRequest(request, current) {
  return request?.providerId === current?.providerId &&
    request?.generation === current?.generation &&
    request?.settingsFingerprint === current?.settingsFingerprint;
}

export function hasUnsavedProviderSettings(currentSettings, savedSettings) {
  return JSON.stringify(currentSettings || {}) !== JSON.stringify(savedSettings || {});
}

export function restoreViewedProviderSettings(savedSettings, providerId, providerKeys) {
  const restored = { ...(savedSettings || {}) };
  for (const key of providerKeys || []) restored[key] = savedSettings?.[key] ?? '';
  return restored;
}
