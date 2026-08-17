async function validateDefender(settings) {
  const tenantId = settings.DefenderTenantId;
  const clientId = settings.DefenderClientId;
  const clientSecret = settings.DefenderClientSecret;

  if (!tenantId || !clientId || !clientSecret) {
    return { ok: false, message: 'Missing Defender tenant ID, client ID, or client secret' };
  }

  try {
    const tokenBody = new URLSearchParams();
    tokenBody.append('client_id', clientId);
    tokenBody.append('scope', 'https://api.securitycenter.microsoft.com/.default');
    tokenBody.append('client_secret', clientSecret);
    tokenBody.append('grant_type', 'client_credentials');

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
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

async function validate({ settings }) {
  return {
    defender: await validateDefender(settings)
  };
}

module.exports = {
  validate
};
