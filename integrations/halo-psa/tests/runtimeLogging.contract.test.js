const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  LOG_LEVELS,
  createMarketplaceRunLogger
} = require('../runtimeLogging');

async function run() {
  await runBasicLoggerSinkTest();
  await runDetailedLoggerFileTest();
  await runDisabledDiagnosticFileTest();
  await runFileWriteFailureDoesNotCrashTest();
  await runRotationTest();
  runGitIgnoreContractTest();
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

async function runFileWriteFailureDoesNotCrashTest() {
  const logger = createMarketplaceRunLogger({
    diagnosticLoggingEnabled: true,
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
    }
  });

  await logger.debug('File sink failure should not crash.', {
    phase: 'supportability'
  });
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
