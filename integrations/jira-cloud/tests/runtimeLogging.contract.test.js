const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createMarketplaceRunLogger, resolveDiagnosticLogDir } = require('../runtimeLogging');

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'jira-logs-'));
  const dataDir = path.join(root, 'data');
  const packageDir = path.join(root, 'package');
  assert.strictEqual(resolveDiagnosticLogDir({ env: { DATA_DIR: dataDir } }), path.join(dataDir, 'jira-cloud-logs'));
  assert.strictEqual(resolveDiagnosticLogDir({ env: { DATA_DIR: dataDir, JIRA_CLOUD_LOG_DIR: path.join(root, 'env-override') } }), path.join(root, 'env-override'));
  assert.strictEqual(resolveDiagnosticLogDir({ env: {}, packageDir }), packageDir);

  const runLines = [];
  const hostLines = [];
  const consoleCalls = [];
  const savedConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args) => consoleCalls.push(args);
  try {
    const logger = createMarketplaceRunLogger({ env: { DATA_DIR: dataDir }, packageDir, context: { logger: {
      info: (m) => hostLines.push(m), warn: (m) => hostLines.push(m), error: (m) => hostLines.push(m), debug: (m) => hostLines.push(m)
    } }, run: { async appendLog(m) { runLines.push(m); } } });
    await Promise.all([logger.info('Info entry'), logger.warn('Warn entry'), logger.error('Error entry'), logger.debug('Hidden debug')]);
    const logDir = path.join(dataDir, 'jira-cloud-logs');
    const logPath = path.join(logDir, 'jira-cloud-runtime.log');
    const text = await fsp.readFile(logPath, 'utf8');
    assert(text.includes('[INFO] Info entry') && text.includes('[WARN] Warn entry') && text.includes('[ERROR] Error entry'));
    assert(!text.includes('Hidden debug'));
    assert(!fs.existsSync(path.join(packageDir, '.runtime-logs')));
    assert.strictEqual(hostLines.length, 0);
    assert.strictEqual(consoleCalls.length, 0);
    assert(runLines.some((line) => line.includes('Info entry')));
    assert(!runLines.some((line) => line.includes('Hidden debug')));

    const explicitDir = path.join(root, 'explicit');
    const explicit = createMarketplaceRunLogger({ logDir: explicitDir, env: { DATA_DIR: path.join(root, 'unused') } });
    await explicit.info('Explicit directory');
    assert(fs.existsSync(path.join(explicitDir, 'jira-cloud-runtime.log')));

    const fallbackDir = path.join(root, 'fallback');
    const fallback = createMarketplaceRunLogger({ env: {}, packageDir: fallbackDir });
    await fallback.info('Fallback directory');
    assert(fs.existsSync(path.join(fallbackDir, 'jira-cloud-runtime.log')));

    const debugDir = path.join(root, 'debug');
    const debug = createMarketplaceRunLogger({ diagnosticLoggingEnabled: true, logDir: debugDir });
    await debug.debug('Detailed Jira trace', { authorization: 'Bearer example-secret', access_token: 'sample-token' });
    const debugText = await fsp.readFile(path.join(debugDir, 'jira-cloud-runtime.log'), 'utf8');
    assert(debugText.includes('[DEBUG] Detailed Jira trace'));
    assert(!debugText.includes('example-secret') && !debugText.includes('sample-token'));
  } finally {
    console.log = savedConsole.log; console.warn = savedConsole.warn; console.error = savedConsole.error;
  }

  const rotationDir = path.join(root, 'rotation');
  const rotating = createMarketplaceRunLogger({ logDir: rotationDir, maxFileBytes: 280, maxBackups: 5 });
  await Promise.all(Array.from({ length: 35 }, (_, i) => rotating.info(`entry-${i}-${'x'.repeat(25)}`)));
  assert((await fsp.readFile(path.join(rotationDir, 'jira-cloud-runtime.log'), 'utf8')).includes('entry-34-'));
  for (let i = 1; i <= 5; i += 1) assert(fs.existsSync(path.join(rotationDir, `jira-cloud-runtime.log.${i}`)));
  assert(!fs.existsSync(path.join(rotationDir, 'jira-cloud-runtime.log.6')));

  const oversizedDir = path.join(root, 'oversized');
  await fsp.mkdir(oversizedDir, { recursive: true });
  await fsp.writeFile(path.join(oversizedDir, 'jira-cloud-runtime.log'), 'x'.repeat(350));
  const oversized = createMarketplaceRunLogger({ logDir: oversizedDir, maxFileBytes: 280 });
  await oversized.info('after oversized file');
  assert((await fsp.stat(path.join(oversizedDir, 'jira-cloud-runtime.log.1'))).size > 280);

  let warnings = 0;
  const oldWarn = console.warn;
  console.warn = () => { warnings += 1; };
  const failed = createMarketplaceRunLogger({ logDir: path.join(root, 'failure'), fsImpl: {
    async mkdir() {}, async stat() { const error = new Error('missing'); error.code = 'ENOENT'; throw error; },
    async appendFile() { throw new Error('disk unavailable'); }, async rm() {}, async rename() {}
  } });
  await failed.info('failure one'); await failed.error('failure two');
  console.warn = oldWarn;
  assert.strictEqual(warnings, 1);

  const gitIgnore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8').replace(/\r\n/g, '\n');
  assert(gitIgnore.includes('.runtime-logs/'), 'runtime diagnostic log directories should be ignored by Git');
  console.log('Jira Cloud runtime logging contract tests passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
