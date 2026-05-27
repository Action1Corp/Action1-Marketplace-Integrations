async function checkConfiguration(context, { settings }) {
  const apiUrl = settings?.HelloApiUrl || await context.settings.get('HelloApiUrl');
  const hasUrl = typeof apiUrl === 'string' && apiUrl.trim().length > 0;

  return {
    ok: hasUrl,
    message: hasUrl
      ? 'Custom action completed. The API URL is available to this integration.'
      : 'Custom action failed. Configure the API URL before running this action.'
  };
}

module.exports = {
  actions: {
    'check-configuration': checkConfiguration
  }
};
