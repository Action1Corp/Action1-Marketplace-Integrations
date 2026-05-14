const { validateAction1, validateDefender } = require('../_shared/validation');

async function validate({ settings }) {
  return {
    defender: await validateDefender(settings),
    action1: await validateAction1(settings)
  };
}

module.exports = {
  validate
};
