const assert = require('assert');

const originalFetch = global.fetch;
const {
  isIssueCompleted,
  createIssue,
  getIssue,
  updateIssue
} = require('../jiraApi');

function settings() {
  return {
    JiraCloudSiteUrl: 'https://example.atlassian.net',
    JiraCloudUserEmail: 'jira-admin@example.com',
    JiraCloudApiToken: 'jira-secret'
  };
}

async function withMockedFetch(mock, worker) {
  global.fetch = mock;
  try {
    await worker();
  } finally {
    global.fetch = originalFetch;
  }
}

async function runCreateGetUpdateTests() {
  const calls = [];

  await withMockedFetch(async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: String(options.method || 'GET').toUpperCase(),
      auth: String(options?.headers?.Authorization || '')
    });
    const body = String(options.body || '');

    if (String(url).endsWith('/rest/api/3/issue') && String(options.method || '').toUpperCase() === 'POST') {
      assert.strictEqual(body.includes('"project"'), true);
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: '10001', key: 'OPS-1', self: 'https://example.atlassian.net/rest/api/3/issue/10001' })
      };
    }

    if (String(url).includes('/rest/api/3/issue/OPS-1?fields=status') && String(options.method || '').toUpperCase() === 'GET') {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: '10001',
            key: 'OPS-1',
            self: 'https://example.atlassian.net/rest/api/3/issue/10001',
            fields: {
              status: {
                name: 'To Do',
                statusCategory: {
                  key: 'new',
                  name: 'To Do'
                }
              }
            }
          })
      };
    }

    if (String(url).endsWith('/rest/api/3/issue/OPS-1') && String(options.method || '').toUpperCase() === 'PUT') {
      return {
        ok: true,
        status: 204,
        text: async () => ''
      };
    }

    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const payload = {
      fields: {
        project: { id: '1001' },
        issuetype: { id: '10001' },
        summary: '[Action1] Endpoint Offline - BoxOne',
        description: { type: 'doc', version: 1, content: [] },
        labels: ['action1', 'action1-offline']
      }
    };

    const created = await createIssue(settings(), payload);
    assert.strictEqual(created.id, '10001');
    assert.strictEqual(created.key, 'OPS-1');
    assert.strictEqual(created.browseUrl, 'https://example.atlassian.net/browse/OPS-1');

    const fetched = await getIssue(settings(), 'OPS-1');
    assert.strictEqual(fetched.key, 'OPS-1');
    assert.strictEqual(fetched.statusName, 'To Do');
    assert.strictEqual(fetched.statusCategoryKey, 'new');
    assert.strictEqual(fetched.completed, false);

    const updated = await updateIssue(settings(), 'OPS-1', payload);
    assert.deepStrictEqual(updated, { ok: true });

    assert.strictEqual(calls.some((call) => call.url.endsWith('/rest/api/3/issue') && call.method === 'POST'), true);
    assert.strictEqual(calls.some((call) => call.url.includes('/rest/api/3/issue/OPS-1?fields=status') && call.method === 'GET'), true);
    assert.strictEqual(calls.some((call) => call.url.endsWith('/rest/api/3/issue/OPS-1') && call.method === 'PUT'), true);
    assert.strictEqual(calls.some((call) => call.url.includes('fields=resolution')), false);
    assert.strictEqual(calls.some((call) => /transition|resolution/i.test(call.url)), false);
    assert.strictEqual(calls.every((call) => call.auth.startsWith('Basic ')), true);
  });
}

async function runSafeErrorTests() {
  await withMockedFetch(async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ message: 'authorization=Basic abc123 token=jira-secret' })
  }), async () => {
    try {
      await createIssue(settings(), { fields: {} });
      assert.fail('createIssue should throw on bad auth');
    } catch (error) {
      const text = JSON.stringify(error?.diagnostic || {});
      assert.strictEqual(text.includes('jira-secret'), false);
      assert.strictEqual(/Basic\s+[A-Za-z0-9+/=]+/.test(text), false);
    }
  });
}

async function runNotFoundTest() {
  await withMockedFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ message: 'not found' })
  }), async () => {
    const issue = await getIssue(settings(), 'OPS-404');
    assert.strictEqual(issue, null);
  });
}

function runCompletedInterpretationTests() {
  assert.strictEqual(isIssueCompleted({ statusCategoryKey: 'done' }), true, 'statusCategory.key done should be completed');
  assert.strictEqual(isIssueCompleted({ statusCategoryKey: 'DONE' }), true, 'statusCategory.key done should be case-insensitive');
  assert.strictEqual(isIssueCompleted({ statusCategoryKey: 'completed' }), true, 'statusCategory.key completed should be completed');
  assert.strictEqual(isIssueCompleted({ statusCategoryKey: 'COMPLETED' }), true, 'statusCategory.key comparison should be case-insensitive');
  assert.strictEqual(isIssueCompleted({ statusCategoryKey: 'custom-open-key' }), false, 'any other status category key should stay open');
  assert.strictEqual(isIssueCompleted({ statusName: 'Resolved', statusCategoryKey: 'custom-open-key' }), false, 'status name Resolved should not override a non-completed status category');
  assert.strictEqual(isIssueCompleted({ statusName: 'Done', statusCategoryKey: 'custom-open-key' }), false, 'status name Done should not override a non-completed status category');
  assert.strictEqual(isIssueCompleted({ statusName: 'Completed', statusCategoryKey: 'custom-open-key' }), false, 'status name Completed should not override a non-completed status category');
  assert.strictEqual(isIssueCompleted({ statusCategoryName: 'Done' }), false, 'statusCategory.name must not be used for completed detection');
  assert.strictEqual(isIssueCompleted({ resolutionName: 'Fixed' }), false, 'resolution must not be used for completed detection');
  assert.strictEqual(isIssueCompleted({ statusName: 'Closed', statusCategoryKey: 'custom-open-key' }), false, 'status name fallback must not be used for completed detection');
  assert.strictEqual(isIssueCompleted({}), false, 'missing status metadata should stay open');
}

async function run() {
  await runCreateGetUpdateTests();
  await runSafeErrorTests();
  await runNotFoundTest();
  runCompletedInterpretationTests();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
