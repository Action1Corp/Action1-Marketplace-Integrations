const { createAction1DiscoveryClient } = require('./action1DiscoveryClient');

const EXISTENCE_STATES = Object.freeze({ EXISTS: 'EXISTS', MISSING: 'MISSING', UNRESOLVED: 'UNRESOLVED' });

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

function classifyMissingAutomationGet(error, automationId) {
  const id = required(automationId, 'Action1 automation id');
  const diagnostics = error?.diagnostics || {};
  const message = String(diagnostics.errorMessage || '').trim();
  const contentType = String(diagnostics.responseContentType || '').toLowerCase().split(';')[0];
  const expectedMessages = [
    `Automation with id=${id} does not exists`,
    `Automation with id=${id} not found`
  ];
  if ((Number(error?.statusCode) === 400 || Number(error?.statusCode) === 404)
    && contentType === 'application/json'
    && expectedMessages.includes(message)) return true;
  return false;
}

function normalizeAutomationLookup(payload, automationId) {
  const id = required(automationId, 'Action1 automation id');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const returnedId = String(payload.id || '').trim();
  if (!returnedId || returnedId !== id) return null;
  return {
    id: returnedId,
    self: String(payload.self || '').trim() || null,
    name: String(payload.name || '').trim() || null
  };
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
    async createAutomationInstance(organizationId, instance) {
      const orgId = required(organizationId, 'Action1 organization id');
      const payload = await discoveryClient.requestAction1Mutation({
        operation: 'create-automation-instance',
        method: 'POST',
        organizationId: orgId,
        path: `/automations/instances/${encodeURIComponent(orgId)}`,
        body: instance.payload
      });
      const id = required(payload?.id, 'Action1 automation instance id');
      return { id, type: payload?.type || 'AutomationInstance', status: payload?.status || null };
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
    async observeAutomation(organizationId, automationId) {
      const orgId = required(organizationId, 'Action1 organization id');
      const id = required(automationId, 'Action1 automation id');
      try {
        const payload = await this.getAutomation(orgId, id);
        const automation = normalizeAutomationLookup(payload, id);
        return automation
          ? { state: EXISTENCE_STATES.EXISTS, automation }
          : { state: EXISTENCE_STATES.UNRESOLVED, reason: 'malformed-success' };
      } catch (error) {
        if (classifyMissingAutomationGet(error, id)) {
          return { state: EXISTENCE_STATES.MISSING };
        }
        return { state: EXISTENCE_STATES.UNRESOLVED, error };
      }
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

module.exports = {
  EXISTENCE_STATES,
  classifyAlreadyAbsentDelete,
  classifyMissingAutomationGet,
  createAction1AutomationClient,
  normalizeAutomationLookup,
  normalizeAutomationResponse
};
