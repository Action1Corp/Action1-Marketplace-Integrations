const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createAction1RuntimeLogger,
  resolveAction1RuntimeLogDir,
  formatAction1RuntimeLogLine
} = require('../runtimeLogging');

async function run() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'action1-config-logs-'));
  const explicitDir = path.join(tempRoot, 'explicit');
  assert.strictEqual(
    resolveAction1RuntimeLogDir({
      env: {
        ACTION1_CONFIGURATION_MANAGER_LOG_DIR: explicitDir,
        DATA_DIR: path.join(tempRoot, 'data')
      }
    }),
    path.resolve(explicitDir)
  );
  assert.strictEqual(
    resolveAction1RuntimeLogDir({ env: { DATA_DIR: path.join(tempRoot, 'data') } }),
    path.resolve(path.join(tempRoot, 'data', 'action1-configuration-manager-logs'))
  );
  assert.strictEqual(
    resolveAction1RuntimeLogDir({ env: {}, packageDir: path.join(tempRoot, 'package') }),
    path.resolve(path.join(tempRoot, 'package', '.runtime-logs'))
  );

  const logDir = path.join(tempRoot, 'log');
  const logger = createAction1RuntimeLogger({ logDir });
  await logger.info('Loaded 2 Action1 organizations');
  await logger.debug('Reused Action1 access token; 2870s remaining');
  await logger.error('Failed to load Action1 organizations: HTTP 403');
  const logPath = path.join(logDir, 'action1-configuration-manager-runtime.log');
  const text = await fsp.readFile(logPath, 'utf8');
  assert.match(text, /\d{4}-\d{2}-\d{2}T[^ ]+Z \[action1-config-manager\] INFO Loaded 2 Action1 organizations/);
  assert.match(text, /\[action1-config-manager\] DEBUG Reused Action1 access token/);
  assert.match(text, /\[action1-config-manager\] ERROR Failed to load Action1 organizations: HTTP 403/);

  const safeLogger = createAction1RuntimeLogger({ logDir: path.join(tempRoot, 'safe') });
  await safeLogger.info('credentials client_secret=super-secret access_token=raw-token Authorization: Bearer raw-token');
  const safeText = await fsp.readFile(path.join(tempRoot, 'safe', 'action1-configuration-manager-runtime.log'), 'utf8');
  assert.strictEqual(safeText.includes('super-secret'), false);
  assert.strictEqual(safeText.includes('raw-token'), false);

  const hostLines = [];
  const failingLogger = createAction1RuntimeLogger({
    logDir: path.join(tempRoot, 'failure'),
    fileSystem: {
      async mkdir() {},
      async appendFile() { throw new Error('disk unavailable'); }
    },
    warn(message) { hostLines.push(message); }
  });
  await failingLogger.info('first');
  await failingLogger.info('second');
  assert.strictEqual(hostLines.length, 1, 'file logging failure should warn once');

  assert.match(
    formatAction1RuntimeLogLine('INFO', 'Loaded 4 endpoint groups for organization org-1'),
    /\[action1-config-manager\] INFO Loaded 4 endpoint groups for organization org-1/
  );
  assert.strictEqual(fs.existsSync(logPath), true);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
