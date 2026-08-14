function parseLocalDateTime(dateValue, timeValue) {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) && time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error('Local schedule date and time must use YYYY-MM-DD and HH:mm.');
  const [, year, month, day] = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [, hours, minutes] = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return { year: Number(year), month: Number(month), day: Number(day), hours: Number(hours), minutes: Number(minutes) };
}

function formatParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function offsetMinutesAt(date, timeZone) {
  const parts = formatParts(date, timeZone);
  const renderedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((renderedAsUtc - date.getTime()) / 60000);
}

function localDateTimeToUtc(dateValue, timeValue, timeZone) {
  const local = parseLocalDateTime(dateValue, timeValue);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hours, local.minutes, 0);
  const firstGuess = new Date(localAsUtc);
  const firstOffset = offsetMinutesAt(firstGuess, timeZone);
  const firstUtc = new Date(localAsUtc - firstOffset * 60000);
  const finalOffset = offsetMinutesAt(firstUtc, timeZone);
  return new Date(localAsUtc - finalOffset * 60000);
}

function formatUtcSchedule(dateValue, timeValue, timeZone) {
  const utc = localDateTimeToUtc(dateValue, timeValue, timeZone);
  return {
    date: utc.toISOString().slice(0, 10),
    time: utc.toISOString().slice(11, 16),
    dateTime: utc
  };
}

function formatUtcOffset(dateValue, timeValue, timeZone) {
  const utc = localDateTimeToUtc(dateValue, timeValue, timeZone);
  const minutes = offsetMinutesAt(utc, timeZone);
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

module.exports = { formatUtcOffset, formatUtcSchedule, localDateTimeToUtc };
