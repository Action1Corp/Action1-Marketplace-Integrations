const {
  REQUIRED_SETTINGS,
  loadSettings,
  missingRequiredSettings,
  requestReadOnlyCheck,
  requestToken,
  sanitizeMessage
} = require('./haloApi');

async function validate(context, request = {}) {
  try {
    const settings = await loadSettings(context, request);
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required HaloPSA settings: ${missing.join(', ')}`
      };
    }

    const accessToken = await requestToken(settings);
    await requestReadOnlyCheck(settings, accessToken);

    return {
      ok: true,
      message: 'Connected - HaloPSA token acquired and API reachable.'
    };
  } catch (error) {
    const sanitized = sanitizeMessage(error?.message);
    return {
      ok: false,
      message: `Failed: ${sanitized || 'HaloPSA validation failed.'}`
    };
  }
}

module.exports = {
  validate
};
