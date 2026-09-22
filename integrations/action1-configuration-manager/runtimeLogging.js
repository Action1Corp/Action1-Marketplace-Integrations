const fs = require('fs/promises');
const path = require('path');

const INTEGRATION_ID = 'action1-configuration-manager';
const LOG_PREFIX = 'action1-config-manager';
const DEFAULT_FILE_NAME = `${INTEGRATION_ID}-runtime.log`;
const LOG_DIR_ENV = 'ACTION1_CONFIGURATION_MANAGER_LOG_DIR';
const DEBUG_LOGGING_KEY = `DebugLogging_${INTEGRATION_ID}`;

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
  let debugLoggingEnabled = options.debugLoggingEnabled === true;

  function warnOnce(message) {
    if (failureWarned) return;
    failureWarned = true;
    try {
      if (typeof options.warn === 'function') options.warn(message);
      else if (typeof console?.warn === 'function') console.warn(message);
    } catch {}
  }

  async function write(level, message) {
    if (String(level).toUpperCase() === 'DEBUG' && debugLoggingEnabled !== true) return;
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

  return {
    logDir,
    filePath,
    setDebugLoggingEnabled(value) { debugLoggingEnabled = value === true; },
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
    debugSettingReads.set(context, Promise.resolve().then(() => get(DEBUG_LOGGING_KEY)).then(value => value === true || String(value).toLowerCase() === 'true').catch(() => false));
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
