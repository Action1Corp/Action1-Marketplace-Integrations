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

async function validateRapid7(settings) {
  const apiKey = settings.Rapid7ApiKey;
  const region = settings.Rapid7Region;

  if (!apiKey || !region) {
    return { ok: false, message: 'Missing Rapid7 API key or region' };
  }

  try {
    const response = await fetch(`https://${region}.api.insight.rapid7.com/vm/v4/integration/assets?size=1`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.error || data.message || `HTTP ${response.status}`);
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Rapid7 returned an unexpected validation response');
    }
    if (data.errors?.length || data.error || data.message?.toLowerCase?.().includes('error')) {
      throw new Error(data.errors?.[0]?.message || data.error || data.message || 'Rapid7 returned an error response');
    }
    if (!data.metadata && !Array.isArray(data.data)) {
      throw new Error('Rapid7 response did not include asset metadata');
    }
    if (!Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('No InsightVM assets were returned for this region. Choose the region where your Rapid7 InsightVM data resides.');
    }

    return { ok: true, message: 'Connected - API key validated' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validate({ settings }) {
  return {
    rapid7: await validateRapid7(settings),
    action1: await validateAction1(settings)
  };
}

module.exports = {
  validate
};
