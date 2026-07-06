const {
  discoverSettingsOptions,
  loadSettings,
  missingRequiredSettings,
  requestToken,
  sanitizeMessage,
  trimValue
} = require('./haloApi');

async function discover(context, request = {}) {
  try {
    const settings = await loadSettings(context, request);
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required HaloPSA settings: ${missing.join(', ')}`,
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
      trimValue(request?.settings?.HaloPsaTicketTypeId)
    );

    return {
      ok: true,
      message: 'Loaded HaloPSA settings options.',
      ...payload
    };
  } catch (error) {
    const sanitized = sanitizeMessage(error?.message);
    return {
      ok: false,
      message: `Failed: ${sanitized || 'Unable to load HaloPSA settings options.'}`,
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
