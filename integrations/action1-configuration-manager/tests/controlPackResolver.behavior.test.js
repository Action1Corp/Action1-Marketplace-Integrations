const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveControlPack } = require('../controlPackResolver');
const FIXTURE_RELEASE = 'isolated-valid-release';

function writeRelease(root, directoryName, overrides = {}) {
  const releaseRoot = path.join(root, directoryName);
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.writeFileSync(path.join(releaseRoot, 'pack.json'), JSON.stringify({
    packId: 'windows-endpoint-configuration',
    packVersion: directoryName,
    ...overrides
  }));
  return releaseRoot;
}

function withPackRoot(test) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a1cm-control-pack-'));
  try {
    return test(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function expectFailure(root, message) {
  assert.throws(() => resolveControlPack({ packRoot: root }), new RegExp(message, 'i'));
}

withPackRoot((root) => {
  const releaseRoot = writeRelease(root, FIXTURE_RELEASE);
  const resolved = resolveControlPack({ packRoot: root });
  assert.strictEqual(resolved.packId, 'windows-endpoint-configuration');
  assert.strictEqual(resolved.packVersion, FIXTURE_RELEASE);
  assert.strictEqual(resolved.releaseRoot, releaseRoot);
});

withPackRoot((root) => {
  writeRelease(root, FIXTURE_RELEASE, { packVersion: 'different-fixture-release' });
  expectFailure(root, 'directory.*packVersion');
});

withPackRoot((root) => expectFailure(root, 'exactly one'));

withPackRoot((root) => {
  writeRelease(root, FIXTURE_RELEASE);
  writeRelease(root, 'second-fixture-release');
  expectFailure(root, 'exactly one');
});

withPackRoot((root) => {
  writeRelease(root, FIXTURE_RELEASE, { packId: 'wrong-pack' });
  expectFailure(root, 'packId');
});

// Production action loading is covered by integration smoke tests. Resolver
// behavior above deliberately uses isolated temporary release roots.
