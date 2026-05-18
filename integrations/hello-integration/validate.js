async function validate({ settings }) {
  const apiUrl = settings?.HelloApiUrl || '';
  const apiToken = settings?.HelloApiToken || '';
  const ok = apiUrl.startsWith('http') && apiToken.length > 12;

  return {
    'hello-integration': {
      ok,
      message: ok ? 'Configuration values are present' : 'Missing API URL or token'
    }
  };
}

module.exports = {
  validate
};
