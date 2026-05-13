module.exports = {
  async validate({ settings }) {
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

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
      }

      return { ok: true, message: `Connected - ${data.username || 'authenticated'}` };
    } catch (error) {
      return { ok: false, message: `Failed: ${error.message}` };
    }
  }
};
