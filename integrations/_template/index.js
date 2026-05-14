module.exports = {
  // Optional Marketplace handler. Add only when manifest capabilities include "validate".
  // async validate(context) {
  //   return { ok: true, message: 'Connected' };
  // },

  // Optional Marketplace handler. Add only when manifest capabilities include "sync".
  // async sync(context) {
  //   context.logger.info('Sync started');
  // }
};

// Integrations can define any internal helper functions they need. The Marketplace
// only invokes handlers defined by the supported integration API.
