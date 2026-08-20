const assert = require('assert');
const path = require('path');

function run() {
  const schedule = require(path.join(__dirname, '..', 'scheduleModel.cjs'));
  assert.strictEqual(schedule.normalizeDateValue('2026-08-13'), '2026-08-13');
  assert.strictEqual(schedule.normalizeTimeValue('03:07 PM'), '15:07');
  assert.strictEqual(schedule.normalizeTimeValue('15:07'), '15:07');
  assert.strictEqual(schedule.serializeAction1Time('15:07'), '15-07-00');
  assert.strictEqual(schedule.normalizeDeadlineValue(6, 'hours'), 360);
  assert.strictEqual(schedule.normalizeDeadlineValue(90, 'minutes'), 90);
  assert.strictEqual(schedule.normalizeDeadlinePresentation(360).unit, 'hours');
  assert.strictEqual(schedule.normalizeDeadlinePresentation(90).unit, 'minutes');
  assert.strictEqual(schedule.isLocalEndpointTimeOption('Local Endpoint Time'), false);
}

try { run(); } catch (error) { console.error(error); process.exit(1); }
