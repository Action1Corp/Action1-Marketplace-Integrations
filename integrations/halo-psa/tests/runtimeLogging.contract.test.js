const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  LOG_LEVELS,
  createMarketplaceRunLogger,
  resolveDiagnosticLogDir
} = require('../runtimeLogging');

async function run() {
  runDiagnosticLogDirPriorityTest();
  runDiagnosticLogDirDataDirFallbackTest();
  runDiagnosticLogDirPackageLocalFallbackTest();
  await runBasicLoggerSinkTest();
  await runDetailedLoggerFileTest();
  await runDisabledDiagnosticFileTest();
  await runDiagnosticFileEnablementAnnouncementTest();
  await runDiagnosticDirectoryCreatedIfMissingTest();
  await runFileWriteFailureDoesNotCrashTest();
  await runRotationTest();
  runGitIgnoreContractTest();
}

function runDiagnosticLogDirPriorityTest() {
  const resolved = resolveDiagnosticLogDir({
    env: {
      HALO_PSA_LOG_DIR: path.join('C:', 'temp', 'halo-custom'),
      DATA_DIR: path.join('C:', 'temp', 'data-root')
    }
  });

  assert.strictEqual(
    resolved,
    path.resolve(path.join('C:', 'temp', 'halo-custom')),
    'HALO_PSA_LOG_DIR should take priority over DATA_DIR'
  );
}

function runDiagnosticLogDirDataDirFallbackTest() {
  const resolved = resolveDiagnosticLogDir({
    env: {
      DATA_DIR: path.join('C:', 'temp', 'data-root')
    }
  });

  assert.strictEqual(
    resolved,
    path.resolve(path.join('C:', 'temp', 'data-root', 'halo-psa-logs')),
    'DATA_DIR should fall back to DATA_DIR/halo-psa-logs when HALO_PSA_LOG_DIR is unset'
  );
}

function runDiagnosticLogDirPackageLocalFallbackTest() {
  const resolved = resolveDiagnosticLogDir({
    env: {}
  });

  assert.strictEqual(
    resolved,
    path.resolve(path.join(__dirname, '..', '.runtime-logs')),
    'fallback diagnostic directory should resolve under the HaloPSA package instead of process.cwd()'
  );
}

async function runBasicLoggerSinkTest() {
  const runLines = [];
  const hostLines = [];
  const logger = createMarketplaceRunLogger({
    run: {
      async appendLog(message) {
        runLines.push(message);
      }
    },
    context: {
      logger: {
        info(message) {
          hostLines.push(`info:${message}`);
        },
        warn(message) {
          hostLines.push(`warn:${message}`);
        },
        error(message) {
          hostLines.push(`error:${message}`);
        },
        debug(message) {
          hostLines.push(`debug:${message}`);
        }
      }
    }
  });

  await logger.info('Sync started.', {
    phase: 'startup'
  });
  await logger.debug('Detailed hidden trace.', {
    bearer: 'Bearer abc'
  });
  await logger.warn('Partial failure.', {
    token: 'secret-value'
  });

  assert.strictEqual(runLines.some((line) => line.includes('Sync started.')), true, 'basic logger should write operator progress to request.run');
  assert.strictEqual(runLines.some((line) => line.includes('Detailed hidden trace.')), false, 'debug logging should stay out of request.run by default');
  assert.strictEqual(hostLines.some((line) => line.includes('Sync started.')), true, 'basic logger should write high-level progress to the host logger');
  assert.strictEqual(hostLines.some((line) => line.includes('Detailed hidden trace.')), false, 'debug logging should stay disabled until diagnostics are enabled');
  assert.strictEqual(runLines.some((line) => line.includes('secret-value')), false, 'request.run logs should redact secrets');
  assert.strictEqual(
    hostLines.some((line) => /info:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[halo-psa\]\[INFO\] Sync started\./.test(line)),
    true,
    'console logs should include ISO timestamps and the HaloPSA prefix'
  );
}

async function runDetailedLoggerFileTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-psa-logs-'));
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: tempDir,
    run: {
      async appendLog() {}
    }
  });

  await logger.debug('Detailed Action1 trace.', {
    authorization: 'Bearer abc',
    tokenResponse: {
      access_token: 'raw-access-token',
      refresh_token: 'raw-refresh-token'
    },
    nested: {
      clientSecret: 'super-secret'
    },
    url: 'https://example.com/api?access_token=abc&safe=1'
  });

  const logPath = path.join(tempDir, 'halo-psa-runtime.log');
  const text = await fsp.readFile(logPath, 'utf8');
  assert.strictEqual(text.includes('Detailed Action1 trace.'), true, 'detailed diagnostics should create a file log entry');
  assert.strictEqual(
    /(?:^|\n)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[halo-psa\]\[INFO\] HaloPSA diagnostic file logging enabled /.test(text),
    true,
    'diagnostic file logs should announce the resolved file path when file logging is enabled'
  );
  assert.strictEqual(
    /(?:^|\n)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[halo-psa\]\[DEBUG\] Detailed Action1 trace\./.test(text),
    true,
    'diagnostic file logs should include ISO timestamps and the HaloPSA prefix'
  );
  assert.strictEqual(text.toLowerCase().includes('super-secret'), false, 'diagnostic file logs should redact secret-like values');
  assert.strictEqual(text.toLowerCase().includes('bearer abc'), false, 'diagnostic file logs should redact bearer tokens');
  assert.strictEqual(text.includes('raw-access-token'), false, 'diagnostic file logs should redact raw access tokens');
  assert.strictEqual(text.includes('raw-refresh-token'), false, 'diagnostic file logs should redact raw refresh tokens');
  assert.strictEqual(text.includes('[redacted]'), true, 'diagnostic file logs should visibly redact sensitive fields');
}

async function runDisabledDiagnosticFileTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-psa-logs-off-'));
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: false,
    logDir: tempDir
  });

  await logger.info('Basic progress only.');
  const logPath = path.join(tempDir, 'halo-psa-runtime.log');
  assert.strictEqual(fs.existsSync(logPath), false, 'diagnostic file logging should stay disabled by default');
}

async function runDiagnosticFileEnablementAnnouncementTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-psa-logs-announce-'));
  const hostLines = [];
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: tempDir,
    context: {
      logger: {
        info(message) {
          hostLines.push(`info:${message}`);
        },
        warn(message) {
          hostLines.push(`warn:${message}`);
        },
        error(message) {
          hostLines.push(`error:${message}`);
        },
        debug(message) {
          hostLines.push(`debug:${message}`);
        }
      }
    }
  });

  await logger.debug('Detailed trace for announcement test.');

  const expectedPath = path.join(tempDir, 'halo-psa-runtime.log');
  const enablementLines = hostLines.filter((line) => line.includes('HaloPSA diagnostic file logging enabled'));
  assert.strictEqual(enablementLines.length, 1, 'diagnostic file logging should announce itself once');
  assert.strictEqual(
    enablementLines[0].includes('"filePath"') && enablementLines[0].includes(path.basename(expectedPath)),
    true,
    'enablement announcement should include the resolved file path'
  );
}

async function runDiagnosticDirectoryCreatedIfMissingTest() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-psa-logs-dir-'));
  const nestedDir = path.join(tempRoot, 'a', 'b', 'c');
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: nestedDir
  });

  await logger.debug('Create the diagnostic directory tree.');

  assert.strictEqual(
    fs.existsSync(path.join(nestedDir, 'halo-psa-runtime.log')),
    true,
    'diagnostic file logging should create the target directory when it is missing'
  );
}

async function runFileWriteFailureDoesNotCrashTest() {
  const hostLines = [];
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: path.join('C:', 'temp', 'halo-write-failure'),
    fsImpl: {
      async stat() {
        throw new Error('missing');
      },
      async mkdir() {},
      async appendFile() {
        throw new Error('disk unavailable');
      },
      async rm() {},
      async rename() {}
    },
    context: {
      logger: {
        info(message) {
          hostLines.push(`info:${message}`);
        },
        warn(message) {
          hostLines.push(`warn:${message}`);
        },
        error(message) {
          hostLines.push(`error:${message}`);
        },
        debug(message) {
          hostLines.push(`debug:${message}`);
        }
      }
    }
  });

  await logger.debug('File sink failure should not crash.', {
    phase: 'supportability'
  });
  await logger.debug('File sink failure should not crash twice.', {
    phase: 'supportability'
  });

  const warningLines = hostLines.filter((line) => line.includes('diagnostic file logging') && line.startsWith('warn:'));
  assert.strictEqual(warningLines.length, 1, 'diagnostic file write failures should warn once');
  assert.strictEqual(
    warningLines[0].includes('"filePath"') && warningLines[0].includes('halo-psa-runtime.log'),
    true,
    'file write failure warning should include the resolved file path'
  );
  assert.strictEqual(warningLines[0].includes('disk unavailable'), true, 'file write failure warning should include a safe error message');
}

async function runRotationTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'halo-psa-logs-rotate-'));
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: tempDir,
    maxFileBytes: 220,
    maxBackups: 2
  });

  for (let index = 0; index < 8; index += 1) {
    await logger.debug(`rotation line ${index}`, {
      detail: 'x'.repeat(80)
    });
  }

  assert.strictEqual(fs.existsSync(path.join(tempDir, 'halo-psa-runtime.log.1')), true, 'diagnostic log rotation should keep at least one backup file');
}

function runGitIgnoreContractTest() {
  const gitIgnore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(gitIgnore.includes('integrations/halo-psa/.runtime-logs/'), true, 'runtime diagnostic log directory should be ignored by Git');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
