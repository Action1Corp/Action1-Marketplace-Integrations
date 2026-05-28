async function validateIntune(settings) {
  const tenantId = settings.IntuneTenantId;
  const clientId = settings.IntuneClientId;
  const clientSecret = settings.IntuneClientSecret;

  if (!tenantId || !clientId || !clientSecret) {
    return { ok: false, message: 'Missing Intune tenant ID, client ID, or client secret' };
  }

  try {
    const tokenBody = new URLSearchParams();
    tokenBody.append('client_id', clientId);
    tokenBody.append('scope', 'https://graph.microsoft.com/.default');
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
    intune: await validateIntune(settings)
  };
}

module.exports = {
  validate
};
