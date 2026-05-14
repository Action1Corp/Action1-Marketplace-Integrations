const { validateAction1, validateQualys } = require('../_shared/validation');

async function validate({ settings }) {
  return {
    qualys: await validateQualys(settings),
    action1: await validateAction1(settings)
  };
}

module.exports = {
  validate
};
