const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  LOG_LEVELS,
  createMarketplaceRunLogger,
  resolveDiagnosticLogDir,
  resolveDiagnosticLogFilePath
} = require('../runtimeLogging');

async function run() {
  runDiagnosticLogDirPriorityTest();
  runDiagnosticLogDirDataDirFallbackTest();
  runDiagnosticLogDirPackageLocalFallbackTest();
  runDiagnosticLogFilePathTest();
  await runBasicLoggerSinkTest();
  await runDetailedLoggerFileTest();
  await runAlwaysOnFileLoggingTest();
  await runDiagnosticFileEnablementAnnouncementTest();
  await runDiagnosticDirectoryCreatedIfMissingTest();
  await runFileWriteFailureDoesNotCrashTest();
  await runRotationTest();
}

function runDiagnosticLogDirPriorityTest() {
  const resolved = resolveDiagnosticLogDir({
    env: {
      ENTRA_ID_LOG_DIR: path.join('C:', 'temp', 'entra-custom'),
      DATA_DIR: path.join('C:', 'temp', 'data-root')
    }
  });

  assert.strictEqual(
    resolved,
    path.resolve(path.join('C:', 'temp', 'entra-custom')),
    'ENTRA_ID_LOG_DIR should take priority over DATA_DIR'
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
    path.resolve(path.join('C:', 'temp', 'data-root', 'entra-id-logs')),
    'DATA_DIR should fall back to DATA_DIR/entra-id-logs when ENTRA_ID_LOG_DIR is unset'
  );
}

function runDiagnosticLogDirPackageLocalFallbackTest() {
  const resolved = resolveDiagnosticLogDir({
    env: {}
  });

  assert.strictEqual(
    resolved,
    path.resolve(path.join(__dirname, '..', '.runtime-logs')),
    'fallback diagnostic directory should resolve under the Entra package instead of process.cwd()'
  );
}

function runDiagnosticLogFilePathTest() {
  const resolved = resolveDiagnosticLogFilePath({
    env: {
      ENTRA_ID_LOG_DIR: path.join('C:', 'temp', 'entra-custom')
    }
  });

  assert.strictEqual(
    resolved,
    path.resolve(path.join('C:', 'temp', 'entra-custom', 'entra-id-runtime.log')),
    'diagnostic file path resolution should expose the deterministic Entra runtime log file path'
  );
}

async function runBasicLoggerSinkTest() {
  const runLines = [];
  const hostLines = [];
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-id-basic-logs-'));
  const logger = createMarketplaceRunLogger({
    logDir: tempDir,
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
    },
    integrationId: 'entra-id'
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
  const basicText = await fsp.readFile(path.join(tempDir, 'entra-id-runtime.log'), 'utf8');
  assert.strictEqual(basicText.includes('Sync started.'), true, 'basic runtime lines should be written to the text log without an optional diagnostics flag');
  assert.strictEqual(basicText.includes('Detailed hidden trace.'), false, 'debug lines should stay out of the text log until detailed logging is enabled');
  assert.strictEqual(
    hostLines.some((line) => /info:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[entra-id\]\[INFO\] Sync started\./.test(line)),
    true,
    'console logs should include ISO timestamps and the Entra prefix'
  );
  assert.strictEqual(LOG_LEVELS.INFO, 'INFO', 'runtime logger should expose stable log levels');
}

async function runDetailedLoggerFileTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-id-logs-'));
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: tempDir,
    run: {
      async appendLog() {}
    },
    integrationId: 'entra-id'
  });

  await logger.debug('Detailed Entra trace.', {
    authorization: 'Bearer abc',
    tokenResponse: {
      access_token: 'raw-access-token',
      refresh_token: 'raw-refresh-token'
    },
    nested: {
      clientSecret: 'super-secret'
    },
    url: 'https://graph.microsoft.com/v1.0/devices?access_token=abc&safe=1'
  });

  const logPath = path.join(tempDir, 'entra-id-runtime.log');
  const text = await fsp.readFile(logPath, 'utf8');
  assert.strictEqual(text.includes('Detailed Entra trace.'), true, 'detailed diagnostics should create a file log entry');
  assert.strictEqual(
    /(?:^|\n)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[entra-id\]\[INFO\] \[Integration:entra-id\] Runtime log file: /.test(text),
    true,
    'diagnostic file logs should announce the resolved file path when file logging is enabled'
  );
  assert.strictEqual(
    /(?:^|\n)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[entra-id\]\[DEBUG\] Detailed Entra trace\./.test(text),
    true,
    'diagnostic file logs should include ISO timestamps and the Entra prefix'
  );
  assert.strictEqual(text.toLowerCase().includes('super-secret'), false, 'diagnostic file logs should redact secret-like values');
  assert.strictEqual(text.toLowerCase().includes('bearer abc'), false, 'diagnostic file logs should redact bearer tokens');
  assert.strictEqual(text.includes('raw-access-token'), false, 'diagnostic file logs should redact raw access tokens');
  assert.strictEqual(text.includes('raw-refresh-token'), false, 'diagnostic file logs should redact raw refresh tokens');
  assert.strictEqual(text.includes('[redacted]'), true, 'diagnostic file logs should visibly redact sensitive fields');
}

async function runAlwaysOnFileLoggingTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-id-logs-on-'));
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: false,
    logDir: tempDir,
    integrationId: 'entra-id'
  });

  await logger.info('Basic progress only.');
  const logPath = path.join(tempDir, 'entra-id-runtime.log');
  assert.strictEqual(fs.existsSync(logPath), true, 'runtime file logging should stay enabled by default even when detailed diagnostics are disabled');
  const text = await fsp.readFile(logPath, 'utf8');
  assert.strictEqual(text.includes('Basic progress only.'), true, 'always-on file logging should append ordinary runtime lines');
}

async function runDiagnosticFileEnablementAnnouncementTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-id-logs-announce-'));
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
    },
    integrationId: 'entra-id'
  });

  await logger.info('Runtime line for announcement test.');
  const siblingLogger = createMarketplaceRunLogger({
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
    },
    integrationId: 'entra-id'
  });
  await siblingLogger.info('Second runtime line for announcement test.');

  const expectedPath = path.join(tempDir, 'entra-id-runtime.log');
  const enablementLines = hostLines.filter((line) => line.includes('[Integration:entra-id] Runtime log file:'));
  assert.strictEqual(enablementLines.length, 1, 'runtime file logging should announce itself once per process path');
  assert.strictEqual(
    enablementLines[0].includes(expectedPath),
    true,
    'enablement announcement should include the resolved file path'
  );
}

async function runDiagnosticDirectoryCreatedIfMissingTest() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-id-logs-dir-'));
  const nestedDir = path.join(tempRoot, 'a', 'b', 'c');
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: nestedDir,
    integrationId: 'entra-id'
  });

  await logger.debug('Create the diagnostic directory tree.');

  assert.strictEqual(
    fs.existsSync(path.join(nestedDir, 'entra-id-runtime.log')),
    true,
    'diagnostic file logging should create the target directory when it is missing'
  );
}

async function runFileWriteFailureDoesNotCrashTest() {
  const hostLines = [];
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: path.join('C:', 'temp', 'entra-write-failure'),
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
    },
    integrationId: 'entra-id'
  });

  await logger.debug('File sink failure should not crash.', {
    phase: 'supportability'
  });
  await logger.debug('File sink failure should not crash twice.', {
    phase: 'supportability'
  });

  const warnLines = hostLines.filter((line) => line.includes('[Integration:entra-id] Runtime log file unavailable'));
  const infoLines = hostLines.filter((line) => line.includes('[Integration:entra-id] Runtime log file:'));
  assert.strictEqual(infoLines.length, 1, 'runtime file logging should still announce the resolved path before reporting a write failure');
  assert.strictEqual(warnLines.length, 1, 'file write failures should emit one warning');
  assert.strictEqual(
    warnLines[0].includes('"filePath"') && warnLines[0].includes('entra-id-runtime.log'),
    true,
    'file write failure warnings should include the resolved file path'
  );
}

async function runRotationTest() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entra-id-logs-rotate-'));
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
    logDir: tempDir,
    maxFileBytes: 220,
    maxBackups: 2,
    integrationId: 'entra-id'
  });

  for (let index = 0; index < 8; index += 1) {
    await logger.debug(`rotation line ${index}`, {
      detail: 'x'.repeat(80)
    });
  }

  assert.strictEqual(fs.existsSync(path.join(tempDir, 'entra-id-runtime.log.1')), true, 'diagnostic log rotation should keep at least one backup file');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
