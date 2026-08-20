function positiveInteger(value, field) {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(normalized) || normalized <= 0) throw new Error(`${field} must be a positive integer.`);
  return normalized;
}

function normalizeDateValue(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Start date must use YYYY-MM-DD.');
  return normalized;
}

function normalizeTimeValue(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (twelveHour) {
    let hours = Number(twelveHour[1]);
    const minutes = twelveHour[2];
    if (hours < 1 || hours > 12) throw new Error('Start time must be valid.');
    if (twelveHour[3] === 'AM' && hours === 12) hours = 0;
    if (twelveHour[3] === 'PM' && hours !== 12) hours += 12;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) throw new Error('Start time must use HH:mm.');
  return normalized;
}

function serializeAction1Time(value) {
  return `${normalizeTimeValue(value).replace(':', '-')}-00`;
}

function normalizeDeadlineValue(value, unit = 'minutes') {
  return positiveInteger(value, 'Completion deadline') * (unit === 'hours' ? 60 : 1);
}

function normalizeDeadlinePresentation(minutes) {
  const normalized = positiveInteger(minutes, 'Completion deadline');
  return normalized % 60 === 0 ? { value: normalized / 60, unit: 'hours' } : { value: normalized, unit: 'minutes' };
}

function isLocalEndpointTimeOption(value) {
  return String(value || '').trim() !== 'Local Endpoint Time';
}

module.exports = {
  isLocalEndpointTimeOption, normalizeDateValue, normalizeDeadlinePresentation,
  normalizeDeadlineValue, normalizeTimeValue, positiveInteger, serializeAction1Time
};
