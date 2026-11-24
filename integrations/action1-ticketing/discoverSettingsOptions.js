const {
  discoverSettingsOptions,
  loadSettings,
  missingRequiredSettings,
  requestToken,
  sanitizeMessage,
  trimValue
} = require('./haloApi');

async function discover(context, request = {}) {
  const { INITIAL_PROVIDER_ID, resolveProvider } = require('./providerRegistry');
  const providerId = String(request.providerId || INITIAL_PROVIDER_ID).trim();
  if (providerId === INITIAL_PROVIDER_ID) {
    return {
      ok: false,
      message: 'ConnectWise settings discovery is not implemented in this release.',
      teams: [], ticketTypes: [], statuses: [], categories: [], ticketTypeDetail: null
    };
  }
  const provider = resolveProvider(providerId);
  if (!provider.ok) {
    return { ok: false, message: provider.error.message, teams: [], ticketTypes: [], statuses: [], categories: [], ticketTypeDetail: null };
  }
  try {
    const settings = await loadSettings(context, request);
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required Action1 Ticketing settings: ${missing.join(', ')}`,
        teams: [],
        ticketTypes: [],
        statuses: [],
        categories: [],
        ticketTypeDetail: null
      };
    }

    const accessToken = await requestToken(settings);
    const payload = await discoverSettingsOptions(
      settings,
      accessToken,
      trimValue(request?.settings?.TicketingTicketTypeId)
    );

    return {
      ok: true,
      message: 'Loaded Action1 Ticketing settings options.',
      ...payload
    };
  } catch (error) {
    const sanitized = sanitizeMessage(error?.message);
    return {
      ok: false,
      message: `Failed: ${sanitized || 'Unable to load Action1 Ticketing settings options.'}`,
      teams: [],
      ticketTypes: [],
      statuses: [],
      categories: [],
      ticketTypeDetail: null
    };
  }
}

module.exports = {
  discover
};
