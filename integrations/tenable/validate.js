async function validate({ settings, action1 }) {
  const accessKey = settings.TenableAccessKey;
  const secretKey = settings.TenableSecretKey;
  const { apiKey: action1ApiKey, apiSecret: action1ApiSecret } = await action1.getCredentials();
  const results = { tenable: null, action1: null };

  if (!accessKey || !secretKey) {
    results.tenable = { ok: false, message: 'Missing Tenable access key or secret key' };
  } else {
    try {
      const response = await fetch('https://cloud.tenable.com/session', {
        headers: {
          'X-ApiKeys': `accessKey=${accessKey}; secretKey=${secretKey}`
        }
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
      }

      results.tenable = { ok: true, message: `Connected - ${data.username || 'authenticated'}` };
    } catch (error) {
      results.tenable = { ok: false, message: `Failed: ${error.message}` };
    }
  }

  if (!action1ApiKey || !action1ApiSecret) {
    results.action1 = { ok: false, message: 'Missing Action1 API key or secret' };
  } else {
    try {
      const tokenParams = new URLSearchParams();
      tokenParams.append('client_id', action1ApiKey);
      tokenParams.append('client_secret', action1ApiSecret);
      tokenParams.append('grant_type', 'client_credentials');
      const response = await fetch('https://app.action1.com/api/3.0/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
      }
      results.action1 = { ok: true, message: 'Connected - token acquired' };
    } catch (error) {
      results.action1 = { ok: false, message: `Failed: ${error.message}` };
    }
  }

  return results;
}

module.exports = {
  validate
};
