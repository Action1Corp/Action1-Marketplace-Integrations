const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { loadControlPackFixture } = require('./controlPackFixture');

// Execute the production page with a deterministic hook/router harness. Child views
// are boundaries: inspect their props and invoke the same callbacks they receive.
async function harness(search = '', options = {}) {
  const { transformWithOxc } = await import('vite');
  const directory = path.join(__dirname, '..', 'ui', 'policies');
  const bindings = {};
  for (const file of ['policyRouting.js', 'policyEditorState.js', 'policyValidation.js', 'policyUiStyles.js', './historyProgressPoller.js', '../catalog/controlPackCatalog.js']) {
    Object.assign(bindings, await import(pathToFileURL(path.join(directory, file)).href));
  }
  const source = fs.readFileSync(path.join(directory, 'PolicyPage.jsx'), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '')
    .replace('export default PolicyPage;', 'globalThis.Page = PolicyPage;');
  const compiled = await transformWithOxc(source, 'PolicyPage.jsx', { jsx: { runtime: 'classic' } });
  const policy = {
    policyId: 'POL-000064', baseName: 'Existing', displayName: 'Existing - All endpoints',
    organizationId: 'org-test', organizationNameSnapshot: 'Test', scopeType: 'ALL_ENDPOINTS',
    enabled: true, policyMode: 'ASSESS_ONLY', selectedControls: [],
    runSchedule: { runEveryHours: 24, startDate: '2026-09-22', startTime: '12:00', timezone: 'UTC' },
    completionDeadlineMinutes: 1440
  };
  let history = [{ search, key: '0' }], position = 0, serial = 0;
  let slots = [], cursor = 0, effects = [], dirty = true, tree;
  const mutations = [];
  const api = {
    async getControlPack() { return loadControlPackFixture(); },
    async listPolicies() { return options.emptyList ? [] : [policy]; },
    async getPolicy(id) { return options.getPolicy ? options.getPolicy(id) : id === policy.policyId ? policy : null; },
    async savePolicy(draft, progressOperationId) {
      mutations.push(draft); options.onProgressOperationId?.(progressOperationId);
      return options.savePolicy ? options.savePolicy(draft, progressOperationId) : { ...policy, ...draft, policyId: policy.policyId };
    },
    async deletePolicy(policyId, progressOperationId) {
      options.onProgressOperationId?.(progressOperationId);
      return options.deletePolicy ? options.deletePolicy(policyId, progressOperationId) : { ok: true, deleted: true };
    }
  };
  const navigate = (url, config = {}) => {
    const entry = { search: new URL(url, 'http://localhost').search, key: String(++serial) };
    if (config.replace) history[position] = entry;
    else { history = history.slice(0, position + 1); history.push(entry); position++; }
    dirty = true;
  };
  const context = {
    ...bindings, console, Date, Intl, URLSearchParams,
    React: { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (value) => {
        const next = typeof value === 'function' ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
    useLocation: () => history[position], useNavigate: () => navigate,
    createPolicyApi: () => api, createPolicyDiscoveryApi: () => ({}),
    extractHistoryEnvelope: () => null,
    createHistoryAdapter: () => ({ async listRaw() { return { rows: [] }; } }),
    createHistoryProgressPoller: (pollOptions) => {
      if (options.progressCheckpoint) pollOptions.onProgress({ ...options.progressCheckpoint, operationId: pollOptions.operationId });
      return () => options.onPollStop?.();
    },
    createAction1OrganizationRepository: () => ({ async listOrganizations() { return [{ id: 'org-test', name: 'Test' }]; } }),
    createAction1EndpointGroupRepository: () => ({ async listEndpointGroups() { return options.getEndpointGroups ? options.getEndpointGroups() : { endpointGroups: [] }; } }),
    PolicyDetailsView: 'Details', PolicyEditorView: 'Editor', PolicyListView: 'List', OperationStatus: 'OperationStatus'
  };
  vm.createContext(context);
  vm.runInContext(compiled.code, context);
  async function flush() {
    for (let count = 0; count < 40; count++) {
      if (dirty) { dirty = false; cursor = 0; effects = []; tree = context.Page({ integration: 'action1-configuration-manager' }); effects.forEach((effect) => effect()); }
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty) return;
    }
    throw new Error('Page did not settle');
  }
  function find(type, node = tree) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === type) return node.props;
    for (const child of [node.props?.children || node].flat(Infinity)) {
      if (child === node) continue;
      const found = find(type, child); if (found) return found;
    }
    return null;
  }
  function findButton(label, node = tree) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && [node.props?.children].flat(Infinity).includes(label)) return node.props;
    for (const child of [node.props?.children || node].flat(Infinity)) {
      if (child === node) continue;
      const found = findButton(label, child); if (found) return found;
    }
    return null;
  }
  await flush();
  return { flush, find, findButton, policy, mutations, text: () => JSON.stringify(tree), search: () => history[position].search,
    async go(query) { navigate(`/policies${query}`); await flush(); },
    async back() { position = Math.max(0, position - 1); dirty = true; await flush(); },
    async forward() { position = Math.min(history.length - 1, position + 1); dirty = true; await flush(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); }
  };
}

async function run() {
  const page = await harness('?policyId=POL-000064');
  assert(page.find('Details'), 'Existing link opens Details');
  page.find('Details').onEdit(); await page.flush();
  assert.strictEqual(page.search(), '?policyId=POL-000064&mode=edit');
  assert.strictEqual(page.find('Editor').draft.policyId, 'POL-000064');
  assert.strictEqual(page.find('Editor').isEditMode, true);
  await page.back(); assert(page.find('Details'));
  await page.forward(); assert(page.find('Editor'));
  page.find('Editor').onCancel(); await page.flush();
  assert.strictEqual(page.search(), '?policyId=POL-000064');
  await page.back(); assert(page.find('Details'), 'Cancel replaces the editor entry');
  await page.go('');
  page.find('List').onEdit('POL-000064'); await page.flush();
  assert.strictEqual(page.search(), '?policyId=POL-000064&mode=edit');
  await page.go('');
  page.find('List').onCreate(); await page.flush();
  assert.strictEqual(page.search(), '?mode=create');
  assert.strictEqual(page.find('Editor').draft.mode, 'create');
  await page.back(); assert(page.find('List'));
  await page.forward(); assert(page.find('Editor'));
  page.find('Editor').onCancel(); await page.flush();
  assert.strictEqual(page.search(), '');
  await page.back(); assert(page.find('List'));

  const name = 'Remote Workforce & + # 日本語';
  await page.go(`?mode=create&${new URLSearchParams({ policyName: name })}`);
  assert.strictEqual(page.find('Editor').draft.baseName, name);
  assert.strictEqual(page.find('Editor').draft.organizationId, '');
  assert.strictEqual(page.find('Editor').draft.selectedControls.length, 0);
  page.find('Editor').onChange({ ...page.find('Editor').draft, baseName: 'User edit', organizationId: 'org-test' });
  await page.flush();
  assert.strictEqual(page.find('Editor').draft.baseName, 'User edit');
  assert.strictEqual(page.mutations.length, 0, 'Navigation/discovery never saves');
  const refreshed = await harness(page.search());
  assert.strictEqual(refreshed.find('Editor').draft.baseName, name);
  const refreshedEdit = await harness('?policyId=POL-000064&mode=edit&policyName=ignored');
  assert.strictEqual(refreshedEdit.find('Editor').draft.baseName, 'Existing');
  await page.go('?mode=edit'); assert.match(page.text(), /Policy id is required/i);
  await page.go('?mode=unsupported'); assert(page.find('List'));
  await page.go('?mode=unsupported&policyId=POL-000064'); assert(page.find('Details'));
  await page.go('?mode=edit&policyId=POL-999999'); assert.match(page.text(), /Policy not found/);
  await page.go('?mode=create&policyId=POL-000064'); assert(page.find('Editor')); assert(!page.search().includes('policyId'));

  let resolveOld;
  const delayed = await harness('?policyId=POL-000064&mode=edit', { emptyList: true, getPolicy: () => new Promise((resolve) => { resolveOld = resolve; }) });
  await delayed.go('?mode=create&policyName=New');
  resolveOld(delayed.policy); await delayed.flush();
  assert.strictEqual(delayed.find('Editor').draft.baseName, 'New');
  assert.strictEqual(delayed.find('Editor').isEditMode, false);

  const groupRequests = [];
  const discovery = await harness('?mode=create&policyName=Old', { getEndpointGroups: () => new Promise((resolve) => groupRequests.push(resolve)) });
  discovery.find('Editor').onChange({ ...discovery.find('Editor').draft, organizationId: 'org-test' }); await discovery.flush();
  await discovery.go('?mode=create&policyName=New');
  discovery.find('Editor').onChange({ ...discovery.find('Editor').draft, organizationId: 'org-test', baseName: 'User changed' }); await discovery.flush();
  groupRequests.at(-1)({ endpointGroups: [{ id: 'current-group' }] }); await discovery.flush();
  groupRequests[0]({ endpointGroups: [{ id: 'stale-group' }] }); await discovery.flush();
  assert.strictEqual(discovery.find('Editor').endpointGroups[0].id, 'current-group', 'Old discovery must not overwrite the new route');
  assert.strictEqual(discovery.find('Editor').draft.baseName, 'User changed');

  // The page still gates persistence through its real validator; use a valid
  // catalog Control to exercise the existing success destinations.
  for (const query of ['?mode=create&policyName=Save', '?policyId=POL-000064&mode=edit']) {
    await page.go(query);
    const editor = page.find('Editor');
    const control = editor.catalog.controls.find((entry) => (entry.parameters || []).length === 0);
    assert(control, 'Fixture contains a parameterless Control');
    const valid = { ...editor.draft, baseName: 'Save', organizationId: 'org-test', organizationName: 'Test', selectedControls: [{ controlId: control.controlId, parameters: {} }] };
    assert.strictEqual(editor.onSave(valid), true);
    await page.flush();
    assert.strictEqual(page.search(), query.includes('mode=edit') ? '?policyId=POL-000064' : '');
  }

  let finishCreate, createOperationId, createPollStopped = 0;
  const createProgressPage = await harness('?mode=create&policyName=Progress', {
    onProgressOperationId(id) { createOperationId = id; },
    onPollStop() { createPollStopped++; },
    progressCheckpoint: { operation: 'create', completed: 3, total: 7 },
    savePolicy: () => new Promise((resolve) => { finishCreate = resolve; })
  });
  const createEditor = createProgressPage.find('Editor');
  const createControl = createEditor.catalog.controls.find((entry) => !(entry.parameters || []).length);
  createEditor.onSave({ ...createEditor.draft, baseName: 'Progress', organizationId: 'org-test', selectedControls: [{ controlId: createControl.controlId, parameters: {} }] });
  await createProgressPage.flush();
  assert.strictEqual(createProgressPage.find('OperationStatus').primaryLabel, 'Creating Policy...');
  assert.strictEqual(createProgressPage.find('OperationStatus').secondaryLabel, 'Creating automations: 3 of 7');
  assert.match(createOperationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await createProgressPage.go('');
  assert(createPollStopped > 0, 'Navigation out of the operation route should stop history polling');
  finishCreate(createProgressPage.policy); await createProgressPage.flush();

  let finishDelete, deleteOperationId, deletePollStopped = 0;
  const deleteProgressPage = await harness('', {
    onProgressOperationId(id) { deleteOperationId = id; },
    onPollStop() { deletePollStopped++; },
    progressCheckpoint: { operation: 'delete', completed: 2, total: 7 },
    deletePolicy: () => new Promise((resolve) => { finishDelete = resolve; })
  });
  deleteProgressPage.find('List').onDelete(deleteProgressPage.policy.policyId); await deleteProgressPage.flush();
  deleteProgressPage.findButton('Delete Policy').onClick(); await deleteProgressPage.flush();
  assert.strictEqual(deleteProgressPage.find('OperationStatus').primaryLabel, 'Deleting Policy...');
  assert.strictEqual(deleteProgressPage.find('OperationStatus').secondaryLabel, 'Deleting automations: 2 of 7');
  assert(deleteOperationId);
  deleteProgressPage.unmount();
  assert(deletePollStopped > 0, 'Unmount should stop history polling');
  finishDelete({ ok: true, deleted: true }); await deleteProgressPage.flush();
  createProgressPage.unmount();
  for (const item of [page, refreshed, refreshedEdit, delayed, discovery]) item.unmount();
  console.log('Policy page routing flows passed.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
