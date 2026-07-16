const fs = require('node:fs/promises');
const path = require('node:path');

const LOG_LEVELS = Object.freeze({
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
});

const LOG_EVENT_TYPES = Object.freeze({
  RUN_START: 'RUN_START',
  RUN_END: 'RUN_END',
  PHASE: 'PHASE',
  DISCOVERY_FETCH: 'DISCOVERY_FETCH',
  HTTP_REQUEST: 'HTTP_REQUEST',
  RETRY: 'RETRY',
  SKIP: 'SKIP',
  PARTIAL_FAILURE: 'PARTIAL_FAILURE'
});

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 4;
const DEFAULT_FILE_NAME = 'entra-id-runtime.log';
const DEFAULT_PACKAGE_LOG_DIR = path.resolve(__dirname, '.runtime-logs');
const ANNOUNCED_FILE_PATHS = new Set();
const FILE_FAILURE_PATHS = new Set();
const LEVEL_PRIORITY = Object.freeze({
  [LOG_LEVELS.DEBUG]: 10,
  [LOG_LEVELS.INFO]: 20,
  [LOG_LEVELS.WARN]: 30,
  [LOG_LEVELS.ERROR]: 40
});

function containsSecretLikeText(rawMessage) {
  const lower = String(rawMessage || '').toLowerCase();
  return (
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('authorization') ||
    lower.includes('bearer') ||
    lower.includes('password') ||
    lower.includes('cookie')
  );
}

function sanitizeText(rawValue) {
  const value = String(rawValue === undefined || rawValue === null ? '' : rawValue);
  if (!value) {
    return '';
  }

  return value
    .replace(/bearer\s+[a-z0-9\-._~+/]+=*/gi, 'bearer [redacted]')
    .replace(/authorization(?:["']|\s)*[:=]\s*[^\r\n]+/gi, 'authorization=[redacted]')
    .replace(/access_token(?:["']|\s)*[:=]\s*[a-z0-9\-._~+/]+=*/gi, 'access_token=[redacted]')
    .replace(/refresh_token(?:["']|\s)*[:=]\s*[a-z0-9\-._~+/]+=*/gi, 'refresh_token=[redacted]')
    .replace(/id_token(?:["']|\s)*[:=]\s*[a-z0-9\-._~+/]+=*/gi, 'id_token=[redacted]')
    .replace(/client_secret(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'client_secret=[redacted]')
    .replace(/clientsecret(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'clientSecret=[redacted]')
    .replace(/apisecret(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'apiSecret=[redacted]')
    .replace(/password(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'password=[redacted]')
    .replace(/cookie(?:["']|\s)*[:=]\s*[^\r\n]+/gi, 'cookie=[redacted]')
    .replace(/\bsecret\b(?:["']|\s)*[:=]\s*[^\s,;]+/gi, 'secret=[redacted]');
}

function sanitizeUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value || !value.includes('?')) {
    return sanitizeText(value);
  }

  try {
    const parsed = new URL(value);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (containsSecretLikeText(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return sanitizeText(parsed.toString());
  } catch {
    return sanitizeText(value);
  }
}

function sanitizeKeyValue(key, value) {
  const keyText = String(key || '');
  if (/url|uri|path|target/i.test(keyText)) {
    return sanitizeUrl(value);
  }
  if (containsSecretLikeText(keyText)) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return '[redacted]';
  }
  return sanitizeValue(value);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : sanitizeText(value);
  }

  if (value === null) {
    return null;
  }

  if (!value || typeof value !== 'object') {
    const text = sanitizeText(value);
    return text || value;
  }

  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = sanitizeKeyValue(key, value[key]);
  }
  return out;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveDiagnosticLogDir(options = {}) {
  const env = options.env || process.env;
  if (String(options.logDir || '').trim()) {
    return path.resolve(String(options.logDir).trim());
  }
  if (String(env.ENTRA_ID_LOG_DIR || '').trim()) {
    return path.resolve(String(env.ENTRA_ID_LOG_DIR).trim());
  }
  if (String(env.DATA_DIR || '').trim()) {
    return path.resolve(String(env.DATA_DIR).trim(), 'entra-id-logs');
  }
  return path.resolve(String(options.packageDir || DEFAULT_PACKAGE_LOG_DIR));
}

function resolveDiagnosticLogFilePath(options = {}) {
  const fileName = String(options.fileName || DEFAULT_FILE_NAME);
  return path.join(
    resolveDiagnosticLogDir({
      env: options.env,
      logDir: options.logDir,
      packageDir: options.packageDir
    }),
    fileName
  );
}

function resolveInitialState(options = {}) {
  const env = options.env || process.env;
  const fileSystem = options.fsImpl || fs;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const diagnosticEnabled = parseBoolean(
    env.ENTRA_ID_DIAGNOSTIC_LOGS,
    Boolean(options.diagnosticLoggingEnabled)
  );

  return {
    integrationId: String(options.integrationId || 'entra-id'),
    run: options.run || null,
    hostLogger: options.hostLogger || options.context?.logger || null,
    env,
    fileSystem,
    now,
    diagnosticEnabled,
    logDir: resolveDiagnosticLogDir({
      env,
      logDir: options.logDir
    }),
    maxFileBytes: Number.isFinite(Number(options.maxFileBytes))
      ? Math.max(1024, Math.floor(Number(options.maxFileBytes)))
      : DEFAULT_MAX_FILE_BYTES,
    maxBackups: Number.isFinite(Number(options.maxBackups))
      ? Math.max(1, Math.floor(Number(options.maxBackups)))
      : DEFAULT_MAX_BACKUPS,
    fileName: String(options.fileName || DEFAULT_FILE_NAME),
    fileFailureReported: false,
    diagnosticFileEnabledReported: false
  };
}

function createMarketplaceRunLogger(input = {}) {
  const options =
    input && typeof input.appendLog === 'function'
      ? { run: input }
      : input && typeof input === 'object'
      ? input
      : { run: null };
  const state = resolveInitialState(options);
  return buildLogger(state, {});
}

function buildLogger(state, bindings) {
  const logger = {
    async emit(event) {
      const level = normalizeLevel(event?.level);
      const line = buildLine({
        state,
        bindings,
        event,
        level
      });

      await Promise.all([
        emitRunLine(state, line),
        emitConsoleLine(state, line),
        emitDiagnosticFileLine(state, line)
      ]);
    },
    async debug(message, context) {
      await logger.emit({
        level: LOG_LEVELS.DEBUG,
        eventType: LOG_EVENT_TYPES.PHASE,
        message,
        context
      });
    },
    async info(message, context) {
      await logger.emit({
        level: LOG_LEVELS.INFO,
        eventType: LOG_EVENT_TYPES.PHASE,
        message,
        context
      });
    },
    async warn(message, context) {
      await logger.emit({
        level: LOG_LEVELS.WARN,
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message,
        context
      });
    },
    async error(message, context) {
      await logger.emit({
        level: LOG_LEVELS.ERROR,
        eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
        message,
        context
      });
    },
    configure(next = {}) {
      if (Object.prototype.hasOwnProperty.call(next, 'diagnosticLoggingEnabled')) {
        state.diagnosticEnabled = parseBoolean(next.diagnosticLoggingEnabled, state.diagnosticEnabled);
      }
      if (next.logDir) {
        state.logDir = path.resolve(String(next.logDir));
      }
      return logger;
    },
    child(childBindings = {}) {
      return buildLogger(state, {
        ...(bindings || {}),
        ...(childBindings || {})
      });
    }
  };

  return logger;
}

function buildLine({ state, bindings, event, level }) {
  const message = sanitizeText(String(event?.message || ''));
  const context = sanitizeValue({
    ...(bindings || {}),
    ...(event?.context && typeof event.context === 'object' ? event.context : {})
  });
  return {
    timestamp: event?.timestamp || new Date(state.now()).toISOString(),
    runId: String(event?.runId || 'system'),
    integrationId: state.integrationId,
    level,
    eventType: String(event?.eventType || LOG_EVENT_TYPES.PHASE),
    message,
    context
  };
}

function normalizeLevel(level) {
  const normalized = String(level || LOG_LEVELS.INFO).toUpperCase();
  return LEVEL_PRIORITY[normalized] ? normalized : LOG_LEVELS.INFO;
}

function shouldEmitDebug(line) {
  return line.level !== LOG_LEVELS.DEBUG;
}

function formatRunLine(line) {
  const suffix = line.context && Object.keys(line.context).length > 0 ? ` ${JSON.stringify(line.context)}` : '';
  return `[${line.level}] ${line.message}${suffix}`;
}

async function emitRunLine(state, line) {
  if (!shouldEmitDebug(line)) {
    return;
  }
  if (!state.run || typeof state.run.appendLog !== 'function') {
    return;
  }

  try {
    await state.run.appendLog(formatRunLine(line));
  } catch {}
}

function formatConsoleLine(line) {
  const suffix = line.context && Object.keys(line.context).length > 0 ? ` ${JSON.stringify(line.context)}` : '';
  return `${line.timestamp} [entra-id][${line.level}] ${line.message}${suffix}`;
}

async function emitConsoleLine(state, line) {
  if (line.level === LOG_LEVELS.DEBUG && !state.diagnosticEnabled) {
    return;
  }

  const message = formatConsoleLine(line);
  const hostLogger = state.hostLogger;
  try {
    if (hostLogger && typeof hostLogger === 'object') {
      const method =
        line.level === LOG_LEVELS.ERROR
          ? hostLogger.error
          : line.level === LOG_LEVELS.WARN
          ? hostLogger.warn
          : line.level === LOG_LEVELS.DEBUG
          ? hostLogger.debug || hostLogger.info
          : hostLogger.info;
      if (typeof method === 'function') {
        await method.call(hostLogger, message);
        return;
      }
    }

    const writer =
      line.level === LOG_LEVELS.ERROR
        ? console.error
        : line.level === LOG_LEVELS.WARN
        ? console.warn
        : console.log;
    writer(message);
  } catch {}
}

async function emitDiagnosticFileLine(state, line) {
  if (line.level === LOG_LEVELS.DEBUG && !state.diagnosticEnabled) {
    return;
  }

  try {
    await reportDiagnosticFileEnabled(state, line);
    await appendDiagnosticFileLine(state, line);
  } catch (error) {
    await emitDiagnosticFileFailure(state, line, error);
  }
}

async function reportDiagnosticFileEnabled(state, line) {
  const filePath = getDiagnosticFilePath(state);
  if (state.diagnosticFileEnabledReported || ANNOUNCED_FILE_PATHS.has(filePath)) {
    state.diagnosticFileEnabledReported = true;
    return;
  }

  state.diagnosticFileEnabledReported = true;
  ANNOUNCED_FILE_PATHS.add(filePath);
  const enabledLine = buildLine({
    state,
    bindings: {},
    level: LOG_LEVELS.INFO,
    event: {
      runId: line.runId,
      eventType: LOG_EVENT_TYPES.PHASE,
      level: LOG_LEVELS.INFO,
      timestamp: line.timestamp,
      message: `[Integration:entra-id] Runtime log file: ${filePath}`,
      context: {}
    }
  });

  await emitConsoleLine(state, enabledLine);
  await appendDiagnosticFileLine(state, enabledLine);
}

async function appendDiagnosticFileLine(state, line) {
  const filePath = getDiagnosticFilePath(state);
  const text = `${formatConsoleLine(line)}\n`;
  await state.fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  await rotateFileIfNeeded(state.fileSystem, filePath, Buffer.byteLength(text, 'utf8'), state.maxFileBytes, state.maxBackups);
  await state.fileSystem.appendFile(filePath, text, 'utf8');
}

async function emitDiagnosticFileFailure(state, line, error) {
  const filePath = getDiagnosticFilePath(state);
  if (state.fileFailureReported || FILE_FAILURE_PATHS.has(filePath)) {
    state.fileFailureReported = true;
    return;
  }
  state.fileFailureReported = true;
  FILE_FAILURE_PATHS.add(filePath);
  await emitConsoleLine(state, buildLine({
    state,
    bindings: {},
    level: LOG_LEVELS.WARN,
    event: {
      runId: line.runId,
      eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
      level: LOG_LEVELS.WARN,
      message: '[Integration:entra-id] Runtime log file unavailable',
      context: {
        filePath,
        reason: sanitizeText(error?.message || 'file_logging_failed')
      }
    }
  }));
}

function getDiagnosticFilePath(state) {
  return path.join(state.logDir, state.fileName);
}

async function rotateFileIfNeeded(fileSystem, filePath, incomingBytes, maxFileBytes, maxBackups) {
  let stats = null;
  try {
    stats = await fileSystem.stat(filePath);
  } catch {
    return;
  }

  const currentSize = Number(stats?.size || 0);
  if (currentSize + incomingBytes <= maxFileBytes) {
    return;
  }

  for (let index = maxBackups; index >= 1; index -= 1) {
    const source = index === 1 ? filePath : `${filePath}.${index - 1}`;
    const target = `${filePath}.${index}`;
    try {
      await fileSystem.rm(target, { force: true });
    } catch {}
    try {
      await fileSystem.rename(source, target);
    } catch {}
  }
}

module.exports = {
  DEFAULT_FILE_NAME,
  LOG_LEVELS,
  LOG_EVENT_TYPES,
  createMarketplaceRunLogger,
  resolveDiagnosticLogDir,
  resolveDiagnosticLogFilePath,
  sanitizeText,
  sanitizeValue
};
