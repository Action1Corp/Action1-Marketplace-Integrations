function apiErrorMessage(error) {
  const data = error?.response?.data;
  return data?.message || data?.error || data?.error_description || error.message;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

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
    const data = await readJson(response);
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
    }

    return { ok: true, message: 'Connected - token acquired' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validateTenable(settings) {
  const accessKey = settings.TenableAccessKey;
  const secretKey = settings.TenableSecretKey;

  if (!accessKey || !secretKey) {
    return { ok: false, message: 'Missing Tenable access key or secret key' };
  }

  try {
    const response = await fetch('https://cloud.tenable.com/session', {
      headers: {
        'X-ApiKeys': `accessKey=${accessKey}; secretKey=${secretKey}`
      }
    });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    return { ok: true, message: `Connected - ${data.username || 'authenticated'}` };
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
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.error_description || data.error || `HTTP ${response.status}`);
    }

    return { ok: true, message: 'Connected - OAuth2 token acquired' };
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
    const data = await readJson(response);
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

async function validateMicrosoftClientCredentials(settings, { tenantKey, clientKey, secretKey, scope, label }) {
  const tenantId = settings[tenantKey];
  const clientId = settings[clientKey];
  const clientSecret = settings[secretKey];

  if (!tenantId || !clientId || !clientSecret) {
    return { ok: false, message: `Missing ${label} tenant ID, client ID, or client secret` };
  }

  try {
    const tokenBody = new URLSearchParams();
    tokenBody.append('client_id', clientId);
    tokenBody.append('scope', scope);
    tokenBody.append('client_secret', clientSecret);
    tokenBody.append('grant_type', 'client_credentials');

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    const data = await readJson(response);
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
    }

    return { ok: true, message: 'Connected - token acquired' };
  } catch (error) {
    return { ok: false, message: `Failed: ${error.message}` };
  }
}

async function validateDefender(settings) {
  return validateMicrosoftClientCredentials(settings, {
    tenantKey: 'DefenderTenantId',
    clientKey: 'DefenderClientId',
    secretKey: 'DefenderClientSecret',
    scope: 'https://api.securitycenter.microsoft.com/.default',
    label: 'Defender'
  });
}

async function validateIntune(settings) {
  return validateMicrosoftClientCredentials(settings, {
    tenantKey: 'IntuneTenantId',
    clientKey: 'IntuneClientId',
    secretKey: 'IntuneClientSecret',
    scope: 'https://graph.microsoft.com/.default',
    label: 'Intune'
  });
}

module.exports = {
  apiErrorMessage,
  validateAction1,
  validateTenable,
  validateCrowdStrike,
  validateRapid7,
  validateQualys,
  validateDefender,
  validateIntune
};
