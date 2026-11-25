const {
  discoverSettingsOptions,
  loadSettings,
  missingRequiredSettings,
  requestToken,
  sanitizeMessage,
  trimValue
} = require('./haloApi');

async function discover(context, request = {}) {
  const { INITIAL_PROVIDER_ID, resolveProvider, createProviderDispatcher } = require('./providerRegistry');
  const { PROVIDER_UI_DEFINITIONS, buildProviderSettingKey, readSettings } = require('./providerSettings');
  const providerId = String(request.providerId || INITIAL_PROVIDER_ID).trim();
  if (providerId === INITIAL_PROVIDER_ID) {
    try {
      const definition = PROVIDER_UI_DEFINITIONS[providerId];
      const draft = request.settings && typeof request.settings === 'object' ? request.settings : {};
      const saved = await readSettings(context, definition.fields.map((field) => buildProviderSettingKey(providerId, field.key)));
      const settings = {};
      for (const field of definition.fields) {
        const key = buildProviderSettingKey(providerId, field.key);
        const value = draft[key];
        settings[key] = field.type === 'secret' && (value === '***' || value === undefined || draft._secretModes?.[key] === 'stored') ? saved[key] : (value ?? saved[key] ?? '');
      }
      const boardId = String(settings[buildProviderSettingKey(providerId, 'ServiceBoardId')] || '').trim();
      const kindInputs = [
        { kind: 'service-boards' }, { kind: 'priorities' }, { kind: 'sources' }, { kind: 'company-statuses' },
        ...(boardId ? [
          { kind: 'board-statuses', boardId }, { kind: 'board-types', boardId }, { kind: 'board-subtypes', boardId },
          { kind: 'board-items', boardId }, { kind: 'type-subtype-item-associations', boardId }
        ] : [])
      ];
      const dispatcher = createProviderDispatcher();
      const optionsByKind = {};
      for (const input of kindInputs) {
        const result = await dispatcher.invoke({ providerId, operation: 'discover', input: { ...input, settings }, connection: settings, transport: context?.http, logger: context?.logger });
        if (result?.ok === false) throw new Error(result.message || 'ConnectWise discovery failed.');
        optionsByKind[input.kind] = result.options || [];
      }
      return { ok: true, message: 'Loaded ConnectWise settings options.', optionsByKind };
    } catch (error) {
      return { ok: false, message: error?.message || 'ConnectWise settings discovery failed.', optionsByKind: {} };
    }
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
