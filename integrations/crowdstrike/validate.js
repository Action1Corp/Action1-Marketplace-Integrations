async function validateAction1(settings) {
  const apiKey = settings.Action1APIKey;
  const apiSecret = settings.Action1APISecret;

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

async function validateCrowdStrike(settings) {
  const clientId = settings.CrowdStrikeClientId;
  const clientSecret = settings.CrowdStrikeClientSecret;
  const baseUrl = (settings.CrowdStrikeBaseUrl || 'https://api.crowdstrike.com').replace(/\/$/, '');

  if (!clientId || !clientSecret) {
    return { ok: false, message: 'Missing CrowdStrike client ID or client secret' };
  }

  try {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    const response = await fetch(`${baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.error_description || data.error || `HTTP ${response.status}`);
    }

    return { ok: true, message: 'Connected - OAuth2 token acquired' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validate({ settings }) {
  return {
    crowdstrike: await validateCrowdStrike(settings),
    action1: await validateAction1(settings)
  };
}

module.exports = {
  validate
};
