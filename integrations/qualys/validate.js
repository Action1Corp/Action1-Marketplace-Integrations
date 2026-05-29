async function validateAction1(action1) {
  const { apiKey, apiSecret } = await action1.getCredentials();

  if (!apiKey || !apiSecret) {
    return { ok: false, message: 'Missing Action1 API key or secret' };
  }

  try {
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', apiKey);
    tokenParams.append('client_secret', apiSecret);
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

    return { ok: true, message: 'Connected - token acquired' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validateQualys(settings) {
  const username = settings.QualysUsername;
  const password = settings.QualysPassword;
  const baseUrl = (settings.QualysBaseUrl || 'https://qualysapi.qg3.apps.qualys.com').replace(/\/$/, '');

  if (!username || !password) {
    return { ok: false, message: 'Missing Qualys username or password' };
  }

  try {
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const response = await fetch(`${baseUrl}/api/2.0/fo/asset/host/?action=list&details=None`, {
      headers: { Authorization: `Basic ${auth}`, 'X-Requested-With': 'Node.js' }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (body.includes('<ERROR>')) {
      const match = body.match(/<TEXT>(.*?)<\/TEXT>/);
      throw new Error(match ? match[1] : 'Unknown Qualys API error');
    }

    return { ok: true, message: 'Connected - Qualys API reachable' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validate({ settings, action1 }) {
  return {
    qualys: await validateQualys(settings),
    action1: await validateAction1(action1)
  };
}

module.exports = {
  validate
};
