const { createAction1DiscoveryClient, requiresETPSigning } = require('./action1DiscoveryClient');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

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
  if (!Array.isArray(payload?.actions)) throw new Error('Action1 Automation response must contain a Run PowerShell action id.');
  const runScriptActions = payload.actions.filter((action) => action?.template_id === 'run_script');
  if (runScriptActions.length !== 1) throw new Error('Action1 Automation response must contain exactly one Run PowerShell action id.');
  const actionId = String(runScriptActions[0]?.id || '').trim();
  if (!actionId) throw new Error('Action1 Automation response must contain a usable Run PowerShell action id.');
  return { id, self, name, actionId };
}

function normalizeApi4AutomationResponse(payload, submitted, self) {
  const id = required(payload?.id, 'Action1 automation id');
  const configuration = payload?.configuration;
  if (configuration?.type !== 'AutomationScheduleConfiguration') throw new Error('Action1 API 4.0 response must contain an AutomationScheduleConfiguration.');
  if (submitted.resourceId && id !== submitted.resourceId) throw new Error('Action1 API 4.0 response resource id does not match the requested schedule resource id.');
  const configurationId = required(configuration?.id, 'Action1 automation configuration id');
  if (configurationId !== submitted.configurationId) throw new Error('Action1 API 4.0 response configuration id does not match the submitted configuration id.');
  const name = required(configuration?.name || submitted.name, 'Action1 automation name');
  if (configuration?.organization_id && configuration.organization_id !== submitted.organizationId) throw new Error('Action1 API 4.0 response organization id does not match the policy organization id.');
  if (!Array.isArray(configuration?.actions)) throw new Error('Action1 API 4.0 Automation response must contain a Run PowerShell action id.');
  const actions = configuration.actions.filter((action) => action?.template_id === 'run_script');
  if (actions.length !== 1) throw new Error('Action1 API 4.0 Automation response must contain exactly one Run PowerShell action id.');
  const actionId = required(actions[0]?.id, 'Action1 automation action id');
  if (actionId !== submitted.actionId) throw new Error('Action1 API 4.0 response action id does not match the submitted action id.');
  return { id, self: String(payload.self || self || '').trim(), name, actionId, configurationId };
}

function normalizeApi4AutomationLookup(payload, automationId, organizationId) {
  const id = required(automationId, 'Action1 automation id');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || String(payload.id || '').trim() !== id) return null;
  const configuration = payload.configuration;
  if (configuration?.type !== 'AutomationScheduleConfiguration') return null;
  const configurationId = String(configuration.id || '').trim();
  const returnedOrganizationId = String(configuration.organization_id || '').trim();
  const actions = Array.isArray(configuration.actions) ? configuration.actions.filter((action) => action?.template_id === 'run_script') : [];
  const actionId = actions.length === 1 ? String(actions[0].id || '').trim() : '';
  if (!configurationId || !returnedOrganizationId || (organizationId && returnedOrganizationId !== organizationId) || !String(configuration.name || '').trim() || !actionId) return null;
  return {
    id,
    self: String(payload.self || '').trim() || null,
    name: String(configuration.name).trim(),
    organizationId: returnedOrganizationId,
    configurationId,
    actionId
  };
}

function buildApi4CreatePayload(definition, organizationId, uuidGenerator) {
  const payload = definition?.payload || {};
  const configurationId = required(uuidGenerator(), 'Action1 automation configuration id');
  if (!Array.isArray(payload.actions) || payload.actions.length !== 1 || payload.actions[0]?.template_id !== 'run_script') {
    throw new Error('Action1 API 4.0 create requires exactly one Run PowerShell action.');
  }
  const actions = payload.actions.map((action) => ({ ...action, id: required(uuidGenerator(), 'Action1 automation action id') }));
  return {
    payload: {
      configuration: {
        id: configurationId,
        type: 'AutomationScheduleConfiguration',
        organization_id: organizationId,
        name: payload.name,
        actions,
        settings: payload.settings,
        settings_timezone: payload.settings_timezone,
        retry_minutes: payload.retry_minutes
      },
      endpoints: payload.endpoints
    },
    submitted: { configurationId, actionId: required(actions[0]?.id, 'Action1 automation action id'), name: payload.name, organizationId }
  };
}

function buildApi4UpdatePayload(definition, organizationId, configurationId, actionId) {
  const payload = definition?.payload || {};
  const normalizedConfigurationId = required(configurationId, 'Action1 automation configuration id');
  const normalizedActionId = required(actionId, 'Action1 automation action id');
  const actions = payload.actions;
  if (!Array.isArray(actions) || actions.length !== 1 || actions[0]?.template_id !== 'run_script') {
    throw new Error('Action1 API 4.0 update requires exactly one Run PowerShell action.');
  }
  return {
    configuration: {
      id: normalizedConfigurationId,
      type: 'AutomationScheduleConfiguration',
      organization_id: organizationId,
      name: payload.name,
      actions: [{ ...actions[0], id: normalizedActionId }],
      settings: payload.settings,
      settings_timezone: payload.settings_timezone,
      retry_minutes: payload.retry_minutes
    },
    endpoints: payload.endpoints
  };
}

function buildApi4InstancePayload(instance, organizationId, uuidGenerator, now) {
  const payload = instance?.payload || {};
  const configurationId = required(uuidGenerator(), 'Action1 automation instance configuration id');
  const actions = Array.isArray(payload.actions) ? payload.actions.map((action) => ({ ...action, id: required(uuidGenerator(), 'Action1 automation instance action id') })) : [];
  if (actions.length !== 1 || actions[0]?.template_id !== 'run_script') throw new Error('Action1 API 4.0 instance requires exactly one Run PowerShell action.');
  return {
    payload: {
      configuration: {
        id: configurationId,
        type: 'AutomationScheduleConfiguration',
        organization_id: organizationId,
        name: payload.name,
        start_time: payload.start_time || formatApi4InstanceTime(now),
        actions,
        retry_minutes: payload.retry_minutes
      },
      endpoints: payload.endpoints
    },
    submitted: { configurationId, actionId: actions[0].id, organizationId }
  };
}

function formatApi4InstanceTime(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new Error('Action1 API 4.0 instance start time is invalid.');
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
}

function normalizeApi4InstanceResponse(payload, submitted) {
  const id = required(payload?.id, 'Action1 automation instance id');
  const actions = Array.isArray(payload?.actions) ? payload.actions.filter((action) => action?.template_id === 'run_script') : [];
  if (actions.length !== 1) throw new Error('Action1 API 4.0 instance response must contain exactly one Run PowerShell action id.');
  const actionId = required(actions[0].id, 'Action1 automation instance action id');
  if (actionId !== submitted.actionId) throw new Error('Action1 API 4.0 instance response action id does not match the submitted action id.');
  return { id, type: payload.type || 'AutomationInstance', status: payload.status || null, configurationId: submitted.configurationId, actionId };
}

function withActionId(definition, actionId) {
  const normalizedActionId = required(actionId, 'Action1 automation action id');
  const actions = definition?.payload?.actions;
  if (!Array.isArray(actions) || actions.length !== 1 || actions[0]?.template_id !== 'run_script') {
    throw new Error('Action1 Automation update requires exactly one Run PowerShell action.');
  }
  return {
    ...definition,
    payload: {
      ...definition.payload,
      actions: [{ ...actions[0], id: normalizedActionId }]
    }
  };
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
  const uuidGenerator = typeof options.uuidGenerator === 'function' ? options.uuidGenerator : () => crypto.randomUUID();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  return {
    async resolveConnection() {
      return discoveryClient.resolveConnection();
    },
    async createAutomation(organizationId, definition, signed) {
      const orgId = required(organizationId, 'Action1 organization id');
      const connection = await discoveryClient.resolveConnection();
      const etp = requiresETPSigning(connection);
      let api4;
      if (etp) {
        if (!signed?.configuration || !signed?.signature) throw new Error('Interactive signing is required before creating Action1 automations.');
        if (signed.origin !== new URL(connection.baseUrl).origin || !Number.isFinite(signed.expiresAt) || Date.now() > signed.expiresAt) {
          throw new Error('Signed operation changed or expired. Prepare the Policy operation again.');
        }
        const configuration = signed.configuration;
        const expected = buildApi4UpdatePayload(definition, orgId, configuration.id, configuration.actions?.[0]?.id).configuration;
        if (!isDeepStrictEqual(configuration, expected)) throw new Error('Signed configuration does not match the automation definition.');
        api4 = { payload: { configuration, endpoints: definition.payload.endpoints, signatures: [{
          object_reference: { type: configuration.type, id: configuration.id, organization_id: orgId },
          object_signature: signed.signature
        }] }, submitted: { configurationId: configuration.id, actionId: configuration.actions[0].id, name: configuration.name, organizationId: orgId } };
      } else {
        if (signed) throw new Error('Marketplace connection changed. Prepare the operation again.');
        api4 = connection.apiGeneration === 4 ? buildApi4CreatePayload(definition, orgId, uuidGenerator) : null;
      }
      const payload = await discoveryClient.requestAction1Mutation({
        operation: 'create-automation', method: 'POST', organizationId: orgId,
        path: `/automations/schedules/${encodeURIComponent(orgId)}`, body: api4 ? api4.payload : definition.payload
      });
      if (!api4) return normalizeAutomationResponse(payload);
      const self = `${connection.baseUrl}/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(payload?.id || '')}`;
      return normalizeApi4AutomationResponse(payload, api4.submitted, self);
    },
    async createAutomationInstance(organizationId, instance) {
      const orgId = required(organizationId, 'Action1 organization id');
      const connection = await discoveryClient.resolveConnection();
      if (requiresETPSigning(connection)) throw new Error('Interactive cleanup signing is required. ETP cleanup support is not available in this slice.');
      const api4 = connection.apiGeneration === 4 ? buildApi4InstancePayload(instance, orgId, uuidGenerator, now) : null;
      const payload = await discoveryClient.requestAction1Mutation({
        operation: 'create-automation-instance',
        method: 'POST',
        organizationId: orgId,
        path: `/automations/instances/${encodeURIComponent(orgId)}`,
        body: api4 ? api4.payload : instance.payload
      });
      if (api4) return normalizeApi4InstanceResponse(payload, api4.submitted);
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
        const connection = await discoveryClient.resolveConnection();
        const payload = await this.getAutomation(orgId, id);
        const automation = connection.apiGeneration === 4
          ? normalizeApi4AutomationLookup(payload, id, orgId)
          : normalizeAutomationLookup(payload, id);
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
    async updateAutomation(organizationId, automationId, definition, actionId, configurationId) {
      const orgId = required(organizationId, 'Action1 organization id');
      const id = required(automationId, 'Action1 automation id');
      const connection = await discoveryClient.resolveConnection();
      if (requiresETPSigning(connection)) throw new Error('Interactive signing is required. ETP Policy editing is not available in this slice.');
      if (connection.apiGeneration === 4) {
        const body = buildApi4UpdatePayload(definition, orgId, configurationId, actionId);
        const payload = await discoveryClient.requestAction1Mutation({
          operation: 'update-automation', method: 'PATCH', organizationId: orgId,
          path: `/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}`, body
        });
        const self = `${connection.baseUrl}/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(payload?.id || id)}`;
        return normalizeApi4AutomationResponse(payload, { resourceId: id, configurationId, actionId, organizationId: orgId, name: definition.name || definition.payload?.name }, self);
      }
      const updateDefinition = withActionId(definition, actionId);
      const payload = await discoveryClient.requestAction1Mutation({
        operation: 'update-automation',
        method: 'PATCH',
        organizationId: orgId,
        path: `/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}`,
        body: updateDefinition.payload
      });
      return { id, self: payload?.self || null, name: payload?.name || definition.name || definition.payload?.name };
    },
    async deleteAutomation(organizationId, automationId) {
      const orgId = required(organizationId, 'Action1 organization id');
      const id = required(automationId, 'Action1 automation id');
      const connection = await discoveryClient.resolveConnection();
      try {
        await discoveryClient.requestAction1Mutation({ operation: 'delete-automation', method: 'DELETE', organizationId: orgId, path: `/automations/schedules/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}` });
        return { status: 'deleted' };
      } catch (error) {
        if (connection.apiGeneration === 4) throw error;
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
  normalizeApi4AutomationLookup,
  normalizeApi4AutomationResponse,
  normalizeAutomationResponse,
  buildApi4CreatePayload,
  buildApi4UpdatePayload,
  buildApi4InstancePayload,
  normalizeApi4InstanceResponse,
  withActionId
};
