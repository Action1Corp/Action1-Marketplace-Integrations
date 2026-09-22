function normalizeDebugLoggingEnabled(value) {
  return value === true || value === 1 || ['true', '1'].includes(String(value ?? '').trim().toLowerCase());
}

module.exports = { normalizeDebugLoggingEnabled };
