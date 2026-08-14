const assert = require('assert');
const path = require('path');

const { formatUtcOffset, formatUtcSchedule } = require(path.join(__dirname, '..', 'timezoneModel.cjs'));

assert.strictEqual(formatUtcOffset('2026-01-15', '12:00', 'America/Los_Angeles'), 'UTC-08:00');
assert.strictEqual(formatUtcOffset('2026-07-15', '12:00', 'America/Los_Angeles'), 'UTC-07:00');
assert.deepStrictEqual(
  { date: formatUtcSchedule('2026-08-13', '15:07', 'America/Los_Angeles').date, time: formatUtcSchedule('2026-08-13', '15:07', 'America/Los_Angeles').time },
  { date: '2026-08-13', time: '22:07' }
);
assert.deepStrictEqual(
  { date: formatUtcSchedule('2026-08-13', '23:30', 'America/Los_Angeles').date, time: formatUtcSchedule('2026-08-13', '23:30', 'America/Los_Angeles').time },
  { date: '2026-08-14', time: '06:30' }
);
assert.deepStrictEqual(
  { date: formatUtcSchedule('2026-08-13', '00:30', 'Asia/Tokyo').date, time: formatUtcSchedule('2026-08-13', '00:30', 'Asia/Tokyo').time },
  { date: '2026-08-12', time: '15:30' }
);
