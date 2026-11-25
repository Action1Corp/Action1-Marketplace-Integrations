'use strict';

const { createConnectWiseApi, validateConnectWiseConnection } = require('./connectwiseApi');
const { CONNECTWISE_CLIENT_ID } = require('./connectwiseClientId');

const BOARD_KINDS = Object.freeze({
  'service-boards': { path: '/service/boards', conditions: 'inactiveFlag=false and projectFlag=false', active: (row) => row.inactiveFlag !== true && row.projectFlag !== true },
  'board-statuses': { path: (input) => `/service/boards/${encodeId(input.boardId)}/statuses` },
  'board-types': { path: (input) => `/service/boards/${encodeId(input.boardId)}/types`, conditions: 'inactiveFlag=false', active: (row) => row.inactiveFlag !== true },
  'board-subtypes': { path: (input) => `/service/boards/${encodeId(input.boardId)}/subtypes`, conditions: 'inactiveFlag=false', active: (row) => row.inactiveFlag !== true },
  'board-items': { path: (input) => `/service/boards/${encodeId(input.boardId)}/items`, conditions: 'inactiveFlag=false', active: (row) => row.inactiveFlag !== true },
  'type-subtype-item-associations': { path: (input) => `/service/boards/${encodeId(input.boardId)}/typeSubTypeItemAssociations` },
  priorities: { path: '/service/priorities', active: (row) => row.inactiveFlag !== true },
  sources: { path: '/service/sources', active: (row) => row.inactiveFlag !== true }
});

function setting(settings, name) {
  return settings?.[`TicketingProvider_connectwise_psa_${name}`] ?? settings?.[name] ?? '';
}
function encodeId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) throw safeError('CONNECTWISE_DISCOVERY_PARENT_REQUIRED', 'Select a valid parent option before loading dependent choices.');
  return encodeURIComponent(id);
}
function safeError(code, message, statusCode, ambiguous = false) { return Object.assign(new Error(message), { code, ...(statusCode ? { statusCode } : {}), ...(ambiguous ? { ambiguous: true } : {}) }); }
function toOption(row, metadata) {
  const id = row?.id;
  const label = String(row?.name ?? row?.label ?? '').trim();
  if ((typeof id !== 'number' && typeof id !== 'string') || !String(id).trim() || !label || label.length > 160) return null;
  return { id: String(id), label, ...(metadata ? { metadata } : {}) };
}
function parseNextPage(headers) {
  const link = headers?.get?.('link') || headers?.link || headers?.Link || '';
  const text = Array.isArray(link) ? link.join(',') : String(link);
  const next = text.split(/,(?=\s*<)/).find((part) => /rel\s*=\s*["']?next/i.test(part));
  if (!next) return { hasNext: false, pageId: null };
  const target = next.match(/<([^>]+)>/)?.[1];
  if (!target) return { hasNext: true, pageId: null };
  try {
    const url = new URL(target, 'https://connectwise.invalid');
    const pageId = url.searchParams.get('pageId');
    return { hasNext: true, pageId: pageId && pageId.length <= 700 && !/[\u0000-\u001f\u007f]/.test(pageId) ? pageId : null };
  } catch { return { hasNext: true, pageId: null }; }
}
function encodeCursor(query, pageId) {
  return `cw1.${Buffer.from(JSON.stringify({ q: query, p: pageId }), 'utf8').toString('base64url')}`;
}
function decodeCursor(token, query) {
  if (!token) return null;
  try {
    if (!String(token).startsWith('cw1.')) throw new Error();
    const value = JSON.parse(Buffer.from(String(token).slice(4), 'base64url').toString('utf8'));
    if (value.q !== query || typeof value.p !== 'string' || !value.p || value.p.length > 1024) throw new Error();
    return value.p;
  } catch { throw safeError('CONNECTWISE_DISCOVERY_CURSOR_INVALID', 'Refresh discovery and try again.'); }
}

function createConnectWiseAdapter({ clientId = CONNECTWISE_CLIENT_ID, api = createConnectWiseApi({ clientId }) } = {}) {
  const validateConfiguration = async ({ input = {}, connection = {}, transport } = {}) => {
    const settings = { ...connection, ...(input.settings || {}) };
    const connectionResult = validateConnectWiseConnection(settings);
    if (!connectionResult.ok) return connectionResult;
    if (input.mode === 'activation') return connectionResult;
    if (input.mode === 'test-connection') {
      const configuredRoute = ['ServiceBoardId', 'InitialStatusId', 'TicketTypeId'].some((field) => String(setting(settings, field) || '').trim());
      return configuredRoute ? validateRouting(api, transport, settings) : connectionResult;
    }
    if (input.mode === 'organization-eligibility') {
      const mapping = input.mapping || input.mappings?.[0];
      try {
        const eligibility = await companyEligibility(api, transport, settings, mapping?.destinationId);
        return eligibility.eligible
          ? { ok: true, errors: [] }
          : { ok: false, errors: [{ field: 'CompanyEligibility', message: eligibility.reason }] };
      } catch {
        return { ok: false, errors: [{ field: 'CompanyEligibility', message: 'Company eligibility could not be verified. Ticket processing was skipped.' }] };
      }
    }
    return validateRouting(api, transport, settings);
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

  const discover = async ({ input = {}, connection = {}, transport } = {}) => {
    const settings = { ...connection, ...(input.settings || {}) };
    const kind = String(input.kind || '');
    try {
      if (kind === 'company-statuses') {
        const response = await api.request({ transport, connection: settings, path: '/company/companies/statuses', query: { pageSize: 1000 } });
        if (!Array.isArray(response.data) || response.data.length > 500) throw safeError('CONNECTWISE_DISCOVERY_TOO_LARGE', 'The ConnectWise status list exceeds the supported size.');
        return { options: response.data.map((row) => toOption(row, {
          disallowSavingFlag: row.disallowSavingFlag === true,
          inactiveFlag: row.inactiveFlag === true
        })).filter(Boolean).slice(0, 500) };
      }
      if (kind === 'mapping-destinations') return await discoverCompanies(api, transport, settings, input);
      if (kind === 'company-eligibility') {
        const ids = Array.isArray(input.companyIds) ? input.companyIds.slice(0, 100) : [];
        const options = [];
        for (const id of ids) {
          const eligibility = await companyEligibility(api, transport, settings, id);
          if (eligibility.company) options.push({ id: String(id), label: eligibility.company.name || String(id), metadata: eligibility.metadata });
          else options.push({ id: String(id), label: String(id), metadata: eligibility.metadata });
        }
        return { options };
      }
      const definition = BOARD_KINDS[kind];
      if (!definition) throw safeError('CONNECTWISE_DISCOVERY_KIND_INVALID', 'This ConnectWise discovery request is not supported.');
      if (['board-statuses', 'board-types', 'board-subtypes', 'board-items', 'type-subtype-item-associations'].includes(kind)) encodeId(input.boardId);
      const path = typeof definition.path === 'function' ? definition.path(input) : definition.path;
      const query = { pageSize: 1000, ...(definition.conditions ? { conditions: definition.conditions } : {}) };
      const response = await api.request({ transport, connection: settings, path, query });
      if (!Array.isArray(response.data)) throw safeError('CONNECTWISE_DISCOVERY_RESPONSE_INVALID', 'ConnectWise returned an unexpected discovery response.');
      let rows = response.data;
      if (definition.active) rows = rows.filter(definition.active);
      const options = kind === 'type-subtype-item-associations'
        ? rows.map((row) => {
          const typeId = refId(row.type); const subtypeId = refId(row.subType); const itemId = refId(row.item);
          if (!typeId) return null;
          const label = [row.type?.name, row.subType?.name, row.item?.name].filter(Boolean).join(' / ') || `Association ${row.id}`;
          return { id: String(row.id), label: label.slice(0, 160), metadata: { typeId, ...(subtypeId ? { subtypeId } : {}), ...(itemId ? { itemId } : {}) } };
        }).filter(Boolean)
        : rows.map((row) => toOption(row, kind === 'board-statuses'
          ? { closedStatus: row.closedStatus === true, inactive: row.inactive === true, default: row.defaultFlag === true }
          : { active: true })).filter(Boolean);
      if (options.length > 500) throw safeError('CONNECTWISE_DISCOVERY_TOO_LARGE', 'This list is too large to load safely. Refine discovery and try again.');
      return { options };
    } catch (error) {
      throw safeError(error.code || 'CONNECTWISE_DISCOVERY_FAILED', error.message || 'ConnectWise discovery failed.');
    }
  };

  const prepareTicket = async ({ input = {}, connection = {} } = {}) => {
    const route = input.effectiveRoute || input.route || {};
    const summary = truncateCodePoints(String(input.content?.summary || '').trim(), 100);
    const description = String(input.content?.details || '');
    const signalType = String(input.candidate?.identity?.signalType || input.candidate?.signal?.type || '').toUpperCase();
    const markers = { VULNERABILITY: 'Action1:VULNERABILITY', UPDATE: 'Action1:UPDATE', OFFLINE: 'Action1:OFFLINE', REBOOT_REQUIRED: 'Action1:REBOOT_REQUIRED', AUTOMATION_FAILED: 'Action1:AUTOMATION_FAILED' };
    const references = {
      company: route.destinationId || route.haloClientId || route.companyId,
      board: setting(connection, 'ServiceBoardId'),
      status: setting(connection, 'InitialStatusId'),
      type: setting(connection, 'TicketTypeId')
    };
    for (const [field, value] of Object.entries(references)) {
      const normalized = String(value ?? '').trim();
      if (!/^[1-9]\d{0,15}$/.test(normalized) || !Number.isSafeInteger(Number(normalized))) throw safeError('CONNECTWISE_TICKET_CONFIGURATION_INVALID', `A valid ${field} reference is required before ticket creation.`);
    }
    if (!summary || !description) throw safeError('CONNECTWISE_TICKET_CONTENT_INVALID', 'The generated ticket content is missing.');
    if (!markers[signalType]) throw safeError('CONNECTWISE_SIGNAL_UNSUPPORTED', 'This Action1 signal cannot be sent to ConnectWise.');
    const payload = {
      summary, initialDescription: description,
      company: { id: Number(references.company) }, board: { id: Number(references.board) }, status: { id: Number(references.status) }, type: { id: Number(references.type) },
      externalXRef: markers[signalType]
    };
    for (const [field, settingName] of [['subType', 'TicketSubtypeId'], ['item', 'TicketItemId'], ['priority', 'PriorityId'], ['source', 'SourceId']]) {
      const value = String(setting(connection, settingName) || '').trim();
      if (!value) continue;
      if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw safeError('CONNECTWISE_TICKET_CONFIGURATION_INVALID', `A valid ${field} reference is required before ticket creation.`);
      payload[field] = { id: Number(value) };
    }
    return { payload, comparisonValue: JSON.stringify({ summary, initialDescription: description }), comparisonVersion: 'connectwise-managed-content-v1' };
  };

  const createTicket = async ({ input = {}, connection = {}, transport } = {}) => {
    const payload = input.preparedTicket;
    validateCreatePayload(payload);
    const eligibility = await companyEligibility(api, transport, connection, payload.company.id);
    if (!eligibility.eligible) throw safeError('CONNECTWISE_COMPANY_INELIGIBLE', eligibility.reason || 'The mapped company cannot receive tickets.');
    try {
      const response = await api.request({ transport, connection, method: 'POST', path: '/service/tickets', body: payload });
      const ticketId = response.data && !Array.isArray(response.data) ? response.data.id : null;
      if (!Number.isSafeInteger(Number(ticketId)) || Number(ticketId) <= 0) throw safeError('CONNECTWISE_CREATE_RESULT_AMBIGUOUS', 'ConnectWise may have created the ticket, but did not return a usable ticket ID.', undefined, true);
      return { externalTicketRef: { id: String(ticketId), displayId: String(ticketId) } };
    } catch (error) {
      if (error.code === 'CONNECTWISE_CREATE_RESULT_AMBIGUOUS') throw error;
      if (!error.statusCode || error.statusCode >= 500) throw safeError(error.code || 'CONNECTWISE_CREATE_OUTCOME_AMBIGUOUS', 'ConnectWise ticket creation could not be confirmed. Do not retry automatically.', error.statusCode, true);
      throw error;
    }
  };

  const getTicket = async ({ input = {}, connection = {}, transport } = {}) => {
    const ticketId = String(input.externalTicketRef?.id || '').trim();
    if (!/^\d{1,20}$/.test(ticketId)) throw safeError('CONNECTWISE_TICKET_REFERENCE_INVALID', 'The stored ConnectWise ticket reference is invalid.');
    try {
      const response = await api.request({ transport, connection, path: `/service/tickets/${encodeURIComponent(ticketId)}`, query: { fields: 'id,recordType,company/id,status/id,status/name,closedFlag' } });
      const ticket = response.data;
      if (!ticket || Array.isArray(ticket) || String(ticket.id) !== ticketId || ticket.recordType !== 'ServiceTicket' || !ticket.company || !ticket.status || typeof ticket.closedFlag !== 'boolean') throw safeError('CONNECTWISE_TICKET_STATE_UNKNOWN', 'ConnectWise returned an incomplete or unsupported ticket record.');
      const expectedCompany = String(input.expectedRoute?.destinationId || input.expectedRoute?.haloClientId || '').trim();
      if (!expectedCompany || String(ticket.company.id) !== expectedCompany) throw safeError('CONNECTWISE_TICKET_OWNERSHIP_MISMATCH', 'The linked ticket does not belong to the currently mapped company.');
      const statusId = String(ticket.status.id ?? '').trim();
      if (!statusId) throw safeError('CONNECTWISE_TICKET_STATE_UNKNOWN', 'ConnectWise returned an incomplete ticket status.');
      const additionalClosed = String(setting(connection, 'AdditionalClosedStatusIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
      return { state: 'found', openState: ticket.closedFlag || additionalClosed.includes(statusId) ? 'closed' : 'open', externalTicketRef: { id: ticketId, displayId: ticketId }, observedStatusId: statusId, ...(ticket.status.name ? { observedStatusName: String(ticket.status.name).slice(0, 160) } : {}) };
    } catch (error) {
      if (error.statusCode !== 404) throw error;
      try { await api.request({ transport, connection, path: '/system/info' }); }
      catch { throw safeError('CONNECTWISE_TICKET_STATE_UNKNOWN', 'ConnectWise could not confirm whether the linked ticket is missing.'); }
      return { state: 'missing', confirmed: true };
    }
  };

  const notImplemented = async () => { throw safeError('CONNECTWISE_OPERATION_NOT_IMPLEMENTED', 'This ConnectWise operation is not implemented in this release.'); };
  return Object.freeze({ validateConfiguration, testConnection, discover, prepareTicket, getTicket, createTicket, updateTicket: notImplemented });
}

function truncateCodePoints(value, max) { return [...value].slice(0, max).join(''); }
function validateCreatePayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.summary || [...String(payload.summary)].length > 100 || typeof payload.initialDescription !== 'string' || !/^Action1:(VULNERABILITY|UPDATE|OFFLINE|REBOOT_REQUIRED|AUTOMATION_FAILED)$/.test(String(payload.externalXRef || ''))) throw safeError('CONNECTWISE_TICKET_PAYLOAD_INVALID', 'The prepared ConnectWise ticket is incomplete or invalid.');
  for (const field of ['company', 'board', 'status', 'type']) if (!Number.isSafeInteger(payload[field]?.id) || payload[field].id <= 0) throw safeError('CONNECTWISE_TICKET_PAYLOAD_INVALID', 'The prepared ConnectWise ticket is incomplete or invalid.');
  for (const field of ['subType', 'item', 'priority', 'source']) if (payload[field] !== undefined && (!Number.isSafeInteger(payload[field]?.id) || payload[field].id <= 0)) throw safeError('CONNECTWISE_TICKET_PAYLOAD_INVALID', 'The prepared ConnectWise ticket is incomplete or invalid.');
}

function refId(value) { return value && typeof value === 'object' ? String(value.id ?? '') : value === null || value === undefined ? '' : String(value); }
async function validateRouting(api, transport, connection) {
  const boardId = String(setting(connection, 'ServiceBoardId') || '').trim();
  const statusId = String(setting(connection, 'InitialStatusId') || '').trim();
  const typeId = String(setting(connection, 'TicketTypeId') || '').trim();
  const errors = [];
  if (!boardId) errors.push({ field: 'ServiceBoardId', message: 'Service Board is required.' });
  if (!statusId) errors.push({ field: 'InitialStatusId', message: 'Initial Ticket Status is required.' });
  if (!typeId) errors.push({ field: 'TicketTypeId', message: 'Ticket Type is required.' });
  if (errors.length) return { ok: false, errors };
  try {
    const [boards, statuses, types] = await Promise.all([
      api.request({ transport, connection, path: '/service/boards', query: { conditions: 'inactiveFlag=false and projectFlag=false', pageSize: 1000 } }),
      api.request({ transport, connection, path: `/service/boards/${encodeId(boardId)}/statuses`, query: { pageSize: 1000 } }),
      api.request({ transport, connection, path: `/service/boards/${encodeId(boardId)}/types`, query: { conditions: 'inactiveFlag=false', pageSize: 1000 } })
    ]);
    const board = (Array.isArray(boards.data) ? boards.data : []).find((row) => String(row.id) === boardId && row.inactiveFlag !== true && row.projectFlag !== true);
    const status = (Array.isArray(statuses.data) ? statuses.data : []).find((row) => String(row.id) === statusId && row.inactive !== true && row.closedStatus !== true);
    const type = (Array.isArray(types.data) ? types.data : []).find((row) => String(row.id) === typeId && row.inactiveFlag !== true);
    if (!board) errors.push({ field: 'ServiceBoardId', message: 'The selected Service Board is unavailable.' });
    if (!status) errors.push({ field: 'InitialStatusId', message: 'The selected Initial Status is unavailable or closed.' });
    if (!type) errors.push({ field: 'TicketTypeId', message: 'The selected Ticket Type is unavailable.' });
    const subtypeId = String(setting(connection, 'TicketSubtypeId') || '').trim();
    const itemId = String(setting(connection, 'TicketItemId') || '').trim();
    if ((subtypeId || itemId) && board) {
      const associationResponse = await api.request({ transport, connection, path: `/service/boards/${encodeId(boardId)}/typeSubTypeItemAssociations`, query: { pageSize: 1000 } });
      const associations = Array.isArray(associationResponse.data) ? associationResponse.data : [];
      const compatible = associations.some((row) => String(refId(row.type)) === typeId
        && (subtypeId ? String(refId(row.subType)) === subtypeId : !refId(row.subType))
        && (!itemId || String(refId(row.item)) === itemId));
      if (!compatible) errors.push({ field: itemId ? 'TicketItemId' : 'TicketSubtypeId', message: 'The selected Type, Subtype, and Item combination is unavailable.' });
    }
    for (const [field, endpoint] of [['PriorityId', '/service/priorities'], ['SourceId', '/service/sources']]) {
      const id = String(setting(connection, field) || '').trim();
      if (!id) continue;
      const response = await api.request({ transport, connection, path: endpoint, query: { conditions: 'inactiveFlag=false', pageSize: 1000 } });
      if (!(Array.isArray(response.data) ? response.data : []).some((row) => String(row.id) === id && row.inactiveFlag !== true)) errors.push({ field, message: 'The selected option is unavailable.' });
    }
    const additional = String(setting(connection, 'AdditionalClosedStatusIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
    if (additional.some((id) => !(Array.isArray(statuses.data) ? statuses.data : []).some((row) => String(row.id) === id && row.closedStatus !== true))) {
      errors.push({ field: 'AdditionalClosedStatusIds', message: 'One or more selected additional statuses are unavailable.' });
    }
    if (additional.includes(statusId)) errors.push({ field: 'AdditionalClosedStatusIds', message: 'Initial Ticket Status cannot also be selected as an additional completed status.' });
    return { ok: errors.length === 0, errors };
  } catch {
    return { ok: false, errors: [{ field: 'TicketConfiguration', message: 'ConnectWise routing choices could not be validated. Refresh discovery and try again.' }] };
  }
}
function companyStatusId(row) { return refId(row?.status); }
function eligibilityResult(company, status) {
  if (!company || company.deletedFlag === true || !status || typeof status.disallowSavingFlag !== 'boolean') {
    const reason = company?.deletedFlag === true ? 'This company is deleted and cannot receive tickets.' : 'Company eligibility could not be verified.';
    return { eligible: false, eligibilityKnown: company?.deletedFlag === true, eligibilityReason: reason };
  }
  if (status.disallowSavingFlag) return { eligible: false, eligibilityKnown: true, eligibilityReason: 'This company status does not allow tickets.' };
  return { eligible: true, eligibilityKnown: true, eligibilityReason: '' };
}
async function companyEligibility(api, transport, connection, id) {
  if (!/^\d{1,20}$/.test(String(id || ''))) return { eligible: false, reason: 'Company eligibility could not be verified.', metadata: { eligible: false, eligibilityKnown: false, eligibilityReason: 'Company eligibility could not be verified.' } };
  const [companies, statuses] = await Promise.all([
    api.request({ transport, connection, path: `/company/companies/${encodeURIComponent(String(id))}` }),
    api.request({ transport, connection, path: '/company/companies/statuses', query: { pageSize: 1000 } })
  ]);
  const company = companies.data && !Array.isArray(companies.data) ? companies.data : null;
  const status = (Array.isArray(statuses.data) ? statuses.data : []).find((row) => String(row.id) === companyStatusId(company));
  const result = eligibilityResult(company, status);
  return { ...result, reason: result.eligibilityReason, company, metadata: { ...result, ...(company?.identifier ? { identifier: String(company.identifier).slice(0, 160) } : {}) } };
}
async function discoverCompanies(api, transport, connection, input) {
  const query = String(input.query || '').trim().replace(/\s+/g, ' ');
  if (/[\u0000-\u001f\u007f'%]/.test(query)) throw safeError('CONNECTWISE_SEARCH_INVALID', 'This search contains characters that cannot be safely sent to ConnectWise.');
  const pageSize = Number.isInteger(input.pageSize) ? Math.min(input.pageSize, 500) : 50;
  const pageId = decodeCursor(input.continuationToken, query);
  const statusesResponse = await api.request({ transport, connection, path: '/company/companies/statuses', query: { pageSize: 1000 } });
  const statuses = Array.isArray(statusesResponse.data) ? statusesResponse.data : [];
  const conditions = [`deletedFlag=false`, ...(query ? [`name like '%${query}%'`] : [])].join(' and ');
  const response = await api.request({
    transport, connection, path: '/company/companies', headers: { 'pagination-type': 'forward-only' },
    query: { conditions, pageSize, ...(pageId ? { pageId } : {}) }
  });
  if (!Array.isArray(response.data)) throw safeError('CONNECTWISE_DISCOVERY_RESPONSE_INVALID', 'ConnectWise returned an unexpected company list.');
  const options = response.data.filter((company) => company.deletedFlag !== true).map((company) => {
    const status = statuses.find((item) => String(item.id) === companyStatusId(company));
    const eligibility = eligibilityResult(company, status);
    return toOption(company, { ...eligibility, ...(company.identifier ? { identifier: String(company.identifier).slice(0, 160) } : {}) });
  }).filter(Boolean);
  const nextPage = parseNextPage(response.headers);
  if (nextPage.hasNext && !nextPage.pageId) throw safeError('CONNECTWISE_PAGINATION_INVALID', 'ConnectWise returned an unsupported continuation link. Refresh discovery and try again.');
  const nextPageId = nextPage.pageId;
  const hasMore = Boolean(nextPageId);
  return {
    options,
    hasMore,
    nextPageToken: hasMore ? encodeCursor(query, nextPageId) : null,
    complete: !hasMore && options.every((option) => option.metadata.eligibilityKnown),
    searchSupported: true,
    paginationSupported: true
  };
}

module.exports = { createConnectWiseAdapter, eligibilityResult, discoverCompanies };
