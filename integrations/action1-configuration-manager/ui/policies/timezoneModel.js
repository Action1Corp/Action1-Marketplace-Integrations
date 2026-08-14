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
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) throw new Error('Local schedule date and time must use YYYY-MM-DD and HH:mm.');
  const localAsUtc = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]), 0);
  const firstGuess = new Date(localAsUtc);
  const firstOffset = offsetMinutesAt(firstGuess, timeZone);
  const firstUtc = new Date(localAsUtc - firstOffset * 60000);
  const finalOffset = offsetMinutesAt(firstUtc, timeZone);
  return new Date(localAsUtc - finalOffset * 60000);
}

export function formatUtcOffset(dateValue, timeValue, timeZone) {
  const utc = localDateTimeToUtc(dateValue, timeValue, timeZone);
  const minutes = offsetMinutesAt(utc, timeZone);
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
