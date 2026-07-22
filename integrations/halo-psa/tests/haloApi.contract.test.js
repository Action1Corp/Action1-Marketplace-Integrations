const assert = require('assert');

const originalFetch = global.fetch;
const { discoverHaloClients } = require('../haloApi');

const SETTINGS = Object.freeze({
  HaloPsaResourceServer: 'https://halo.example.com/api'
});

function buildClient(id, name = `Client ${id}`) {
  return { id: String(id), name };
}

function buildPaginatedClients(pageNo, pageSize, recordCount, clients) {
  return {
    page_no: pageNo,
    page_size: pageSize,
    record_count: recordCount,
    clients
  };
}

async function withMockedFetch(mock, worker) {
  global.fetch = mock;
  try {
    return await worker();
  } finally {
    global.fetch = originalFetch;
  }
}

async function discoverWithMock(mock) {
  return withMockedFetch(mock, async () => discoverHaloClients(SETTINGS, { accessToken: 'halo-token', tokenType: 'Bearer' }));
}

function jsonResponse(status, payload, headers = {}) {
  const normalizedHeaders = {
    'content-type': 'application/json',
    ...headers
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      forEach(callback) {
        for (const [key, value] of Object.entries(normalizedHeaders)) {
          callback(value, key);
        }
      }
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function pathAndSearch(url) {
  const parsed = new URL(String(url));
  return `${parsed.pathname}${parsed.search}`;
}

async function testFirstRequestUsesOneBasedPaginatedContract() {
  const calls = [];
  const clients = await discoverWithMock(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, buildPaginatedClients(1, 50, 1, [buildClient('1', 'Acme')]));
  });

  assert.deepStrictEqual(clients, [{ id: '1', name: 'Acme' }]);
  assert.strictEqual(calls.length, 1, 'single-page result should only fetch one page');
  const parsed = new URL(calls[0].url);
  assert.strictEqual(parsed.pathname, '/api/Client', 'client discovery should target /Client');
  assert.strictEqual(parsed.searchParams.get('pageinate'), 'true', 'client discovery should enable Halo pagination');
  assert.strictEqual(parsed.searchParams.get('page_no'), '1', 'client discovery should start on page 1');
  assert.strictEqual(parsed.searchParams.get('page_size'), '50', 'client discovery should use the bounded page size');
  assert.strictEqual(parsed.searchParams.get('count'), null, 'client discovery should not use count');
  assert.strictEqual(parsed.searchParams.get('$top'), null, 'client discovery should not use $top');
}

async function testTwoPagesAreCombinedWithOneBasedProgression() {
  const requests = [];
  const clients = await discoverWithMock(async (url) => {
    const path = pathAndSearch(url);
    requests.push(path);
    const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));

    if (pageNo === 1) {
      return jsonResponse(200, buildPaginatedClients(1, 50, 3, [
        buildClient('1', 'Acme'),
        buildClient('2', 'Beta')
      ]));
    }

    if (pageNo === 2) {
      return jsonResponse(200, buildPaginatedClients(2, 50, 3, [
        buildClient('3', 'Contoso')
      ]));
    }

    throw new Error(`Unexpected path ${path}`);
  });

  assert.deepStrictEqual(requests, [
    '/api/Client?pageinate=true&page_no=1&page_size=50',
    '/api/Client?pageinate=true&page_no=2&page_size=50'
  ]);
  assert.deepStrictEqual(clients, [
    { id: '1', name: 'Acme' },
    { id: '2', name: 'Beta' },
    { id: '3', name: 'Contoso' }
  ]);
}

async function testFinalPartialPageAndRecordCountCompletion() {
  const clients = await discoverWithMock(async (url) => {
    const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
    if (pageNo === 1) {
      return jsonResponse(200, buildPaginatedClients(1, 50, 51, Array.from({ length: 50 }, (_, index) => buildClient(index + 1))));
    }

    if (pageNo === 2) {
      return jsonResponse(200, buildPaginatedClients(2, 50, 51, [buildClient(51)]));
    }

    throw new Error(`Unexpected page ${pageNo}`);
  });

  assert.strictEqual(clients.length, 51, 'final partial page should be included');
  assert.deepStrictEqual(clients[0], { id: '1', name: 'Client 1' });
  assert.deepStrictEqual(clients[50], { id: '51', name: 'Client 51' });
}

async function testApproximatelyFourHundredClientsAreReturnedCompletely() {
  const total = 400;
  const pageSize = 50;
  const clients = await discoverWithMock(async (url) => {
    const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
    const start = (pageNo - 1) * pageSize + 1;
    const end = Math.min(total, start + pageSize - 1);
    return jsonResponse(200, buildPaginatedClients(
      pageNo,
      pageSize,
      total,
      Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => buildClient(start + index))
    ));
  });

  assert.strictEqual(clients.length, total, 'all clients across many pages should be returned');
  assert.deepStrictEqual(clients[0], { id: '1', name: 'Client 1' });
  assert.deepStrictEqual(clients[399], { id: '400', name: 'Client 400' });
}

async function testFirstSeenOrderingAndDuplicateIdDeduping() {
  const clients = await discoverWithMock(async (url) => {
    const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
    if (pageNo === 1) {
      return jsonResponse(200, buildPaginatedClients(1, 50, 4, [
        buildClient('100', 'Alpha'),
        buildClient('200', 'Beta')
      ]));
    }

    if (pageNo === 2) {
      return jsonResponse(200, buildPaginatedClients(2, 50, 4, [
        buildClient('200', 'Beta Renamed'),
        buildClient('300', 'Gamma'),
        buildClient('400', 'Delta')
      ]));
    }

    throw new Error(`Unexpected page ${pageNo}`);
  });

  assert.deepStrictEqual(clients, [
    { id: '100', name: 'Alpha' },
    { id: '200', name: 'Beta' },
    { id: '300', name: 'Gamma' },
    { id: '400', name: 'Delta' }
  ], 'duplicate IDs should not disturb first-seen order');
}

async function testValidEmptyPaginatedResultSucceeds() {
  const clients = await discoverWithMock(async () => jsonResponse(200, buildPaginatedClients(1, 50, 0, [])));
  assert.deepStrictEqual(clients, [], 'record_count=0 with empty page should succeed');
}

async function testRepeatedPageBeforeCompletionFails() {
  await assert.rejects(
    () => discoverWithMock(async () => jsonResponse(200, buildPaginatedClients(1, 50, 3, [buildClient('1', 'Acme')]))),
    /repeated page/i
  );
}

async function testNoProgressBeforeCompletionFails() {
  await assert.rejects(
    () => discoverWithMock(async (url) => {
      const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
      if (pageNo === 1) {
        return jsonResponse(200, buildPaginatedClients(1, 50, 3, [buildClient('1', 'Acme')]));
      }
      return jsonResponse(200, buildPaginatedClients(2, 50, 3, [buildClient('1', 'Acme')]));
    }),
    /made no progress/i
  );
}

async function testContradictoryPageMetadataFailsSafely() {
  await assert.rejects(
    () => discoverWithMock(async () => jsonResponse(200, buildPaginatedClients(9, 50, 1, [buildClient('1', 'Acme')]))),
    /unexpected page_no/i
  );
}

async function testInvalidRecordCountFailsSafely() {
  await assert.rejects(
    () => discoverWithMock(async () => jsonResponse(200, {
      page_no: 1,
      page_size: 50,
      record_count: 'not-a-number',
      clients: [buildClient('1', 'Acme')]
    })),
    /record_count/i
  );
}

async function testHardPageLimitFailsExplicitly() {
  await assert.rejects(
    () => discoverWithMock(async (url) => {
      const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
      return jsonResponse(200, buildPaginatedClients(pageNo, 50, 2501, [buildClient(pageNo, `Client ${pageNo}`)]));
    }),
    /paging exceeded limit/i
  );
}

async function testEmptyPageBeforeCompletionFailsExplicitly() {
  await assert.rejects(
    () => discoverWithMock(async (url) => {
      const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
      if (pageNo === 1) {
        return jsonResponse(200, buildPaginatedClients(1, 50, 2, [buildClient('1', 'Acme')]));
      }
      return jsonResponse(200, buildPaginatedClients(2, 50, 2, []));
    }),
    /ended before reaching record_count/i
  );
}

async function testMalformedSuccessfulResponseFailsSafely() {
  await assert.rejects(
    () => discoverWithMock(async () => jsonResponse(200, { clients: [buildClient('1', 'Acme')] })),
    /pagination metadata invalid/i
  );
}

async function run() {
  await testFirstRequestUsesOneBasedPaginatedContract();
  await testTwoPagesAreCombinedWithOneBasedProgression();
  await testFinalPartialPageAndRecordCountCompletion();
  await testApproximatelyFourHundredClientsAreReturnedCompletely();
  await testFirstSeenOrderingAndDuplicateIdDeduping();
  await testValidEmptyPaginatedResultSucceeds();
  await testRepeatedPageBeforeCompletionFails();
  await testNoProgressBeforeCompletionFails();
  await testContradictoryPageMetadataFailsSafely();
  await testInvalidRecordCountFailsSafely();
  await testHardPageLimitFailsExplicitly();
  await testEmptyPageBeforeCompletionFailsExplicitly();
  await testMalformedSuccessfulResponseFailsSafely();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
