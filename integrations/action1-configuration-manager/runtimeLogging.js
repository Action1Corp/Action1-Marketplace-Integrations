const fs = require('fs/promises');
const path = require('path');
const { normalizeDebugLoggingEnabled } = require('./debugLogging');

const INTEGRATION_ID = 'action1-configuration-manager';
const LOG_PREFIX = 'action1-config-manager';
const DEFAULT_FILE_NAME = `${INTEGRATION_ID}-runtime.log`;
const LOG_DIR_ENV = 'ACTION1_CONFIGURATION_MANAGER_LOG_DIR';
const DEBUG_LOGGING_KEY = `DebugLogging_${INTEGRATION_ID}`;
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_FILES = 5;

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
  return String(value ?? '')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/["']?(apiKey|apiSecret|api_key|api_secret|client_id|client_secret|access_token|refresh_token|id_token|password|secret)["']?\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi, '$1$2[redacted]')
    .replace(/authorization\s*[:=]\s*[^\r\n]+/gi, 'authorization=[redacted]');
}

function formatRuntimeValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  const rendered = sanitizeRuntimeText(value);
  return /\s|[|="]/.test(rendered) ? `"${rendered.replace(/"/g, '\\"')}"` : rendered;
}

function formatRuntimeFields(fields = {}) {
  return Object.entries(fields)
    .filter(([key]) => /^[A-Za-z][A-Za-z0-9]*$/.test(key))
    .map(([key, value]) => `${key}=${formatRuntimeValue(value)}`)
    .join(' | ');
}

function formatRuntimePercent(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value))}%`;
}

function formatRuntimeElapsed(elapsedMs) {
  const milliseconds = Math.max(0, Number(elapsedMs) || 0);
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1).replace(/\.0$/, '')}s`;
}

async function writeOperationalLog(context, level, message, fields = {}) {
  const suffix = formatRuntimeFields(fields);
  const line = suffix ? `${message} | ${suffix}` : message;
  await writeAction1RuntimeLog(context, level, line);
  return line;
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
  let debugLoggingEnabled = normalizeDebugLoggingEnabled(options.debugLoggingEnabled);
  let writeQueue = Promise.resolve();
  const maxFileSizeBytes = Number.isFinite(Number(options.maxFileSizeBytes)) && Number(options.maxFileSizeBytes) > 0
    ? Math.floor(Number(options.maxFileSizeBytes))
    : DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxRotatedFiles = Number.isFinite(Number(options.maxRotatedFiles)) && Number(options.maxRotatedFiles) >= 0
    ? Math.floor(Number(options.maxRotatedFiles))
    : DEFAULT_MAX_ROTATED_FILES;

  function warnOnce(message) {
    if (failureWarned) return;
    failureWarned = true;
    try {
      if (typeof options.warn === 'function') options.warn(message);
      else if (typeof console?.warn === 'function') console.warn(message);
    } catch {}
  }

  async function appendWithRotation(line) {
    const lineSize = Buffer.byteLength(line, 'utf8');
    let currentSize = 0;
    try {
      const activeFile = await fileSystem.stat(filePath);
      currentSize = activeFile.size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (currentSize + lineSize > maxFileSizeBytes && currentSize > 0) {
      if (maxRotatedFiles > 0) {
        const oldestPath = `${filePath}.${maxRotatedFiles}`;
        try {
          await fileSystem.unlink(oldestPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        for (let index = maxRotatedFiles - 1; index >= 1; index -= 1) {
          try {
            await fileSystem.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        }
        await fileSystem.rename(filePath, `${filePath}.1`);
      } else {
        await fileSystem.unlink(filePath);
      }
    }
    await fileSystem.appendFile(filePath, line, 'utf8');
  }

  async function writeEntry(level, message) {
    await fileSystem.mkdir(logDir, { recursive: true });
    if (!initialized) {
      await appendWithRotation(formatAction1RuntimeLogLine('INFO', `Runtime file logging initialized: ${filePath}`, now));
      initialized = true;
    }
    await appendWithRotation(formatAction1RuntimeLogLine(level, message, now));
  }

  function write(level, message) {
    if (String(level).toUpperCase() === 'DEBUG' && debugLoggingEnabled !== true) return Promise.resolve();
    writeQueue = writeQueue.then(() => writeEntry(level, message)).catch((error) => {
      warnOnce(`Action1 Configuration Manager runtime file logging unavailable (${filePath}): ${sanitizeRuntimeText(error?.message || 'write failed')}`);
    });
    return writeQueue;
  }

  return {
    logDir,
    filePath,
    setDebugLoggingEnabled(value) { debugLoggingEnabled = normalizeDebugLoggingEnabled(value); },
    debug: (message) => write('DEBUG', message),
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message)
  };
}

let defaultLogger;
const debugSettingReads = new WeakMap();
function getDefaultAction1RuntimeLogger() {
  if (!defaultLogger) defaultLogger = createAction1RuntimeLogger();
  return defaultLogger;
}

async function resolveDebugLoggingEnabled(context) {
  if (!context || (typeof context !== 'object' && typeof context !== 'function')) return undefined;
  const get = context.settings && typeof context.settings.get === 'function' ? context.settings.get.bind(context.settings) : null;
  if (!get) return undefined;
  if (!debugSettingReads.has(context)) {
    debugSettingReads.set(context, Promise.resolve().then(() => get(DEBUG_LOGGING_KEY)).then(normalizeDebugLoggingEnabled).catch(() => false));
  }
  return debugSettingReads.get(context);
}

function writeAction1RuntimeLog(context, level, message) {
  try {
    const logger = context?.action1ConfigurationManagerRuntimeLogger || getDefaultAction1RuntimeLogger();
    const hasSettings = Boolean(context?.settings && typeof context.settings.get === 'function');
    if (!hasSettings) {
      const writer = logger?.[level];
      if (typeof writer !== 'function') return Promise.resolve();
      return Promise.resolve(writer.call(logger, sanitizeRuntimeText(message))).catch(() => {});
    }
    return resolveDebugLoggingEnabled(context).then(async (enabled) => {
      if (String(level).toLowerCase() === 'debug' && enabled === false) return;
      if (typeof logger?.setDebugLoggingEnabled === 'function' && enabled !== undefined) logger.setDebugLoggingEnabled(enabled);
      const writer = logger?.[level];
      if (typeof writer !== 'function') return;
      await Promise.resolve(writer.call(logger, sanitizeRuntimeText(message))).catch(() => {});
    }).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

module.exports = {
  DEFAULT_FILE_NAME,
  DEBUG_LOGGING_KEY,
  LOG_DIR_ENV,
  createAction1RuntimeLogger,
  formatAction1RuntimeLogLine,
  getDefaultAction1RuntimeLogger,
  writeAction1RuntimeLog,
  resolveAction1RuntimeLogDir,
  sanitizeRuntimeText,
  formatRuntimeFields,
  formatRuntimePercent,
  formatRuntimeElapsed,
  writeOperationalLog
};
