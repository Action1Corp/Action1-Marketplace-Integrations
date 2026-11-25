const assert = require('assert');
const { createConnectWiseAdapter } = require('../providers/connectwisePsaAdapter');

const connection = {
  ApiRegion: 'NA', CompanyId: 'tenant', PublicApiKey: 'public', PrivateApiKey: 'private',
  ServiceBoardId: '10', InitialStatusId: '20', TicketTypeId: '30'
};

async function run() {
  const calls = [];
  const rows = {
    '/service/boards': [{ id: 10, name: 'Service', inactiveFlag: false, projectFlag: false }],
    '/service/boards/10/statuses': [{ id: 20, name: 'New', inactive: false, closedStatus: false }],
    '/service/boards/10/types': [{ id: 30, name: 'Incident', inactiveFlag: false }],
    '/service/boards/10/subtypes': [{ id: 31, name: 'Hardware', inactiveFlag: false }],
    '/service/boards/10/items': [{ id: 32, name: 'Laptop', inactiveFlag: false }],
    '/service/boards/10/typeSubTypeItemAssociations': [{ id: 33, type: { id: 30, name: 'Incident' }, subType: { id: 31, name: 'Hardware' }, item: { id: 32, name: 'Laptop' } }],
    '/service/priorities': [{ id: 40, name: 'Normal', inactiveFlag: false }],
    '/service/sources': [{ id: 41, name: 'Portal', inactiveFlag: false }],
    '/company/companies/statuses': [{ id: 4, name: 'Inactive', disallowSavingFlag: false, inactiveFlag: false }],
    '/company/companies/987': { id: 987, name: 'Acme', identifier: 'ACME', status: { id: 4, name: 'Inactive' }, deletedFlag: false },
    '/company/companies/988': { id: 988, name: 'Blocked', identifier: 'BLOCKED', status: { id: 5 }, deletedFlag: false },
    '/company/companies/989': { id: 989, name: 'Deleted', identifier: 'DELETED', status: { id: 4 }, deletedFlag: true },
    '/company/companies': [{ id: 987, name: 'Acme', identifier: 'ACME', status: { id: 4, name: 'Inactive' }, deletedFlag: false }]
  };
  const api = { async request(request) { calls.push(request); return { statusCode: 200, headers: {}, data: rows[request.path] || [] }; } };
  const adapter = createConnectWiseAdapter({ api });
  const transport = async () => { throw new Error('network disabled'); };

  const boards = await adapter.discover({ input: { kind: 'service-boards' }, connection, transport });
  assert.deepStrictEqual(boards.options, [{ id: '10', label: 'Service', metadata: { active: true } }]);
  const statuses = await adapter.discover({ input: { kind: 'board-statuses', boardId: '10' }, connection, transport });
  assert.strictEqual(statuses.options[0].metadata.closedStatus, false);
  const types = await adapter.discover({ input: { kind: 'board-types', boardId: '10' }, connection, transport });
  assert.strictEqual(types.options[0].id, '30');
  const subtypes = await adapter.discover({ input: { kind: 'board-subtypes', boardId: '10' }, connection, transport });
  const items = await adapter.discover({ input: { kind: 'board-items', boardId: '10' }, connection, transport });
  const associations = await adapter.discover({ input: { kind: 'type-subtype-item-associations', boardId: '10' }, connection, transport });
  assert.deepStrictEqual(associations.options[0].metadata, { typeId: '30', subtypeId: '31', itemId: '32' });
  assert.strictEqual(subtypes.options[0].id, '31');
  assert.strictEqual(items.options[0].id, '32');
  assert.strictEqual((await adapter.discover({ input: { kind: 'priorities' }, connection, transport })).options[0].id, '40');
  assert.strictEqual((await adapter.discover({ input: { kind: 'sources' }, connection, transport })).options[0].id, '41');
  assert.strictEqual((await adapter.discover({ input: { kind: 'company-statuses' }, connection, transport })).options[0].metadata.disallowSavingFlag, false);
  const companies = await adapter.discover({ input: { kind: 'mapping-destinations', query: 'Acme', pageSize: 50, continuationToken: null }, connection, transport });
  assert.deepStrictEqual(companies.options[0].metadata, { eligible: true, eligibilityKnown: true, eligibilityReason: '', identifier: 'ACME' });
  assert.strictEqual(companies.complete, true);
  assert(calls.some((call) => call.path === '/company/companies' && call.query.conditions.includes("name like '%Acme%'")));

  await assert.rejects(() => adapter.discover({ input: { kind: 'board-statuses' }, connection, transport }), /parent/i, 'dependent discovery without its parent fails safely');
  const eligible = await adapter.validateConfiguration({ input: { mode: 'organization-eligibility', mappings: [{ destinationId: '987' }] }, connection, transport });
  assert.strictEqual(eligible.ok, true, 'status display name does not determine eligibility');
  const unknown = await adapter.validateConfiguration({ input: { mode: 'organization-eligibility', mappings: [{ destinationId: 'missing' }] }, connection, transport: async () => ({ status: 200, data: [] }) });
  assert.strictEqual(unknown.ok, false, 'unknown eligibility is rejected');

  const blockedApi = { async request(request) { calls.push(request); return { statusCode: 200, headers: {}, data: rows[request.path] || (request.path === '/company/companies/statuses' ? [{ id: 5, name: 'Enabled', disallowSavingFlag: true }] : []) }; } };
  const blockedAdapter = createConnectWiseAdapter({ api: blockedApi });
  const blocked = await blockedAdapter.validateConfiguration({ input: { mode: 'organization-eligibility', mapping: { destinationId: '988' } }, connection, transport });
  assert.strictEqual(blocked.ok, false, 'disallowSavingFlag rejects company eligibility');
  const deleted = await adapter.validateConfiguration({ input: { mode: 'organization-eligibility', mapping: { destinationId: '989' } }, connection, transport });
  assert.strictEqual(deleted.ok, false, 'deleted companies are rejected');

  const pageCalls = [];
  const pagedAdapter = createConnectWiseAdapter({ api: { async request(request) {
    pageCalls.push(request);
    if (request.path === '/company/companies/statuses') return { statusCode: 200, headers: {}, data: [{ id: 4, disallowSavingFlag: false }] };
    const pageId = request.query.pageId;
    if (!pageId) return { statusCode: 200, headers: { Link: '<https://api-na.myconnectwise.net/v4_6_release/apis/3.0/company/companies?pageSize=500&pageId=500>; rel="next"' }, data: Array.from({ length: 500 }, (_, index) => ({ id: index + 1, name: `Company ${index + 1}`, status: { id: 4 }, deletedFlag: false })) };
    return { statusCode: 200, headers: {}, data: [{ id: 501, name: 'Company 501', status: { id: 4 }, deletedFlag: false }] };
  } } });
  const firstPage = await pagedAdapter.discover({ input: { kind: 'mapping-destinations', query: '', pageSize: 500 }, connection, transport });
  assert.strictEqual(firstPage.options.length, 500);
  assert.strictEqual(firstPage.hasMore, true);
  const secondPage = await pagedAdapter.discover({ input: { kind: 'mapping-destinations', query: '', pageSize: 500, continuationToken: firstPage.nextPageToken }, connection, transport });
  assert.strictEqual(secondPage.options[0].id, '501');
  assert.strictEqual(secondPage.complete, true);
  assert.strictEqual(pageCalls.some((call) => call.headers?.['pagination-type'] === 'forward-only'), true);
  assert.strictEqual(pageCalls.some((call) => call.query?.pageId === '500'), true, 'next Link pageId is consumed as a safe continuation');
  await assert.rejects(() => pagedAdapter.discover({ input: { kind: 'mapping-destinations', query: 'different', pageSize: 500, continuationToken: firstPage.nextPageToken }, connection, transport }), /refresh discovery/i, 'provider cursors are bound to the search query');
  console.log('ConnectWise discovery contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
