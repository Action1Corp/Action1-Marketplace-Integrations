const fs = require('fs/promises');
const path = require('path');

const INTEGRATION_ID = 'action1-configuration-manager';
const LOG_PREFIX = 'action1-config-manager';
const DEFAULT_FILE_NAME = `${INTEGRATION_ID}-runtime.log`;
const LOG_DIR_ENV = 'ACTION1_CONFIGURATION_MANAGER_LOG_DIR';

function resolveAction1RuntimeLogDir(options = {}) {
  const env = options.env || process.env;
  const packageDir = options.packageDir || __dirname;
  if (String(options.logDir || '').trim()) {
    return path.resolve(String(options.logDir).trim());
  }
  if (String(env[LOG_DIR_ENV] || '').trim()) {
    return path.resolve(String(env[LOG_DIR_ENV]).trim());
  }
  if (String(env.DATA_DIR || '').trim()) {
    return path.resolve(String(env.DATA_DIR).trim(), `${INTEGRATION_ID}-logs`);
  }
  return path.resolve(packageDir, '.runtime-logs');
}

function sanitizeRuntimeText(value) {
  return String(value || '')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(access_token|refresh_token|id_token|client_secret|apiSecret|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/authorization\s*[:=]\s*[^\r\n]+/gi, 'authorization=[redacted]');
}

function formatAction1RuntimeLogLine(level, message, now = () => Date.now()) {
  return `${new Date(now()).toISOString()} [${LOG_PREFIX}] ${String(level || 'INFO').toUpperCase()} ${sanitizeRuntimeText(message)}\n`;
}

function createAction1RuntimeLogger(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const logDir = resolveAction1RuntimeLogDir(options);
  const filePath = path.join(logDir, String(options.fileName || DEFAULT_FILE_NAME));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  let initialized = false;
  let failureWarned = false;

  function warnOnce(message) {
    if (failureWarned) return;
    failureWarned = true;
    try {
      if (typeof options.warn === 'function') options.warn(message);
      else if (typeof console?.warn === 'function') console.warn(message);
    } catch {}
  }

  async function write(level, message) {
    try {
      await fileSystem.mkdir(logDir, { recursive: true });
      if (!initialized) {
        initialized = true;
        await fileSystem.appendFile(
          filePath,
          formatAction1RuntimeLogLine('INFO', `Runtime file logging initialized: ${filePath}`, now),
          'utf8'
        );
      }
      await fileSystem.appendFile(filePath, formatAction1RuntimeLogLine(level, message, now), 'utf8');
    } catch (error) {
      warnOnce(`Action1 Configuration Manager runtime file logging unavailable (${filePath}): ${sanitizeRuntimeText(error?.message || 'write failed')}`);
    }
  }

  return { logDir, filePath, debug: (message) => write('DEBUG', message), info: (message) => write('INFO', message), warn: (message) => write('WARN', message), error: (message) => write('ERROR', message) };
}

let defaultLogger;
function getDefaultAction1RuntimeLogger() {
  if (!defaultLogger) defaultLogger = createAction1RuntimeLogger();
  return defaultLogger;
}

function writeAction1RuntimeLog(context, level, message) {
  try {
    const logger = context?.action1ConfigurationManagerRuntimeLogger || getDefaultAction1RuntimeLogger();
    const writer = logger?.[level];
    if (typeof writer !== 'function') return Promise.resolve();
    return Promise.resolve(writer.call(logger, sanitizeRuntimeText(message))).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

module.exports = {
  DEFAULT_FILE_NAME,
  LOG_DIR_ENV,
  createAction1RuntimeLogger,
  formatAction1RuntimeLogLine,
  getDefaultAction1RuntimeLogger,
  writeAction1RuntimeLog,
  resolveAction1RuntimeLogDir,
  sanitizeRuntimeText
};
