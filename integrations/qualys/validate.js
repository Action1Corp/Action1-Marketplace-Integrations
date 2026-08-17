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

async function validate({ settings }) {
  return {
    qualys: await validateQualys(settings)
  };
}

module.exports = {
  validate
};
