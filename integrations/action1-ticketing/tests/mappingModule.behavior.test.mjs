import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { createInMemoryTicketingDb } = require('./fixtures/inMemoryTicketingDb');
const { createDbMappingStore } = require('../mappingStore');
const { createDbCorrelationStore } = require('../correlationStore');
const { createDbSignalWatermarkStore } = require('../signalWatermarkStore');
const { createMappingActionHandlers } = require('../mappingActions');
const { createProviderDispatcher } = require('../providerRegistry');

const reactInternals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

function createHookHarness(component) {
  const slots = [];
  const initialized = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  const dispatcher = {
    useState(initial) {
      const slot = cursor++;
      if (!initialized[slot]) {
        slots[slot] = typeof initial === 'function' ? initial() : initial;
        initialized[slot] = true;
      }
      return [slots[slot], (next) => {
        slots[slot] = typeof next === 'function' ? next(slots[slot]) : next;
      }];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!initialized[slot]) {
        slots[slot] = { current: initial };
        initialized[slot] = true;
      }
      return slots[slot];
    },
    useEffect(effect, dependencies) {
      const slot = effectCursor++;
      if (!effects[slot]) effects[slot] = { effect, dependencies, started: false };
    }
  };

  function invoke(fn) {
    const previous = reactInternals.ReactCurrentDispatcher.current;
    reactInternals.ReactCurrentDispatcher.current = dispatcher;
    try { return fn(); } finally { reactInternals.ReactCurrentDispatcher.current = previous; }
  }

  return {
    render(props) {
      cursor = 0;
      effectCursor = 0;
      const tree = invoke(() => component(props));
      return tree;
    },
    async startEffects() {
      for (const entry of effects) {
        if (entry && !entry.started) {
          entry.started = true;
          invoke(() => entry.effect());
        }
      }
    },
    invoke
  };
}

function expandComponents(renderer, element) {
  if (Array.isArray(element)) return element.map((child) => expandComponents(renderer, child));
  if (!React.isValidElement(element)) return element;
  if (typeof element.type === 'function') {
    return expandComponents(renderer, renderer.invoke(() => element.type(element.props)));
  }
  const children = element.props?.children;
  if (Array.isArray(children)) return React.cloneElement(element, {}, ...children.map((child) => expandComponents(renderer, child)));
  if (React.isValidElement(children)) return React.cloneElement(element, {}, expandComponents(renderer, children));
  return element;
}

function flatten(element, output = []) {
  if (Array.isArray(element)) {
    for (const child of element) flatten(child, output);
  } else if (React.isValidElement(element)) {
    output.push(element);
    flatten(element.props?.children, output);
  }
  return output;
}

function textOf(element) {
  if (Array.isArray(element)) return element.map(textOf).join('');
  if (!React.isValidElement(element)) return String(element ?? '');
  return textOf(element.props?.children);
}

function createSyntheticUiRegistrySource() {
  return `
    import React from 'react';
    export const UI_PROVIDER_REGISTRY = globalThis.__mappingTestProviderUiRegistry;
    export function isUiProviderAvailable(provider) { return provider?.available === true && provider.contractMajor === 1; }
    export function resolveUiProvider(providerId) { return UI_PROVIDER_REGISTRY[providerId] || null; }
  `;
}

function testDestinationFields(providerId) {
  return function DestinationMappingFields(props) {
    globalThis.__mappingDestinationFieldProps.push({ providerId, ...props });
    return React.createElement('select', {
      'aria-label': providerId + ' destination row ' + (props.rowIndex + 1),
      'data-provider-destination': providerId,
      value: props.row.destinationId,
      disabled: props.disabled,
      onChange: (event) => {
        const option = props.options.find((item) => item.id === event.target.value);
        props.onChange(event.target.value, option?.name || '');
      }
    }, React.createElement('option', { value: '' }, '-- Select destination --'), ...props.options.map((option) =>
      React.createElement('option', { key: option.id, value: option.id }, option.label)));
  };
}

const testUiProviderRegistry = {
  'connectwise-psa': Object.freeze({ providerId: 'connectwise-psa', label: 'ConnectWise PSA', contractMajor: 1, available: false, configured: false, settingKeys: [], DestinationMappingFields: null }),
  'provider-a': { providerId: 'provider-a', label: 'Provider A', contractMajor: 1, available: true, configured: true, settingKeys: [], DestinationMappingFields: testDestinationFields('provider-a') },
  'provider-b': { providerId: 'provider-b', label: 'Provider B', contractMajor: 1, available: true, configured: true, settingKeys: [], DestinationMappingFields: testDestinationFields('provider-b') }
};
globalThis.__mappingTestProviderUiRegistry = testUiProviderRegistry;

const uiRegistryPlugin = {
  name: 'action1-mapping-test-provider-ui',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './providerRegistry.js' && importer?.replace(/\\/g, '/').endsWith('/ui/Mapping.jsx')) return '\0mapping-test-provider-registry';
    return null;
  },
  load(id) { return id === '\0mapping-test-provider-registry' ? createSyntheticUiRegistrySource() : null; }
};
const uiServer = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [react(), uiRegistryPlugin],
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});
const uiModule = await uiServer.ssrLoadModule('/integrations/action1-ticketing/ui/index.jsx');

function syntheticProvider(providerId, discover) {
  return {
    providerId,
    label: providerId,
    contractMajor: 1,
    adapter: {
      validateConfiguration: async () => ({ ok: true, errors: [] }),
      testConnection: async () => ({ ok: true }),
      discover: async () => ({ options: await discover() }),
      prepareTicket: async () => ({ payload: {}, comparisonValue: '', comparisonVersion: '1' }),
      getTicket: async () => ({ state: 'missing', confirmed: true }),
      createTicket: async () => ({ externalTicketRef: { id: 'fixture' } }),
      updateTicket: async () => ({ ok: true })
    }
  };
}

function makeResponse(payload, ok = true) {
  return { ok, status: ok ? 200 : 400, async json() { return payload; } };
}

async function makeHarness(fixture = {}) {
  const { context, tables } = createInMemoryTicketingDb();
  const calls = [];
  const testFieldProps = [];
  const state = {
    activeProviderId: fixture.activeProviderId || 'provider-a',
    action1Organizations: fixture.action1Organizations || [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: 'Beta' }, { id: 'org-6', name: 'Sixth' }],
    destinationOptions: fixture.destinationOptions || [{ id: 'dest-1', label: 'Acme Destination' }, { id: 'dest-new', label: 'New Destination' }, { id: 'dest-6', label: 'Sixth Destination' }],
    discovery: fixture.discovery || {},
    settings: fixture.settings || {}
  };
  context.settings = { async get(key) { return state.settings[key] || ''; }, async all() { return { ...state.settings }; } };
  const registry = Object.fromEntries(['provider-a', 'provider-b'].map((providerId) => [providerId, syntheticProvider(providerId, async () => {
    const value = state.discovery[providerId];
    if (typeof value === 'function') return value();
    if (value instanceof Error) throw value;
    return value || state.destinationOptions;
  })]));
  const definitions = Object.fromEntries(Object.keys(registry).map((providerId) => [providerId, {
    providerId, label: providerId, available: true, fields: [], accountSelectors: []
  }]));
  const handlers = createMappingActionHandlers({ registry, definitions, dispatcher: createProviderDispatcher(registry) });
  const actionHandlers = {
    'list-ticketing-org-destination-mappings': handlers.listHaloOrgClientMappings,
    'save-ticketing-org-destination-mapping': handlers.saveHaloOrgClientMapping,
    'delete-ticketing-org-destination-mapping': handlers.deleteHaloOrgClientMapping,
    'discover-ticketing-mapping-options': handlers.discoverHaloMappingOptions
  };
  const outstanding = [];
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.__mappingDestinationFieldProps = testFieldProps;
  globalThis.window = { confirm: () => true };
  globalThis.fetch = (url, options = {}) => {
    const request = (async () => {
      if (url === '/api/settings') return makeResponse({ settings: { TicketingActiveProvider: state.activeProviderId, ...state.settings } });
      const actionId = String(url).split('/').at(-1);
      const payload = options.body ? JSON.parse(options.body) : {};
      calls.push({ actionId, payload });
      if (actionId === 'discover-action1-mapping-options') return makeResponse({ ok: true, action1Organizations: state.action1Organizations });
      const handler = actionHandlers[actionId];
      if (!handler) throw new Error(`Unexpected mapping UI request: ${actionId}`);
      const result = await handler(context, payload);
      return makeResponse(result, result.ok !== false);
    })();
    outstanding.push(request);
    return request;
  };

  let component;
  let hookRenderer;
  let closed = false;
  async function settle() {
    for (let pass = 0; pass < 10; pass += 1) {
      const pending = outstanding.splice(0);
      if (pending.length) await Promise.all(pending);
      await Promise.resolve();
    }
  }
  async function mount() {
    component = uiModule.views.mapping;
    hookRenderer = createHookHarness(component);
    hookRenderer.render({ integration: 'action1-ticketing' });
    await hookRenderer.startEffects();
    await settle();
    return view();
  }
  function view() {
    const tree = hookRenderer.render({ integration: 'action1-ticketing' });
    const expanded = expandComponents(hookRenderer, tree);
    return { tree: expanded, elements: flatten(expanded), html: renderToStaticMarkup(expanded) };
  }
  function find(predicate, message) {
    const match = view().elements.find(predicate);
    assert(match, message);
    return match;
  }
  function button(label) {
    return find((element) => element.type === 'button' && textOf(element).trim() === label, `Expected visible ${label} button`);
  }
  function select(label) {
    return find((element) => element.type === 'select' && (
      element.props['aria-label'] === label ||
      textOf(element.props.children).includes(label) ||
      (label === 'Ticketing System' && textOf(element.props.children).includes('Provider A') && textOf(element.props.children).includes('Provider B'))
    ), `Expected visible ${label} selector`);
  }
  async function click(label) {
    const element = button(label);
    await element.props.onClick();
    await settle();
    return view();
  }
  async function change(element, value) {
    await element.props.onChange({ target: { value } });
    await settle();
    return view();
  }
  async function close() {
    if (closed) return;
    closed = true;
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    delete globalThis.__mappingDestinationFieldProps;
  }

  return { calls, context, tables, state, testFieldProps, mount, view, button, select, click, change, settle, close, discardOutstandingForTest() { outstanding.length = 0; } };
}

async function seedMapping(harness, providerId = 'provider-a', overrides = {}) {
  const store = createDbMappingStore(harness.context, providerId);
  const mapping = await store.save({
    action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: 'dest-1', destinationName: 'Acme Destination', ...overrides
  });
  const correlations = createDbCorrelationStore(harness.context, providerId);
  const watermarks = createDbSignalWatermarkStore(harness.context, providerId);
  await correlations.upsertEndpointCorrelation({ orgLinkId: String(mapping.id), endpointId: 'endpoint-1', signalType: 'OFFLINE', linkedTicketId: `ticket-${providerId}`, payloadHash: 'hash' });
  await correlations.upsertGroupedCorrelation({ orgLinkId: String(mapping.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', linkedTicketId: `group-${providerId}`, payloadHash: 'group-hash' });
  await watermarks.upsertWatermark({ orgLinkId: String(mapping.id), signalType: 'AUTOMATION_FAILED', watermarkValue: `watermark-${providerId}` });
  return { mapping, correlations, watermarks };
}

async function testRealMappingPageLoadProviderSelectionAndExtension() {
  const harness = await makeHarness({ activeProviderId: 'provider-a' });
  try {
    await seedMapping(harness);
    const initial = await harness.mount();
    assert.match(initial.html, /Organization Mapping/);
    assert.match(initial.html, /Active ticketing system: Provider A \(viewing active provider\)/);
    assert.match(initial.html, /provider-a destination row 1/);
    assert.equal(harness.testFieldProps.at(-1).providerId, 'provider-a');
    assert.equal(harness.testFieldProps.at(-1).row.action1OrgId, 'org-1');
    assert.equal(harness.testFieldProps.at(-1).options[0].id, 'dest-1');
    assert.equal(typeof harness.testFieldProps.at(-1).onChange, 'function');

    await harness.click('Add Mapping Row');
    assert.match(harness.view().html, /provider-a destination row 1/);
    assert.match(harness.view().html, /provider-a destination row 2/);
    const row2 = harness.select('provider-a destination row 2');
    await harness.change(row2, 'dest-6');
    assert.equal(harness.testFieldProps.at(-1).row.destinationId, 'dest-6');
    await harness.change(harness.select('Action1 Organization row 2'), 'org-6');
    await harness.click('Remove');
    assert.doesNotMatch(harness.view().html, /provider-a destination row 2/);

    await harness.change(harness.select('Ticketing System'), 'provider-b');
    const changed = harness.view();
    assert.match(changed.html, /Active ticketing system: Provider A \(viewing inactive provider\)/);
    assert(harness.calls.some((call) => call.actionId === 'list-ticketing-org-destination-mappings' && call.payload.providerId === 'provider-b'));
    assert.equal(harness.state.activeProviderId, 'provider-a', 'viewing another provider must not activate it');
    await harness.click('Add Mapping Row');
    assert.match(harness.view().html, /provider-b destination row 1/);
    assert.equal(harness.testFieldProps.at(-1).providerId, 'provider-b');
  } finally { await harness.close(); }
}

async function testLabelOnlyRenameRefreshAndSixthMappingPreserveTracking() {
  const harness = await makeHarness({
    action1Organizations: Array.from({ length: 6 }, (_, index) => ({ id: `org-${index + 1}`, name: `Organization ${index + 1}` })),
    destinationOptions: Array.from({ length: 6 }, (_, index) => ({ id: `dest-${index + 1}`, label: index === 2 ? 'Renamed destination' : `Destination ${index + 1}` }))
  });
  try {
    const store = createDbMappingStore(harness.context, 'provider-a');
    const rows = [];
    for (let index = 0; index < 5; index += 1) rows.push(await store.save({ action1OrgId: `org-${index + 1}`, action1OrgName: `Organization ${index + 1}`, destinationId: `dest-${index + 1}`, destinationName: `Destination ${index + 1}` }));
    const trackedRow = rows[2];
    const correlations = createDbCorrelationStore(harness.context, 'provider-a');
    const watermarks = createDbSignalWatermarkStore(harness.context, 'provider-a');
    await correlations.upsertEndpointCorrelation({ orgLinkId: String(trackedRow.id), endpointId: 'endpoint-1', signalType: 'OFFLINE', linkedTicketId: 'ticket-stable', payloadHash: 'hash' });
    await correlations.upsertGroupedCorrelation({ orgLinkId: String(trackedRow.id), signalType: 'VULNERABILITY', issueKey: 'CVE-1', linkedTicketId: 'group-stable', payloadHash: 'group-hash' });
    await watermarks.upsertWatermark({ orgLinkId: String(trackedRow.id), signalType: 'AUTOMATION_FAILED', watermarkValue: 'checkpoint-stable' });

    await harness.mount();
    await harness.click('Refresh Discovery');
    assert.equal(harness.calls.filter((call) => call.actionId === 'save-ticketing-org-destination-mapping').length, 0, 'Refresh Discovery alone is read-only');
    await harness.click('Add Mapping Row');
    await harness.change(harness.select('Action1 Organization row 6'), 'org-6');
    await harness.change(harness.select('provider-a destination row 6'), 'dest-6');
    await harness.click('Save Mappings');

    const saved = await store.list();
    assert.equal(saved.length, 6);
    assert.deepEqual(saved.slice(0, 5).map((row) => row.id), rows.map((row) => row.id), 'all five relationship IDs remain stable');
    assert.equal(saved[2].action1OrgName, 'Organization 3');
    assert.equal(saved[2].destinationName, 'Renamed destination');
    const writes = harness.calls.filter((call) => call.actionId === 'save-ticketing-org-destination-mapping');
    assert.deepEqual(writes.map((call) => call.payload.payload.id ?? null), [trackedRow.id, null], 'Save updates the renamed relationship under its ID and inserts only the sixth');
    assert.equal(await correlations.getEndpointCorrelation(String(trackedRow.id), 'endpoint-1', 'OFFLINE').then((row) => row.linkedTicketId), 'ticket-stable');
    assert.equal(await correlations.getGroupedCorrelation(String(trackedRow.id), 'VULNERABILITY', 'CVE-1').then((row) => row.linkedTicketId), 'group-stable');
    assert.equal(await watermarks.getWatermark(String(trackedRow.id), 'AUTOMATION_FAILED').then((row) => row.watermarkValue), 'checkpoint-stable');
  } finally { await harness.close(); }
}

async function testAction1RenameAndBothLabelChangesThroughUi() {
  const harness = await makeHarness({
    action1Organizations: [{ id: 'org-1', name: 'Acme renamed' }],
    destinationOptions: [{ id: 'dest-1', label: 'Destination renamed' }]
  });
  try {
    const seeded = await seedMapping(harness);
    await harness.mount();
    await harness.click('Refresh Discovery');
    await harness.click('Save Mappings');
    const current = await createDbMappingStore(harness.context, 'provider-a').getById(seeded.mapping.id);
    assert.equal(current.id, seeded.mapping.id);
    assert.equal(current.action1OrgName, 'Acme renamed');
    assert.equal(current.destinationName, 'Destination renamed');
    assert.equal((await seeded.correlations.getEndpointCorrelation(String(current.id), 'endpoint-1', 'OFFLINE')).linkedTicketId, 'ticket-provider-a');
    assert.equal((await seeded.correlations.getGroupedCorrelation(String(current.id), 'VULNERABILITY', 'CVE-1')).linkedTicketId, 'group-provider-a');
    assert.equal((await seeded.watermarks.getWatermark(String(current.id), 'AUTOMATION_FAILED')).watermarkValue, 'watermark-provider-a');
    const writes = harness.calls.filter((call) => call.actionId === 'save-ticketing-org-destination-mapping');
    assert.deepEqual(writes.map((call) => call.payload.payload.id), [seeded.mapping.id], 'source and destination label changes update the same relationship');
  } finally { await harness.close(); }
}

async function testRelationshipChangesUseRemoveCreateWithoutTrackingTransfer() {
  for (const changedSide of ['destination', 'action1']) {
    const harness = await makeHarness();
    try {
      const seeded = await seedMapping(harness);
      harness.state.destinationOptions = [{ id: 'dest-new', label: 'Replacement destination' }];
      await harness.mount();
      if (changedSide === 'destination') {
        await harness.change(harness.select('provider-a destination row 1'), 'dest-new');
      } else {
        harness.state.action1Organizations = [{ id: 'org-2', name: 'Replacement organization' }];
        await harness.change(harness.select('Action1 Organization row 1'), 'org-2');
      }
      await harness.click('Save Mappings');
      const actions = harness.calls.filter((call) => ['delete-ticketing-org-destination-mapping', 'save-ticketing-org-destination-mapping'].includes(call.actionId));
      assert.deepEqual(actions.map((call) => call.actionId), ['delete-ticketing-org-destination-mapping', 'save-ticketing-org-destination-mapping']);
      assert.equal(actions[0].payload.payload.id, seeded.mapping.id);
      assert.equal(actions[1].payload.payload.id, undefined, 'replacement insert has no old row ID');
      const currentRows = await createDbMappingStore(harness.context, 'provider-a').list();
      assert.equal(currentRows.length, 1);
      assert.notEqual(currentRows[0].id, seeded.mapping.id);
      assert.equal(await seeded.correlations.getEndpointCorrelation(String(currentRows[0].id), 'endpoint-1', 'OFFLINE'), null);
      assert.equal(await seeded.correlations.getGroupedCorrelation(String(currentRows[0].id), 'VULNERABILITY', 'CVE-1'), null);
      assert.equal(await seeded.watermarks.getWatermark(String(currentRows[0].id), 'AUTOMATION_FAILED'), null);
      assert.equal((await seeded.correlations.getEndpointCorrelation(String(seeded.mapping.id), 'endpoint-1', 'OFFLINE')).linkedTicketId, 'ticket-provider-a');
      assert.equal((await seeded.correlations.getGroupedCorrelation(String(seeded.mapping.id), 'VULNERABILITY', 'CVE-1')).linkedTicketId, 'group-provider-a');
      assert.equal((await seeded.watermarks.getWatermark(String(seeded.mapping.id), 'AUTOMATION_FAILED')).watermarkValue, 'watermark-provider-a');
    } finally { await harness.close(); }
  }
}

async function testDiscoveryFailureRetainsSavedSelectionAndStaleProviderResponseIsIgnored() {
  {
    const harness = await makeHarness({ discovery: { 'provider-a': new Error('Synthetic discovery unavailable.') } });
    try {
      const seeded = await seedMapping(harness);
      const loaded = await harness.mount();
      assert.match(loaded.html, /could not complete this operation/i, 'provider failures are shown through the bounded safe error message');
      const destination = harness.select('provider-a destination row 1');
      assert.equal(destination.props.value, 'dest-1');
      assert.match(renderToStaticMarkup(destination), /Acme Destination/);
      assert.equal(seeded.mapping.destinationName, 'Acme Destination');
    } finally { await harness.close(); }
  }

  {
    let releaseOldDiscovery;
    let discoveryCount = 0;
    const delayed = new Promise((resolve) => { releaseOldDiscovery = resolve; });
    const harness = await makeHarness({
      discovery: {
        'provider-a': async () => {
          discoveryCount += 1;
          return discoveryCount === 1 ? [{ id: 'dest-1', label: 'A initial' }] : delayed;
        },
        'provider-b': [{ id: 'b-dest', label: 'B destination' }]
      }
    });
    try {
      await harness.mount();
      const staleRefresh = harness.button('Refresh Discovery').props.onClick();
      await Promise.resolve();
      // The in-flight A discovery is intentionally held; let provider B's fresh requests settle independently.
      harness.discardOutstandingForTest();
      await harness.change(harness.select('Ticketing System'), 'provider-b');
      await harness.click('Add Mapping Row');
      assert.match(harness.view().html, /provider-b destination row 1/);
      releaseOldDiscovery([{ id: 'stale-a', label: 'Stale A destination' }]);
      await staleRefresh;
      await harness.settle();
      assert.doesNotMatch(harness.view().html, /Stale A destination/);
      assert.match(harness.view().html, /Active ticketing system: Provider A \(viewing inactive provider\)/);
    } finally {
      releaseOldDiscovery?.([]);
      await harness.close();
    }
  }
}

async function testActualBackendIdentityGuardProviderIsolationAndUnavailableProductionUi() {
  {
    const harness = await makeHarness();
    try {
      const seededA = await seedMapping(harness, 'provider-a');
      const seededB = await seedMapping(harness, 'provider-b');
      const availableHandlers = createMappingActionHandlers({
        registry: { 'provider-a': syntheticProvider('provider-a', async () => []), 'provider-b': syntheticProvider('provider-b', async () => []) },
        definitions: { 'provider-a': { providerId: 'provider-a', label: 'A', available: true, fields: [], accountSelectors: [] }, 'provider-b': { providerId: 'provider-b', label: 'B', available: true, fields: [], accountSelectors: [] } }
      });
      const attempted = await availableHandlers.saveHaloOrgClientMapping(harness.context, {
        providerId: 'provider-a',
        payload: { id: seededA.mapping.id, action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: 'changed-in-place', destinationName: 'Invalid' }
      });
      assert.equal(attempted.ok, false);
      assert.match(attempted.message, /identity cannot be changed/i);
      assert.equal((await createDbMappingStore(harness.context, 'provider-a').getById(seededA.mapping.id)).destinationId, 'dest-1');

      const providerBId = seededB.mapping.id;
      assert.equal((await availableHandlers.listHaloOrgClientMappings(harness.context, { providerId: 'provider-a' })).mappings.some((row) => row.id === providerBId), false);
      const crossUpdate = await availableHandlers.saveHaloOrgClientMapping(harness.context, { providerId: 'provider-a', payload: { id: providerBId, action1OrgId: 'org-b-new', action1OrgName: 'B', destinationId: 'dest-b-new', destinationName: 'B' } });
      assert.equal(crossUpdate.ok, false);
      const crossDelete = await availableHandlers.deleteHaloOrgClientMapping(harness.context, { providerId: 'provider-a', payload: { id: providerBId } });
      assert.equal(crossDelete.deleted, false);
      assert.equal((await createDbMappingStore(harness.context, 'provider-b').getById(providerBId)).destinationId, 'dest-1');
      assert.equal((await seededB.correlations.getEndpointCorrelation(String(providerBId), 'endpoint-1', 'OFFLINE')).linkedTicketId, 'ticket-provider-b');
    } finally { await harness.close(); }
  }

  // Remove only the test-injected A/B descriptors and render the production-equivalent unavailable state.
  delete testUiProviderRegistry['provider-a'];
  delete testUiProviderRegistry['provider-b'];
  const harness = await makeHarness({ activeProviderId: 'connectwise-psa' });
  try {
    const rendered = await harness.mount();
    const html = rendered.html;
    assert.match(html, /ConnectWise PSA is not available in this version/);
    assert.match(html, /Configure an available provider in Settings/);
    assert.match(html, /ConnectWise PSA is unavailable\. Configure an implemented provider in Settings/);
  } finally {
    await harness.close();
  }
}

try {
  await testRealMappingPageLoadProviderSelectionAndExtension();
  await testLabelOnlyRenameRefreshAndSixthMappingPreserveTracking();
  await testAction1RenameAndBothLabelChangesThroughUi();
  await testRelationshipChangesUseRemoveCreateWithoutTrackingTransfer();
  await testDiscoveryFailureRetainsSavedSelectionAndStaleProviderResponseIsIgnored();
  await testActualBackendIdentityGuardProviderIsolationAndUnavailableProductionUi();
  console.log('Action1 Ticketing rendered Mapping UI and UI/action/store boundary tests passed.');
} finally {
  await uiServer.close();
  delete globalThis.__mappingTestProviderUiRegistry;
}
