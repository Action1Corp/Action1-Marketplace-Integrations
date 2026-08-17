async function validate({ settings }) {
  const accessKey = settings.TenableAccessKey;
  const secretKey = settings.TenableSecretKey;
  const results = { tenable: null };

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

  return results;
}

module.exports = {
  validate
};
