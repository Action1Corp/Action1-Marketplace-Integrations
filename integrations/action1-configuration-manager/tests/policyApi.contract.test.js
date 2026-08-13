const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, policies: [], policy: { policyId: 'POL-000001' }, deleted: true };
      }
    };
  };

  const { createPolicyApi } = await import(
    pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'policyApi.js')).href
  );

  const api = createPolicyApi('action1-configuration-manager');
  await api.listPolicies();
  assert.strictEqual(fetchCalls[0].url, '/api/integrations/action1-configuration-manager/actions/list-policies');
  assert.strictEqual(fetchCalls[0].options.method, 'POST');

  const validDraft = {
    mode: 'create',
    baseName: 'Workstation Security'
  };

  await api.savePolicy(validDraft);
  assert.deepStrictEqual(JSON.parse(fetchCalls[1].options.body), {
    payload: { draft: validDraft }
  });

  await api.getPolicy('POL-000001');
  assert.deepStrictEqual(JSON.parse(fetchCalls[2].options.body), {
    payload: { policyId: 'POL-000001' }
  });

  await api.setPolicyEnabled('POL-000001', false);
  assert.deepStrictEqual(JSON.parse(fetchCalls[3].options.body), {
    payload: { policyId: 'POL-000001', enabled: false }
  });

  await api.deletePolicy('POL-000001');
  assert.deepStrictEqual(JSON.parse(fetchCalls[4].options.body), {
    payload: { policyId: 'POL-000001' }
  });

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { ok: false, message: 'Policy save failed.' };
    }
  });
  await assert.rejects(() => api.savePolicy(validDraft), /Policy save failed/);

  global.fetch = async () => ({
    ok: false,
    async json() {
      throw new Error('bad json');
    }
  });
  await assert.rejects(() => api.listPolicies(), /Unable to complete the policy request/);
}

try {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
