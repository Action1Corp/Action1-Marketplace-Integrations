const { saveProviderSettings } = require('./providerSettings');

async function saveProviderSettingsAction(context, request = {}) {
  return saveProviderSettings(context, request);
}

module.exports = { saveProviderSettingsAction };
