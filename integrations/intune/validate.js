const { validateIntune } = require('../_shared/validation');

async function validate({ settings }) {
  return {
    intune: await validateIntune(settings)
  };
}

module.exports = {
  validate
};
