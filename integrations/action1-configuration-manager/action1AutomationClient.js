const { createAction1DiscoveryClient } = require('./action1DiscoveryClient');

function required(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeAutomationResponse(payload) {
  const id = required(payload?.id, 'Action1 automation id');
  const self = required(payload?.self, 'Action1 automation self URL');
  const name = required(payload?.name, 'Action1 automation name');
  return { id, self, name };
}

function classifyAlreadyAbsentDelete(error, automationId) {
  const id = required(automationId, 'Action1 automation id');
  const diagnostics = error?.diagnostics || {};
  const message = String(diagnostics.errorMessage || '').trim();
  const expected = `Automation with id=${id} does not exists`;
  if (Number(error?.statusCode) === 400
    && String(diagnostics.responseContentType || '').toLowerCase().split(';')[0] === 'application/json'
    && message === expected) {
    return 'alreadyAbsent';
  }
  return 'failed';
}

function createAction1AutomationClient(context, options = {}) {
  const discoveryClient = createAction1DiscoveryClient(context, options);
  return {
    async createAutomation(organizationId, definition) {
      const orgId = required(organizationId, 'Action1 organization id');
      const payload = await discoveryClient.requestAction1Mutation({
        operation: 'create-automation', method: 'POST', organizationId: orgId,
        path: `/automations/schedules/${encodeURIComponent(orgId)}`, body: definition.payload
      });
      return normalizeAutomationResponse(payload);
    },
    async listAutomations(organizationId) {
      const orgId = required(organizationId, 'Action1 organization id');
      return discoveryClient.requestAction1Mutation({ operation: 'list-automations', method: 'GET', organizationId: orgId, path: `/automations/schedules/${encodeURIComponent(orgId)}` });
    },
    async getAutomation(organizationId, automationId) {
      const orgId = required(organizationId, 'Action1 organization id');
      const id = required(automationId, 'Action1 automation id');
      return discoveryClient.requestAction1Mutation({ operation: 'get-automation', method: 'GET', organizationId: orgId, path: `/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}` });
    },
    async updateAutomation(organizationId, automationId, definition) {
      const orgId = required(organizationId, 'Action1 organization id');
      const id = required(automationId, 'Action1 automation id');
      const payload = await discoveryClient.requestAction1Mutation({
        operation: 'update-automation',
        method: 'PATCH',
        organizationId: orgId,
        path: `/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}`,
        body: definition.payload
      });
      return { id, self: payload?.self || null, name: payload?.name || definition.name || definition.payload?.name };
    },
    async deleteAutomation(organizationId, automationId) {
      const orgId = required(organizationId, 'Action1 organization id');
      const id = required(automationId, 'Action1 automation id');
      try {
        await discoveryClient.requestAction1Mutation({ operation: 'delete-automation', method: 'DELETE', organizationId: orgId, path: `/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}` });
        return { status: 'deleted' };
      } catch (error) {
        if (classifyAlreadyAbsentDelete(error, id) === 'alreadyAbsent') {
          return { status: 'alreadyAbsent' };
        }
        throw error;
      }
    }
  };
}

module.exports = { classifyAlreadyAbsentDelete, createAction1AutomationClient, normalizeAutomationResponse };
