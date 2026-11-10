const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');

const { prepareDataSourceSigning, getSignedDataSource } = require('../scheduleSigning');
const { setupReporting, prepareReportingSigning } = require('../reporting/reportingService');

const configuration = {
  id: 'a17d0001-1234-4567-890a-123456782abc', type: 'DataSourceConfiguration',
  name: 'Configuration Management - Control Status', description: 'Status', language: 'PowerShell',
  platform: 'Windows', script_text: 'Write-Output test'
};
const intentId = '11111111-1111-4111-8111-111111111111';

function digest(value) {
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function fixture() {
  const jobs = new Map();
  const calls = [];
  const context = {
    integrationId: 'action1-configuration-manager',
    action1: { getCredentials: async () => ({ apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://app.action1.test/api/4.0', etpEnabled: true, etpMode: 'etp' }), provisioner: {
      async prepareSigning(input) {
        calls.push(['prepare', input]);
        const digestValue = digest(input.objects);
        let job = jobs.get(input.idempotencyKey);
        if (job && job.digest !== digestValue) throw new Error('Signing intent changed.');
        if (!job) { job = { id: crypto.randomUUID(), integrationId: context.integrationId, purpose: 'sign-only', state: 'awaiting_signature', objects: structuredClone(input.objects), digest: digestValue, origin: 'https://app.action1.test', expiresAt: Date.now() + 60000 }; jobs.set(input.idempotencyKey, job); }
        return { signingId: job.id, digest: job.digest, outcome: job.state };
      },
      async getSigning(id) { calls.push(['get', id]); return [...jobs.values()].find(job => job.id === id); }
    } },
    async http(input) { calls.push(['http', input]); if (input.url.endsWith('/oauth2/token')) return { status: 200, data: { access_token: 'token' } }; return { status: 200, data: {} }; },
    db: { async get() { return null; }, async run() {} }
  };
  return { context, jobs, calls, sign() { const job = [...jobs.values()][0]; job.state = 'signed'; job.results = job.objects.map(object => ({ id: object.id, configurationDigest: digest(object.configuration), signature: { alg: 'PS256', iat: 1, kid: 'key', value: 'sig' } })); } };
}

test('Data Source signing preserves the exact configuration and enterprise reference is added only at submission', async () => {
  const f = fixture();
  const prepared = await prepareDataSourceSigning(f.context, { configuration, intentId });
  f.sign();
  const signed = await getSignedDataSource(f.context, { configuration, intentId, ...prepared });
  assert.deepEqual(signed.configuration, configuration);
  assert.equal(Object.hasOwn(signed.configuration, 'organization_id'), false);
  assert.equal(signed.signature.value, 'sig');
});

test('ETP reporting creation requires signed approval and submits the signed config unchanged', async () => {
  const f = fixture();
  const calls = [];
  const client = {
    async resolveConnection() { return { apiGeneration: 4 }; },
    async requestAction1Mutation(input) { calls.push(input); if (input.method === 'POST' && input.path === '/data-sources/all') return { id: input.body.configs[0].id, type: 'DataSource', configs: input.body.configs, columns: input.body.columns }; if (input.method === 'GET' && input.path.startsWith('/data-sources/')) throw { statusCode: 404, diagnostics: { responseContentType: 'application/json', errorMessage: 'not found' } }; if (input.method === 'GET') return { id: input.path.split('/').pop(), data_sources: [] }; if (input.method === 'POST') return { id: 'report' }; return {}; }
  };
  await assert.rejects(() => setupReporting(f.context, { payload: {} }, { client, apiGeneration: 4, uuidGenerator: () => configuration.id }), /signing/i);
  const prepared = await prepareReportingSigning(f.context, { payload: { intentId } });
  f.sign();
  const result = await setupReporting(f.context, { payload: { intentId, configurationId: prepared.configurationId, signingId: prepared.signingId, digest: prepared.digest } }, { client, apiGeneration: 4, uuidGenerator: () => prepared.configurationId });
  const post = calls.find(call => call.method === 'POST' && call.path === '/data-sources/all');
  assert.equal(post.body.configs[0].type, 'DataSourceConfiguration');
  assert.equal(Object.hasOwn(post.body.configs[0], 'organization_id'), false);
  assert.deepEqual(post.body.signatures[0].object_reference, { type: post.body.configs[0].type, id: post.body.configs[0].id, organization_id: 'all', platform: post.body.configs[0].platform });
  assert.equal(result.ok, true);
});
