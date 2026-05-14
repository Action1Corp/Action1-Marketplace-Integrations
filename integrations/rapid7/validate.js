const { validateAction1, validateRapid7 } = require('../_shared/validation');

async function validate({ settings }) {
  return {
    rapid7: await validateRapid7(settings),
    action1: await validateAction1(settings)
  };
}

module.exports = {
  validate
};
