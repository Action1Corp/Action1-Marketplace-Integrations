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
  const childScopes = new Map();
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
      if (!effects[slot]) effects[slot] = { effect, dependencies, started: false, cleanup: null };
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
          entry.cleanup = invoke(() => entry.effect()) || null;
        }
      }
    },
    unmount() {
      for (const entry of effects.slice().reverse()) {
        if (entry?.cleanup) invoke(entry.cleanup);
      }
    },
    invoke,
    invokeComponent(key, fn) {
      if (!childScopes.has(key)) {
        const child = { slots: [], initialized: [], cursor: 0 };
        childScopes.set(key, child);
      }
      const child = childScopes.get(key);
      child.cursor = 0;
      const previous = reactInternals.ReactCurrentDispatcher.current;
      reactInternals.ReactCurrentDispatcher.current = {
        useState(initial) {
          const slot = child.cursor++;
          if (!child.initialized[slot]) { child.slots[slot] = typeof initial === 'function' ? initial() : initial; child.initialized[slot] = true; }
          return [child.slots[slot], (next) => { child.slots[slot] = typeof next === 'function' ? next(child.slots[slot]) : next; }];
        },
        useRef(initial) {
          const slot = child.cursor++;
          if (!child.initialized[slot]) { child.slots[slot] = { current: initial }; child.initialized[slot] = true; }
          return child.slots[slot];
        },
        useEffect() { child.cursor += 1; }
      };
      try { return fn(); } finally { reactInternals.ReactCurrentDispatcher.current = previous; }
    }
  };
}

function expandComponents(renderer, element, path = 'root') {
  if (Array.isArray(element)) return element.map((child, index) => expandComponents(renderer, child, `${path}.${index}`));
  if (!React.isValidElement(element)) return element;
  if (typeof element.type === 'function') {
    const key = `${path}:${element.key || element.type.name || 'component'}`;
    return expandComponents(renderer, renderer.invokeComponent(key, () => element.type(element.props)), key);
  }
  const children = element.props?.children;
  if (Array.isArray(children)) return React.cloneElement(element, {}, ...children.map((child, index) => expandComponents(renderer, child, `${path}.${index}`)));
  if (React.isValidElement(children)) return React.cloneElement(element, {}, expandComponents(renderer, children, `${path}.0`));
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
    const [open, setOpen] = React.useState(false);
    const selected = props.selectedOption;
    return React.createElement('div', { 'data-provider-destination': providerId },
      React.createElement('button', { type: 'button', 'aria-label': providerId + ' destination row ' + (props.rowIndex + 1), disabled: props.disabled, onClick: () => setOpen(!open) }, selected?.name || selected?.label || 'Select customer'),
      open ? React.createElement('div', null,
        React.createElement('input', { type: 'search', 'aria-label': providerId + ' customer search', placeholder: 'Search customers...', value: props.searchQuery, onChange: (event) => props.onSearch(event.target.value) }),
        props.destinationLoading ? React.createElement('div', { role: 'status' }, 'Loading customers...') : null,
        props.error ? React.createElement('div', { role: 'alert' }, props.error, React.createElement('button', { type: 'button', onClick: props.onRefresh }, 'Refresh customers')) : null,
        props.options.map((option) => React.createElement('button', { type: 'button', key: option.id, role: 'option', onClick: () => { props.onChange(option.id, option.name || option.label); setOpen(false); } }, option.name || option.label)),
        props.hasMore ? React.createElement('button', { type: 'button', onClick: props.onLoadMore, disabled: props.destinationLoading }, 'Load More') : null,
        !props.destinationLoading && !props.options.length ? React.createElement('div', { role: 'status' }, 'No customers found.') : null,
        !props.hasMore && props.complete ? React.createElement('div', { role: 'status' }, 'End of customer list.') : null,
        !props.hasMore && !props.complete && !props.destinationLoading ? React.createElement('div', { role: 'status' }, 'The provider could not confirm the full customer directory.') : null,
        props.searchSupported === false && props.searchQuery ? React.createElement('div', { role: 'status' }, 'Full-directory search is unavailable.') : null
      ) : null
    );
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
      discover: async ({ input }) => {
        const result = await discover(input);
        if (Array.isArray(result)) return { options: result, hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true };
        return result;
      },
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
  context.settings = { async get(key) { return key === 'TicketingActiveProvider' ? state.activeProviderId : (state.settings[key] || ''); }, async all() { return { ...state.settings, TicketingActiveProvider: state.activeProviderId }; } };
  const registry = Object.fromEntries(['provider-a', 'provider-b'].map((providerId) => [providerId, syntheticProvider(providerId, async (input) => {
    const value = state.discovery[providerId];
    if (typeof value === 'function') return value(input);
    if (value instanceof Error) throw value;
    return value || state.destinationOptions;
  })]));
  const definitions = Object.fromEntries(Object.keys(registry).map((providerId) => [providerId, {
    providerId, label: providerId, available: true, fields: [], accountSelectors: []
  }]));
  const handlers = createMappingActionHandlers({ registry, definitions, dispatcher: createProviderDispatcher(registry), loadAction1Organizations: async () => state.action1Organizations });
  const actionHandlers = {
    'list-ticketing-org-destination-mappings': handlers.listHaloOrgClientMappings,
    'save-ticketing-org-destination-mapping': handlers.saveHaloOrgClientMapping,
    'delete-ticketing-org-destination-mapping': handlers.deleteHaloOrgClientMapping,
    'discover-ticketing-mapping-options': handlers.discoverHaloMappingOptions,
    'preview-ticketing-mapping-auto-match': handlers.previewAutoMatch,
    'apply-ticketing-mapping-auto-match': handlers.applyAutoMatch
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
  async function remount() {
    hookRenderer?.unmount();
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

  return { calls, context, tables, state, testFieldProps, mount, remount, view, button, select, click, change, settle, close, discardOutstandingForTest() { outstanding.length = 0; } };
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

async function testMappingUsesOnlyTheActiveProviderAndRestoresAcrossActivation() {
  const harness = await makeHarness({ activeProviderId: 'provider-a' });
  try {
    const mappingA = await seedMapping(harness, 'provider-a');
    const mappingB = await seedMapping(harness, 'provider-b', { action1OrgId: 'org-b', action1OrgName: 'Beta', destinationId: 'dest-b', destinationName: 'Beta Destination' });
    const initial = await harness.mount();
    assert.match(initial.html, /Organization Mapping/);
    assert.match(initial.html, /Active ticketing system: Provider A/);
    assert.doesNotMatch(initial.html, /Ticketing System/);
    assert.equal(initial.elements.some((element) => element.type === 'select' && /Provider A|Provider B/.test(textOf(element.props.children))), false, 'Mapping renders no provider selector');
    assert.match(initial.html, /provider-a destination row 1/);
    assert.match(initial.html, /Acme/);
    assert.doesNotMatch(initial.html, /Beta Destination/);
    assert.equal(harness.testFieldProps.at(-1).providerId, 'provider-a');
    const activeDestination = harness.testFieldProps.find((props) => props.providerId === 'provider-a' && props.row.action1OrgId === 'org-1');
    assert.equal(activeDestination.row.action1OrgId, 'org-1');
    assert.equal(activeDestination.options[0].id, 'dest-1');
    assert.equal(typeof activeDestination.onChange, 'function');

    activeDestination.onChange('dest-new', 'New destination');
    harness.state.activeProviderId = 'provider-b';
    const staleWrite = await harness.click('Save Changes');
    assert.match(staleWrite.html, /active ticketing system changed/i, 'stale A page receives a safe ownership rejection after B is activated');
    assert.equal((await createDbMappingStore(harness.context, 'provider-a').getById(mappingA.mapping.id)).destinationId, 'dest-1', 'stale page cannot change the old provider mapping');
    assert.equal((await createDbMappingStore(harness.context, 'provider-b').getById(mappingB.mapping.id)).destinationName, 'Beta Destination', 'stale page cannot change the new provider mapping');

    const switched = await harness.remount();
    assert.match(switched.html, /Active ticketing system: Provider B/);
    assert.match(switched.html, /provider-b destination row 1/);
    assert.match(switched.html, /Beta Destination/);
    assert.doesNotMatch(switched.html, /provider-a destination row 1/);
    assert.equal(harness.testFieldProps.at(-1).providerId, 'provider-b');
    assert(harness.calls.some((call) => call.actionId === 'list-ticketing-org-destination-mappings' && call.payload.providerId === 'provider-b'));

    harness.state.activeProviderId = 'provider-a';
    const returned = await harness.remount();
    assert.match(returned.html, /Active ticketing system: Provider A/);
    assert.match(returned.html, /provider-a destination row 1/);
    assert.doesNotMatch(returned.html, /Beta Destination/);
    assert.equal((await createDbMappingStore(harness.context, 'provider-a').getById(mappingA.mapping.id)).destinationName, 'Acme Destination');
    assert.equal((await createDbMappingStore(harness.context, 'provider-b').getById(mappingB.mapping.id)).destinationName, 'Beta Destination');
    assert.equal((await mappingA.correlations.getEndpointCorrelation(String(mappingA.mapping.id), 'endpoint-1', 'OFFLINE')).linkedTicketId, 'ticket-provider-a');
    assert.equal((await mappingB.correlations.getEndpointCorrelation(String(mappingB.mapping.id), 'endpoint-1', 'OFFLINE')).linkedTicketId, 'ticket-provider-b');
    assert.equal((await mappingA.correlations.getGroupedCorrelation(String(mappingA.mapping.id), 'VULNERABILITY', 'CVE-1')).linkedTicketId, 'group-provider-a');
    assert.equal((await mappingB.correlations.getGroupedCorrelation(String(mappingB.mapping.id), 'VULNERABILITY', 'CVE-1')).linkedTicketId, 'group-provider-b');
    assert.equal((await mappingA.watermarks.getWatermark(String(mappingA.mapping.id), 'AUTOMATION_FAILED')).watermarkValue, 'watermark-provider-a');
    assert.equal((await mappingB.watermarks.getWatermark(String(mappingB.mapping.id), 'AUTOMATION_FAILED')).watermarkValue, 'watermark-provider-b');
  } finally { await harness.close(); }
}

async function testM1OrganizationRowsPaginationAndDraftProjection() {
  const organizations = Array.from({ length: 501 }, (_, index) => ({ id: `org-${index + 1}`, name: `Organization ${index + 1}` }));
  const harness = await makeHarness({ action1Organizations: organizations });
  try {
    const seeded = await seedMapping(harness);
    const initial = await harness.mount();
    assert.match(initial.html, /Search organizations/);
    assert.match(initial.html, /Showing 1–25 of 501/);
    assert.equal(initial.elements.filter((element) => element.type === 'tr').length, 26, 'renders only 25 body rows plus one header row');
    assert(initial.elements.some((element) => element.type === 'button' && textOf(element).trim() === 'Auto Match' && !element.props.disabled), 'Auto Match is available after M3');

    const destinationSearch = initial.elements.find((element) => element.type === 'input' && element.props.type === 'search');
    await harness.change(destinationSearch, '  acme   destination ');
    assert.match(harness.view().html, /Organization 1/);
    assert.match(harness.view().html, /Showing 1–1 of 1/, 'search also matches the selected destination label');
    const clearDestinationSearch = harness.view().elements.find((element) => element.type === 'input' && element.props.type === 'search');
    await harness.change(clearDestinationSearch, '');

    await harness.click('Next');
    assert.match(harness.view().html, /Showing 26–50 of 501/);
    await harness.click('Next');
    assert.match(harness.view().html, /Showing 51–75 of 501/);
    const lastPage = await (async () => {
      let rendered;
      for (let index = 3; index < 21; index += 1) rendered = await harness.click('Next');
      return rendered || harness.view();
    })();
    assert.match(lastPage.html, /Showing 501–501 of 501/);
    assert.match(lastPage.html, /Organization 501/);

    const sourceSearch = lastPage.elements.find((element) => element.type === 'input' && element.props.type === 'search');
    assert(sourceSearch, 'organization search is a rendered control');
    await harness.change(sourceSearch, '  organization   501 ');
    const searched = harness.view();
    assert.match(searched.html, /Showing 1–1 of 1/);
    assert.match(searched.html, /Organization 501/);

    const filter = searched.elements.find((element) => element.type === 'select' && element.props['aria-label'] === 'Mapping filter');
    assert(filter, 'All/Mapped/Unmapped filter is visible');
    await harness.change(filter, 'Unmapped');
    assert.match(harness.view().html, /Organization 501/);
    assert.doesNotMatch(harness.view().html, /Acme Destination/);

    const destinationProps = harness.testFieldProps.find((props) => props.row.action1OrgId === 'org-501');
    assert(destinationProps, 'an unmapped organization row has a direct destination selector');
    destinationProps.onChange('dest-new', 'Organization 501 Destination');
    assert.doesNotMatch(harness.view().html, /Organization 501/, 'a completed draft moves from Unmapped to Mapped without losing its state');
    await harness.change(harness.select('Mapping filter'), 'Mapped');
    assert(harness.view().html.includes('New Destination'), 'direct unmapped selection uses its discovered label in the draft projection');
    assert.equal(harness.calls.filter((call) => call.actionId === 'save-ticketing-org-destination-mapping').length, 0, 'draft selection does not auto-save');

    await harness.click('+ Add Mapping');
    assert(harness.view().html.includes('Add Mapping'), 'blank-row action remains available in the toolbar');
    assert.match(harness.view().html, /Incomplete draft row/, 'new blank draft rows remain visible and identifiable before selection');
    assert(harness.view().elements.some((element) => element.type === 'input' && element.props.role === 'combobox' && /^Action1 Organization row/.test(element.props['aria-label'] || '')), 'blank row exposes a searchable Action1 selector');
    assert(harness.view().elements.some((element) => element.type === 'button' && /destination row/i.test(element.props['aria-label'] || '')), 'blank row exposes a destination selector');

    const blankSource = harness.view().elements.find((element) => element.type === 'input' && element.props.role === 'combobox' && /^Action1 Organization row/.test(element.props['aria-label'] || ''));
    await harness.change(blankSource, 'Organization 2');
    const organizationOption = harness.view().elements.find((element) => element.props.role === 'option' && textOf(element).trim() === 'Organization 2');
    await organizationOption.props.onClick();
    const updatedSearch = harness.view().elements.find((element) => element.type === 'input' && element.props.type === 'search');
    await harness.change(updatedSearch, 'Organization 2');
    assert.match(harness.view().html, /Incomplete mapping/, 'a partially completed organization row remains visible with its validation state');
    const organizationTwoDestination = harness.testFieldProps.filter((props) => props.row.action1OrgId === 'org-2').at(-1);
    organizationTwoDestination.onChange('dest-6', 'Sixth Destination');
    const resetSearch = harness.view().elements.find((element) => element.type === 'input' && element.props.type === 'search');
    await harness.change(resetSearch, '');

    const firstSavedRowRemove = harness.view().elements.find((element) => element.type === 'button' && element.props['data-map-remove'] !== undefined);
    await firstSavedRowRemove.props.onClick();
    await harness.settle();
    const unmappedFilter = harness.view().elements.find((element) => element.type === 'select' && element.props['aria-label'] === 'Mapping filter');
    await harness.change(unmappedFilter, 'Unmapped');
    const searchForRemovedOrganization = harness.view().elements.find((element) => element.type === 'input' && element.props.type === 'search');
    await harness.change(searchForRemovedOrganization, 'Organization 1');
    assert.match(harness.view().html, /Organization 1/);
    assert.match(harness.view().html, /Select customer/);

    const save = harness.button('Save Changes');
    await save.props.onClick();
    await harness.settle();
    assert.equal((await createDbMappingStore(harness.context, 'provider-a').getByAction1OrgId('org-501')).destinationId, 'dest-new', 'Save persists a directly selected unmapped organization using ordinary mapping storage');
    assert.equal((await createDbMappingStore(harness.context, 'provider-a').getByAction1OrgId('org-2')).destinationId, 'dest-6', 'Save includes an addition created through the blank row even after search/navigation');
    assert.equal(await createDbMappingStore(harness.context, 'provider-a').getById(seeded.mapping.id), null, 'Save includes the off-page saved mapping deletion');
  } finally { await harness.close(); }
}

async function testM2SearchableAction1SelectorAndDestinationPagination() {
  const allDestinations = Array.from({ length: 1105 }, (_, index) => ({ id: `customer-${index + 1}`, label: `Customer ${index + 1}` }));
  const harness = await makeHarness({
    action1Organizations: [{ id: 'org-a', name: 'Acme Corporation' }, { id: 'org-b', name: 'Contoso' }, { id: 'org-c', name: 'Other' }],
    destinationOptions: allDestinations,
    discovery: {
      'provider-a': (input) => {
        const query = input.query || '';
        const matches = allDestinations.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
        const offset = input.continuationToken ? Number(input.continuationToken.replace('offset:', '')) : 0;
        const options = matches.slice(offset, offset + input.pageSize);
        const nextOffset = offset + options.length;
        const hasMore = nextOffset < matches.length;
        return { options, hasMore, nextPageToken: hasMore ? `offset:${nextOffset}` : null, complete: !hasMore, searchSupported: true, paginationSupported: true };
      }
    }
  });
  try {
    const initial = await harness.mount();
    assert.equal(harness.calls.find((call) => call.actionId === 'discover-ticketing-mapping-options').payload.pageSize, 50, 'the UI requests a bounded initial page of 50');
    assert.equal(harness.testFieldProps.at(-1).options.filter((option) => option.id.startsWith('customer-')).length, 50);

    await harness.click('+ Add Mapping');
    let source = harness.view().elements.filter((element) => element.type === 'input' && element.props.role === 'combobox').at(-1);
    await harness.change(source, '  acme   corp ');
    let filteredOptions = harness.view().elements.filter((element) => element.props.role === 'option' && textOf(element).trim());
    assert.deepEqual(filteredOptions.map((element) => textOf(element).trim()), ['Acme Corporation'], 'the Action1 selector searches locally and tolerates case and repeated whitespace');
    source = harness.view().elements.filter((element) => element.type === 'input' && element.props.role === 'combobox').at(-1);
    await source.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
    source = harness.view().elements.filter((element) => element.type === 'input' && element.props.role === 'combobox').at(-1);
    await source.props.onKeyDown({ key: 'Enter', preventDefault() {} });
    assert.match(harness.view().html, /Acme Corporation/, 'keyboard selection retains the selected source label in the draft row');
    await harness.click('+ Add Mapping');
    source = harness.view().elements.filter((element) => element.type === 'input' && element.props.role === 'combobox').at(-1);
    await harness.change(source, 'Acme');
    assert.equal(harness.view().elements.filter((element) => element.props.role === 'option' && textOf(element).trim() === 'Acme Corporation').length, 0, 'an Action1 organization already selected in another draft row is unavailable');

    const trigger = harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 1');
    await trigger.props.onClick();
    let customerSearch = harness.view().elements.find((element) => element.type === 'input' && element.props['aria-label'] === 'provider-a customer search');
    await harness.change(customerSearch, 'Customer 1001');
    let result = harness.view();
    assert(result.elements.some((element) => element.props.role === 'option' && textOf(element).trim() === 'Customer 1001'), 'server-side search reaches a customer beyond the initial 50 and first 500');
    assert.equal(harness.calls.filter((call) => call.actionId === 'discover-ticketing-mapping-options').at(-1).payload.query, 'Customer 1001');
    await result.elements.find((element) => element.props.role === 'option' && textOf(element).trim() === 'Customer 1001').props.onClick();
    assert.match(harness.view().html, /Customer 1001/, 'the chosen customer is shown as the draft value');

    await harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 1').props.onClick();
    customerSearch = harness.view().elements.find((element) => element.type === 'input' && element.props['aria-label'] === 'provider-a customer search');
    await harness.change(customerSearch, '');
    harness.view();
    assert.equal(harness.testFieldProps.find((props) => props.row.destinationId === 'customer-1001')?.selectedOption?.id, 'customer-1001', 'the selected customer remains available when it is outside the active result page');
    for (let page = 0; page < 11; page += 1) {
      const loadMore = harness.view().elements.find((element) => element.type === 'button' && textOf(element).trim() === 'Load More');
      assert(loadMore, `Load More is available for page ${page + 1}`);
      await loadMore.props.onClick();
      await harness.settle();
    }
    harness.view();
    const latestFieldProps = harness.testFieldProps.at(-1);
    const loadedIds = latestFieldProps.options.map((option) => option.id);
    assert(loadedIds.includes('customer-600'), 'Load More traverses beyond the first 500 destination records');
    assert.equal(new Set(loadedIds).size, loadedIds.length, 'loaded destination options remain deduplicated by stable ID');
    assert(loadedFieldComplete(harness), 'the final explicit page state remains available to the selector');
    assert(harness.calls.filter((call) => call.actionId === 'discover-ticketing-mapping-options').every((call) => call.payload.pageSize === 50), 'every UI discovery request stays bounded');
    assert.equal(harness.calls.some((call) => call.actionId === 'save-ticketing-org-destination-mapping'), false, 'search and page loading remain read-only');

    const emptySearch = harness.testFieldProps.at(-1).onSearch;
    await emptySearch('not in directory');
    const emptyView = harness.view();
    assert.match(emptyView.html, /No customers found/);
    assert.doesNotMatch(emptyView.html, /Load More/);
  } finally { await harness.close(); }
}

function loadedFieldComplete(harness) {
  return harness.testFieldProps.at(-1)?.complete === false || harness.testFieldProps.at(-1)?.hasMore === true;
}

async function testM2OutOfOrderDestinationSearchIsIgnored() {
  let resolveAcme;
  let resolveContoso;
  const acmePage = new Promise((resolve) => { resolveAcme = resolve; });
  const contosoPage = new Promise((resolve) => { resolveContoso = resolve; });
  const harness = await makeHarness({ discovery: {
    'provider-a': (input) => input.query === 'Acme' ? acmePage : input.query === 'Contoso' ? contosoPage : [{ id: 'initial', label: 'Initial Customer' }]
  } });
  try {
    await harness.mount();
    await harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 1').props.onClick();
    const props = harness.testFieldProps.find((item) => item.row.action1OrgId === 'org-1');
    const acmeRequest = props.onSearch('Acme');
    const contosoRequest = props.onSearch('Contoso');
    await Promise.resolve();
    assert.match(harness.view().html, /Loading customers/, 'destination searching displays an in-progress state');
    resolveContoso({ options: [{ id: 'contoso', label: 'Contoso Customer' }], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true });
    await contosoRequest;
    harness.view();
    resolveAcme({ options: [{ id: 'acme', label: 'Acme Customer' }], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true });
    await acmeRequest;
    await harness.settle();
    const current = harness.view();
    assert.match(current.html, /Contoso Customer/);
    assert.doesNotMatch(current.html, /Acme Customer/, 'an older search response cannot replace the current query results');
    assert.equal(harness.testFieldProps.filter((item) => item.row.action1OrgId === 'org-1').at(-1).searchQuery, 'Contoso');
  } finally {
    resolveAcme?.({ options: [], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true });
    resolveContoso?.({ options: [], hasMore: false, nextPageToken: null, complete: true, searchSupported: true, paginationSupported: true });
    await harness.close();
  }
}

async function testM2UnsupportedDirectoryCapabilitiesStayExplicit() {
  const harness = await makeHarness({ discovery: {
    'provider-a': (input) => ({ options: [{ id: 'limited-1', label: `Limited ${input.query || 'Customer'}` }], hasMore: false, nextPageToken: null, complete: false, searchSupported: false, paginationSupported: false })
  } });
  try {
    await harness.mount();
    const destinationTrigger = harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 1');
    await destinationTrigger.props.onClick();
    const search = harness.view().elements.find((element) => element.type === 'input' && element.props['aria-label'] === 'provider-a customer search');
    await harness.change(search, 'Query Across Directory');
    const view = harness.view();
    assert.match(view.html, /Full-directory search is unavailable/);
    assert.match(view.html, /could not confirm the full customer directory/);
    assert.doesNotMatch(view.html, /Load More/);
    assert.equal(harness.calls.filter((call) => call.actionId === 'discover-ticketing-mapping-options').at(-1).payload.query, 'Query Across Directory', 'the query is sent to the provider rather than filtered against loaded browser options');
    assert.equal(harness.calls.some((call) => call.actionId === 'save-ticketing-org-destination-mapping'), false);
  } finally { await harness.close(); }
}

async function testM3PreviewSelectionCancelAndApplyPreserveOtherDrafts() {
  const harness = await makeHarness({
    action1Organizations: [{ id: 'org-acme', name: 'Acme' }, { id: 'org-contoso', name: 'Contoso' }, { id: 'org-blank', name: 'Unmatched' }],
    destinationOptions: [{ id: 'dest-acme', label: ' acme ' }, { id: 'dest-contoso', label: 'Contoso' }]
  });
  try {
    await harness.mount();
    await harness.click('+ Add Mapping');
    const unrelatedDraft = harness.view().elements.filter((element) => element.type === 'input' && element.props.role === 'combobox').at(-1);
    await harness.change(unrelatedDraft, 'No organization selected');
    await harness.click('Auto Match');
    let view = harness.view();
    assert.match(view.html, /Auto Match Organizations/);
    assert.match(view.html, /3 unmapped Action1 organizations analyzed/);
    assert.match(view.html, /Exact Matches:[\s\S]*2/);
    assert.match(view.html, /Unmatched:[\s\S]*1/);
    assert.match(view.html, /Ambiguous:[\s\S]*0/);
    assert.match(view.html, /aria-modal="true"/);
    const exactTab = view.elements.find((element) => element.type === 'button' && textOf(element).includes('Exact Matches'));
    await exactTab.props.onClick();
    const checks = harness.view().elements.filter((element) => element.type === 'input' && element.props.type === 'checkbox' && element.props['data-auto-match-source']);
    assert.equal(checks.length, 2);
    assert(checks.every((element) => element.props.checked), 'eligible exact matches are selected by default');
    await checks[0].props.onChange({ target: { checked: false } });
    view = harness.view();
    assert.match(view.html, /Apply Matches \(1\)/, 'the action count follows individual deselection');
    await harness.button('Cancel').props.onClick();
    await harness.settle();
    assert.doesNotMatch(harness.view().html, /Auto Match Organizations/);
    assert.equal(harness.calls.some((call) => call.actionId === 'save-ticketing-org-destination-mapping'), false, 'Cancel makes no Mapping writes');
    assert.equal(harness.tables.get('action1_ticketing_org_client_mappings')?.length || 0, 0);

    await harness.click('Auto Match');
    view = harness.view();
    const exactChecks = view.elements.filter((element) => element.type === 'input' && element.props.type === 'checkbox' && element.props['data-auto-match-source']);
    const applyButton = harness.view().elements.find((element) => element.type === 'button' && textOf(element).trim() === 'Apply Matches (2)');
    assert(applyButton, 'reopening Preview performs a fresh read-only assessment and selects exact matches');
    await exactChecks[1].props.onChange({ target: { checked: false } });
    await harness.button('Apply Matches (1)').props.onClick();
    await harness.settle();
    view = harness.view();
    assert.match(view.html, /Applied 1 match/);
    assert.doesNotMatch(view.html, /Auto Match Organizations/);
    const saved = await createDbMappingStore(harness.context, 'provider-a').list();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].action1OrgId, 'org-acme');
    assert.match(view.html, /Incomplete draft row/, 'unrelated Add Mapping draft work survives authoritative reload after Apply');
    assert.equal(harness.calls.some((call) => call.actionId === 'save-ticketing-org-destination-mapping'), false, 'Apply uses its dedicated server action and never calls manual CRUD saves');
  } finally { await harness.close(); }
}

async function testM3IncompletePreviewAndProviderDriftDisableWrites() {
  const harness = await makeHarness({
    action1Organizations: [{ id: 'org-one', name: 'One' }],
    destinationOptions: [{ id: 'dest-one', label: 'One' }],
    discovery: { 'provider-a': () => ({ options: [{ id: 'dest-one', label: 'One' }], hasMore: false, nextPageToken: null, complete: false, searchSupported: true, paginationSupported: false }) }
  });
  try {
    await harness.mount();
    await harness.click('Auto Match');
    let view = harness.view();
    assert.match(view.html, /incomplete/i);
    const apply = view.elements.find((element) => element.type === 'button' && /Apply Matches/.test(textOf(element)));
    assert(apply.props.disabled, 'incomplete discovery disables Apply');
    await harness.button('Cancel').props.onClick();
    await harness.settle();

    harness.state.discovery = {};
    await harness.click('Auto Match');
    view = harness.view();
    harness.state.activeProviderId = 'provider-b';
    await harness.button('Apply Matches (1)').props.onClick();
    await harness.settle();
    assert.match(harness.view().html, /active ticketing system changed/i);
    assert.equal(harness.tables.get('action1_ticketing_org_client_mappings')?.length || 0, 0, 'provider drift between Preview and Apply writes no mappings');
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
    await harness.click('+ Add Mapping');
    const sourceSelector = harness.view().elements.find((element) => element.type === 'input' && element.props.role === 'combobox' && element.props['aria-label'] === 'Action1 Organization row 7');
    await harness.change(sourceSelector, 'Organization 6');
    await harness.view().elements.find((element) => element.props.role === 'option' && textOf(element).trim() === 'Organization 6').props.onClick();
    await harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 6').props.onClick();
    await harness.view().elements.find((element) => element.props.role === 'option' && textOf(element).trim() === 'Destination 6').props.onClick();
    await harness.click('Save Changes');

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
    await harness.click('Save Changes');
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
        await harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 1').props.onClick();
        await harness.view().elements.find((element) => element.props.role === 'option' && textOf(element).trim() === 'Replacement destination').props.onClick();
      } else {
        const remove = harness.view().elements.find((element) => element.type === 'button' && element.props['data-map-remove'] !== undefined);
        await remove.props.onClick();
        await harness.settle();
        await harness.click('+ Add Mapping');
        const blankSource = harness.view().elements.find((element) => element.type === 'input' && element.props.role === 'combobox' && /^Action1 Organization row/.test(element.props['aria-label'] || ''));
        await harness.change(blankSource, 'Beta');
        await harness.view().elements.find((element) => element.props.role === 'option' && textOf(element).trim() === 'Beta').props.onClick();
        const replacementDestination = harness.testFieldProps.find((props) => props.row.action1OrgId === 'org-2');
        replacementDestination.onChange('dest-new', 'Replacement destination');
      }
      await harness.click('Save Changes');
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
      const destination = harness.view().elements.find((element) => element.type === 'button' && element.props['aria-label'] === 'provider-a destination row 1');
      assert.match(renderToStaticMarkup(destination), /Acme Destination/);
      await destination.props.onClick();
      assert(harness.view().elements.some((element) => element.type === 'div' && element.props.role === 'alert'), 'the destination panel exposes a clear failure state while retaining the selected value');
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
      harness.state.activeProviderId = 'provider-b';
      await harness.remount();
      await harness.click('+ Add Mapping');
      assert.match(harness.view().html, /provider-b destination row 1/);
      releaseOldDiscovery([{ id: 'stale-a', label: 'Stale A destination' }]);
      await staleRefresh;
      await harness.settle();
      assert.doesNotMatch(harness.view().html, /Stale A destination/);
      assert.match(harness.view().html, /Active ticketing system: Provider B/);
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

async function testRenderedSyncAndHistoryProviderAttribution() {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  const historyRows = [
    {
      id: 501,
      timestamp: '2026-11-19T10:00:00.000Z',
      status: 'completed',
      action_id: 'sync',
      action_label: 'Sync',
      details: JSON.stringify({ providerId: 'provider-a', providerLabel: 'Provider A', summary: { created: 2, updated: 1, skipped: 3, failed: 0 } }),
      assets_processed: 7
    },
    { id: 500, timestamp: '2026-11-18T10:00:00.000Z', status: 'failed', action_id: 'sync', details: 'created: 0\nupdated: 0\nskipped: 0\nfailed: 1' }
  ];
  globalThis.fetch = (url, options = {}) => {
    const request = { url: String(url), options };
    fetchCalls.push(request);
    let payload;
    if (request.url.startsWith('/api/marketplace/')) payload = { operations: { sync: true } };
    else if (request.url === '/api/settings' && request.options.method === 'POST') payload = { ok: true };
    else if (request.url === '/api/settings') payload = { settings: { TicketingActiveProvider: 'connectwise-psa', 'CronSchedule_action1-ticketing': '', 'CronTimezone_action1-ticketing': 'UTC' } };
    else if (request.url.startsWith('/api/history?')) payload = { rows: historyRows };
    else if (request.url.endsWith('/actions/sync')) payload = { message: 'ConnectWise PSA is not available in this version.' };
    else throw new Error(`Unexpected Sync/History request ${request.url}`);
    return Promise.resolve(makeResponse(payload));
  };

  try {
    const syncRenderer = createHookHarness(uiModule.views.dashboard);
    const initialSyncTree = syncRenderer.render({ integration: 'action1-ticketing' });
    assert.match(renderToStaticMarkup(expandComponents(syncRenderer, initialSyncTree)), /Loading sync/);
    await syncRenderer.startEffects();
    await new Promise((resolve) => setImmediate(resolve));
    const syncTree = syncRenderer.render({ integration: 'action1-ticketing' });
    let syncHtml = renderToStaticMarkup(expandComponents(syncRenderer, syncTree));
    assert.match(syncHtml, /Active ticketing system:[\s\S]*ConnectWise PSA/);
    assert.match(syncHtml, /<span>Provider A<\/span>/, 'rendered Sync page should preserve the recorded latest-run provider separately from active settings');
    assert.match(syncHtml, /Scheduled runs use the ticketing system active when the run starts\./);
    assert.match(syncHtml, /Created[\s\S]*2/);
    const interval = flatten(syncTree).find((element) => element.type === 'select' && element.props.id === 'action1-ticketing-sync-interval');
    const enabledSchedule = flatten(syncTree).find((element) => element.type === 'input' && element.props.type === 'checkbox');
    assert.equal(interval.props.value, '24', 'first-use Sync UI retains the disabled schedule 24-hour default');
    assert.equal(enabledSchedule.props.checked, false, 'first-use schedule remains disabled');
    syncRenderer.invoke(() => interval.props.onChange({ target: { value: '6' } }));
    syncRenderer.invoke(() => enabledSchedule.props.onChange({ target: { checked: true } }));
    const editedSyncTree = syncRenderer.render({ integration: 'action1-ticketing' });
    const saveSchedule = flatten(editedSyncTree).find((element) => element.type === 'button' && textOf(element).trim() === 'Save scheduler settings');
    await syncRenderer.invoke(() => saveSchedule.props.onClick());
    const scheduleSave = fetchCalls.find((call) => call.url === '/api/settings' && call.options.method === 'POST');
    const scheduleBody = JSON.parse(scheduleSave.options.body);
    assert.equal(scheduleBody['CronSchedule_action1-ticketing'], '0 */6 * * *', 'rendered scheduler saves the selected Marketplace recurrence');
    assert.equal(scheduleBody['CronTimezone_action1-ticketing'], 'UTC', 'rendered scheduler preserves the saved timezone');
    const runButton = flatten(syncTree).find((element) => element.type === 'button' && textOf(element).trim() === 'Run now');
    assert(runButton, 'rendered Sync page exposes the Run now action');
    await syncRenderer.invoke(() => runButton.props.onClick());
    syncHtml = renderToStaticMarkup(expandComponents(syncRenderer, syncRenderer.render({ integration: 'action1-ticketing' })));
    assert(fetchCalls.some((call) => call.url.endsWith('/actions/sync') && call.options.method === 'POST'), 'Run now dispatches through the declared sync action boundary');
    assert.match(syncHtml, /ConnectWise PSA is not available in this version/);

    const historyRenderer = createHookHarness(uiModule.views.history);
    const initialHistoryTree = historyRenderer.render({ integration: 'action1-ticketing' });
    assert.match(renderToStaticMarkup(expandComponents(historyRenderer, initialHistoryTree)), /Loading history/);
    await historyRenderer.startEffects();
    await new Promise((resolve) => setImmediate(resolve));
    const historyHtml = renderToStaticMarkup(expandComponents(historyRenderer, historyRenderer.render({ integration: 'action1-ticketing' })));
    assert.match(historyHtml, /Provider A/);
    assert.match(historyHtml, /Provider not recorded/);
    assert.equal((historyHtml.match(/<th(?=[\s>])/g) || []).length, 6, 'rendered History retains the six approved columns');
    assert.match(historyHtml, /Refresh/);
    assert.match(historyHtml, /2[\s\S]*1[\s\S]*3[\s\S]*0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

try {
  await testM1OrganizationRowsPaginationAndDraftProjection();
  await testM2SearchableAction1SelectorAndDestinationPagination();
  await testM2OutOfOrderDestinationSearchIsIgnored();
  await testM2UnsupportedDirectoryCapabilitiesStayExplicit();
  await testM3PreviewSelectionCancelAndApplyPreserveOtherDrafts();
  await testM3IncompletePreviewAndProviderDriftDisableWrites();
  await testMappingUsesOnlyTheActiveProviderAndRestoresAcrossActivation();
  await testLabelOnlyRenameRefreshAndSixthMappingPreserveTracking();
  await testAction1RenameAndBothLabelChangesThroughUi();
  await testRelationshipChangesUseRemoveCreateWithoutTrackingTransfer();
  await testDiscoveryFailureRetainsSavedSelectionAndStaleProviderResponseIsIgnored();
  await testActualBackendIdentityGuardProviderIsolationAndUnavailableProductionUi();
  await testRenderedSyncAndHistoryProviderAttribution();
  console.log('Action1 Ticketing rendered Mapping UI and UI/action/store boundary tests passed.');
} finally {
  await uiServer.close();
  delete globalThis.__mappingTestProviderUiRegistry;
}
