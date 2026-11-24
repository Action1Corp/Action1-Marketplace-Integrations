'use strict';

const { createConnectWiseApi, validateConnectWiseConnection } = require('./connectwiseApi');
const { CONNECTWISE_CLIENT_ID } = require('./connectwiseClientId');

function createConnectWiseAdapter({ clientId = CONNECTWISE_CLIENT_ID, api = createConnectWiseApi({ clientId }) } = {}) {
  const validateConfiguration = async ({ input = {} } = {}) => {
    const result = validateConnectWiseConnection(input.settings || {});
    if (!result.ok) return result;
    if (input.mode === 'activation' || input.mode === 'test-connection') return result;
    return { ok: false, errors: [{ field: 'TicketConfiguration', message: 'Ticket routing is not available until provider configuration is complete.' }] };
  };
  const testConnection = async ({ input = {}, transport } = {}) => {
    const settings = input.settings || {};
    const probes = [
      { path: '/system/info', expected: (data) => data && typeof data === 'object' && !Array.isArray(data) },
      { path: '/service/boards', query: { pageSize: 1 }, expected: Array.isArray },
      { path: '/company/companies', query: { pageSize: 1 }, expected: Array.isArray }
    ];
    try {
      for (const probe of probes) {
        const result = await api.request({ transport, connection: settings, path: probe.path, query: probe.query });
        if (!probe.expected(result.data)) return { ok: false, code: 'CONNECTWISE_INVALID_PROBE_RESPONSE', message: 'ConnectWise returned an unexpected response during the connection test.' };
      }
      return { ok: true, message: 'ConnectWise connection test succeeded.' };
    } catch (error) {
      return { ok: false, code: error.code || 'CONNECTWISE_NETWORK_ERROR', message: error.message || 'The ConnectWise connection test failed.' };
    }
  };
  const notImplemented = async () => {
    const error = new Error('This ConnectWise operation is not implemented in this release.');
    error.code = 'CONNECTWISE_OPERATION_NOT_IMPLEMENTED';
    throw error;
  };
  return Object.freeze({
    validateConfiguration, testConnection,
    discover: notImplemented, prepareTicket: notImplemented, getTicket: notImplemented,
    createTicket: notImplemented, updateTicket: notImplemented
  });
}

module.exports = { createConnectWiseAdapter };
