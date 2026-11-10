const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createMarketplaceRunLogger, resolveDiagnosticLogDir } = require('../runtimeLogging');

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-logs-'));
  assert.strictEqual(resolveDiagnosticLogDir({ env: { DATA_DIR: root } }), path.join(root, 'halo-psa-logs'));
  assert.strictEqual(resolveDiagnosticLogDir({ env: { DATA_DIR: root }, logDir: path.join(root, 'override') }), path.join(root, 'override'));
  assert.strictEqual(resolveDiagnosticLogDir({ env: {}, packageDir: root }), root);

  const target = path.join(root, 'data', 'halo-psa-logs');
  const packageDir = path.join(root, 'package');
  const runLines = [];
  const hostLines = [];
  const consoleCalls = [];
  const savedConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args) => consoleCalls.push(args);
  try {
    const off = createMarketplaceRunLogger({ env: { DATA_DIR: path.join(root, 'data') }, packageDir, context: { logger: {
      info: (m) => hostLines.push(m), warn: (m) => hostLines.push(m), error: (m) => hostLines.push(m)
    } }, run: { async appendLog(m) { runLines.push(m); } } });
    await Promise.all([off.info('Info'), off.warn('Warn'), off.error('Error'), off.debug('Hidden')]);
    const file = path.join(target, 'halo-psa-runtime.log');
    const text = await fsp.readFile(file, 'utf8');
    assert(text.includes('[INFO] Info') && text.includes('[WARN] Warn') && text.includes('[ERROR] Error'));
    assert(!text.includes('Hidden'));
    assert(!fs.existsSync(path.join(packageDir, '.runtime-logs')));
    assert.deepStrictEqual(hostLines, []);
    assert.deepStrictEqual(consoleCalls, []);
    assert(runLines.some((line) => line.includes('Info')));
    assert(!runLines.some((line) => line.includes('Hidden')));

    const overrideDir = path.join(root, 'override');
    const overridden = createMarketplaceRunLogger({ env: { DATA_DIR: path.join(root, 'unused-data') }, logDir: overrideDir });
    await overridden.info('Explicit override');
    assert(fs.existsSync(path.join(overrideDir, 'halo-psa-runtime.log')));
    assert(!fs.existsSync(path.join(root, 'unused-data', 'halo-psa-logs')));

    const fallbackDir = path.join(root, 'fallback-package');
    const fallback = createMarketplaceRunLogger({ env: {}, packageDir: fallbackDir });
    await fallback.info('Package fallback');
    assert(fs.existsSync(path.join(fallbackDir, 'halo-psa-runtime.log')));

    const enabledDir = path.join(root, 'enabled');
    const enabled = createMarketplaceRunLogger({ diagnosticLoggingEnabled: true, logDir: enabledDir });
    await enabled.debug('Visible debug', { authorization: 'Bearer abc', client_secret: 'shh' });
    const enabledText = await fsp.readFile(path.join(enabledDir, 'halo-psa-runtime.log'), 'utf8');
    assert(enabledText.includes('[DEBUG] Visible debug'));
    assert(!enabledText.includes('Bearer abc') && !enabledText.includes('shh'));
  } finally {
    console.log = savedConsole.log; console.warn = savedConsole.warn; console.error = savedConsole.error;
  }

  const rotateDir = path.join(root, 'rotate');
  const logger = createMarketplaceRunLogger({ diagnosticLoggingEnabled: true, logDir: rotateDir, maxFileBytes: 300, maxBackups: 5 });
  await Promise.all(Array.from({ length: 40 }, (_, i) => logger.info(`entry-${i}-${'x'.repeat(30)}`)));
  const active = await fsp.readFile(path.join(rotateDir, 'halo-psa-runtime.log'), 'utf8');
  assert(active.includes('entry-39-'));
  for (let i = 1; i <= 5; i += 1) assert(fs.existsSync(path.join(rotateDir, `halo-psa-runtime.log.${i}`)));
  assert(!fs.existsSync(path.join(rotateDir, 'halo-psa-runtime.log.6')));

  const oversizedDir = path.join(root, 'oversized');
  await fsp.mkdir(oversizedDir, { recursive: true });
  await fsp.writeFile(path.join(oversizedDir, 'halo-psa-runtime.log'), 'x'.repeat(400));
  const oversizedLogger = createMarketplaceRunLogger({ logDir: oversizedDir, maxFileBytes: 300 });
  await oversizedLogger.info('after oversized');
  assert((await fsp.stat(path.join(oversizedDir, 'halo-psa-runtime.log.1'))).size > 300);

  let warnings = 0;
  const oldWarn = console.warn;
  console.warn = () => { warnings += 1; };
  const failed = createMarketplaceRunLogger({ logDir: path.join(root, 'fail'), fsImpl: {
    async mkdir() {}, async stat() { const e = new Error('missing'); e.code = 'ENOENT'; throw e; },
    async appendFile() { throw new Error('disk unavailable'); }, async rm() {}, async rename() {}
  } });
  await failed.info('nonfatal one'); await failed.error('nonfatal two');
  console.warn = oldWarn;
  assert.strictEqual(warnings, 1);
  console.log('HaloPSA runtime logging contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
