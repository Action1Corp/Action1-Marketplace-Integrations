const { validateAction1, validateCrowdStrike } = require('../_shared/validation');

async function validate({ settings }) {
  return {
    crowdstrike: await validateCrowdStrike(settings),
    action1: await validateAction1(settings)
  };
}

module.exports = {
  validate
};
