const { validate } = require('./validate');
const { sync } = require('./sync');

module.exports = {
  validate,
  sync,
  actions: {
    'check-configuration': async (context, { settings }) => {
      const apiUrl = settings?.HelloApiUrl || await context.settings.get('HelloApiUrl');
      return {
        ok: Boolean(apiUrl),
        message: apiUrl ? 'Configuration has an API URL.' : 'Configuration is missing an API URL.'
      };
    }
  }
};
