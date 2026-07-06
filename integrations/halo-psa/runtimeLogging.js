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
  CONNECTION_TEST: 'CONNECTION_TEST',
  DISCOVERY_FETCH: 'DISCOVERY_FETCH',
  LIFECYCLE_DECISION: 'LIFECYCLE_DECISION',
  TICKET_OPERATION: 'TICKET_OPERATION',
  HTTP_REQUEST: 'HTTP_REQUEST',
  RETRY: 'RETRY',
  SKIP: 'SKIP',
  PROVISIONING_ACTION: 'PROVISIONING_ACTION',
  PARTIAL_FAILURE: 'PARTIAL_FAILURE'
});

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 4;
const DEFAULT_FILE_NAME = 'halo-psa-runtime.log';
const DEFAULT_PACKAGE_LOG_DIR = path.resolve(__dirname, '.runtime-logs');
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
    lower.includes('x-tenant') ||
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
  if (/url|uri|path/i.test(keyText)) {
    return sanitizeUrl(value);
  }
  if (containsSecretLikeText(keyText)) {
    return '[redacted]';
  }
  return sanitizeValue(value);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
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
  if (String(env.HALO_PSA_LOG_DIR || '').trim()) {
    return path.resolve(String(env.HALO_PSA_LOG_DIR).trim());
  }
  if (String(env.DATA_DIR || '').trim()) {
    return path.resolve(String(env.DATA_DIR).trim(), 'halo-psa-logs');
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
    env.HALO_PSA_DIAGNOSTIC_LOGS,
    Boolean(options.diagnosticLoggingEnabled)
  );
  const diagnosticLogLevel = diagnosticEnabled ? 'detailed' : 'basic';

  return {
    integrationId: String(options.integrationId || 'halo-psa'),
    run: options.run || null,
    hostLogger: options.hostLogger || options.context?.logger || null,
    env,
    fileSystem,
    now,
    diagnosticEnabled,
    diagnosticLogLevel,
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

async function emitLog(event) {
  if (!event?.runLogger || typeof event.runLogger.emit !== 'function') {
    return;
  }

  await event.runLogger.emit({
    runId: String(event.runId || 'system'),
    level: event.level || LOG_LEVELS.INFO,
    eventType: event.eventType,
    message: String(event.message || ''),
    context: event.context && typeof event.context === 'object' ? sanitizeValue(event.context) : {}
  });
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
        state.diagnosticLogLevel = state.diagnosticEnabled ? 'detailed' : 'basic';
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
  return `${line.timestamp} [halo-psa][${line.level}] ${line.message}${suffix}`;
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
  if (!state.diagnosticEnabled) {
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
  if (state.diagnosticFileEnabledReported) {
    return;
  }

  state.diagnosticFileEnabledReported = true;
  const enabledLine = buildLine({
    state,
    bindings: {},
    level: LOG_LEVELS.INFO,
    event: {
      runId: line.runId,
      eventType: LOG_EVENT_TYPES.PHASE,
      level: LOG_LEVELS.INFO,
      timestamp: line.timestamp,
      message: 'HaloPSA diagnostic file logging enabled',
      context: {
        filePath: getDiagnosticFilePath(state)
      }
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
  if (state.fileFailureReported) {
    return;
  }
  state.fileFailureReported = true;
  await emitConsoleLine(state, buildLine({
    state,
    bindings: {},
    level: LOG_LEVELS.WARN,
    event: {
      runId: line.runId,
      eventType: LOG_EVENT_TYPES.PARTIAL_FAILURE,
      level: LOG_LEVELS.WARN,
      message: 'HaloPSA diagnostic file logging unavailable',
      context: {
        filePath: getDiagnosticFilePath(state),
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
  emitLog,
  resolveDiagnosticLogDir,
  resolveDiagnosticLogFilePath,
  sanitizeText,
  sanitizeValue
};
