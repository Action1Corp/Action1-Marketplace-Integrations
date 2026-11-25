const { saveProviderSettings } = require('./providerSettings');
const { INITIAL_PROVIDER_ID, createProviderDispatcher } = require('./providerRegistry');
const { PROVIDER_UI_DEFINITIONS, buildProviderSettingKey, getOwnedSettingKeys, readSettings } = require('./providerSettings');

async function saveProviderSettingsAction(context, request = {}) {
  if (request.providerId === INITIAL_PROVIDER_ID) {
    const keys = getOwnedSettingKeys(INITIAL_PROVIDER_ID, PROVIDER_UI_DEFINITIONS);
    const saved = await readSettings(context, keys);
    const draft = request.settings && typeof request.settings === 'object' ? request.settings : {};
    const effective = { ...saved, ...draft };
    const privateKey = buildProviderSettingKey(INITIAL_PROVIDER_ID, 'PrivateApiKey');
    if (draft[privateKey] === '***' || draft._secretModes?.[privateKey] === 'stored' || draft[privateKey] === undefined) effective[privateKey] = saved[privateKey] || '';
    const routeFields = ['ServiceBoardId', 'InitialStatusId', 'TicketTypeId', 'TicketSubtypeId', 'TicketItemId', 'PriorityId', 'SourceId', 'AdditionalClosedStatusIds'];
    const hasRouting = routeFields.some((field) => String(effective[buildProviderSettingKey(INITIAL_PROVIDER_ID, field)] || '').trim());
    if (hasRouting) {
      const validation = await createProviderDispatcher().invoke({
        providerId: INITIAL_PROVIDER_ID,
        operation: 'validateConfiguration',
        input: { mode: 'settings-save', settings: effective },
        connection: effective,
        transport: context?.http,
        logger: context?.logger
      });
      if (!validation.ok) return { ok: false, message: 'One or more ConnectWise Ticket Configuration selections could not be validated. Refresh discovery and review the required fields.' };
    }
  }
  return saveProviderSettings(context, request);
}

module.exports = { saveProviderSettingsAction };
