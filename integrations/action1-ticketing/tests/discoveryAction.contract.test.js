const assert = require('assert');
const { actions } = require('../actions');
const manifest = require('../manifest.json');

async function run() {
  const action = manifest.actions.find((row) => row.id === 'discover-ticketing-settings-options');
  assert(action, 'settings discovery remains manifest declared');
  assert.strictEqual(action.history, false);
  let calls = 0;
  const oldFetch = global.fetch;
  global.fetch = async () => { calls += 1; throw new Error('unavailable provider must not make network requests'); };
  try {
    const result = await actions['discover-ticketing-settings-options']({ settings: { async get() { return ''; } } }, {
      providerId: 'connectwise-psa', settings: {}
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.teams.length, 0);
    assert(result.message.includes('not implemented') || result.message.includes('could not complete'));
    assert.strictEqual(calls, 0, 'unavailable provider discovery must fail before transport');
  } finally { global.fetch = oldFetch; }
}

run().catch((error) => { console.error(error); process.exit(1); });
