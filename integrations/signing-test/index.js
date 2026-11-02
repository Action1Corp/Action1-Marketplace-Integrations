const actions = {
  async connection(context) {
    const c = await context.action1.getCredentials();
    return { ok: true, etpEnabled: c.etpEnabled === true, organizationId: c.organizationId || '', baseUrl: c.baseUrl };
  },
  async 'prepare-signing'(context, request = {}) {
    const { intentId, objects } = request.payload || {};
    return context.action1.provisioner.prepareSigning({ idempotencyKey: intentId, objects });
  },
  async 'read-signing'(context, request = {}) {
    const job = await context.action1.provisioner.getSigning(request.payload?.signingId);
    return { ok: true, state: job.state, expiresAt: job.expiresAt, objects: job.objects, results: job.results || [] };
  }
};
module.exports = { actions };
