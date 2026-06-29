const {
  loadSettings,
  missingRequiredSettings,
  requestMyself,
  sanitizeMessage
} = require('./jiraApi');

async function validate(context, request = {}) {
  try {
    const settings = await loadSettings(context, request);
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required Jira Cloud settings: ${missing.join(', ')}`
      };
    }

    const me = await requestMyself(settings);
    const who = me.displayName || me.emailAddress || 'Jira Cloud account';

    return {
      ok: true,
      message: `Connected - Jira Cloud API reachable for ${who}.`
    };
  } catch (error) {
    const sanitized = sanitizeMessage(error?.message);
    return {
      ok: false,
      message: `Failed: ${sanitized || 'Jira Cloud validation failed.'}`
    };
  }
}

module.exports = {
  validate
};
