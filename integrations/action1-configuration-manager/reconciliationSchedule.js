const INTEGRATION_ID = 'action1-configuration-manager';
const SCHEDULE_KEY = `CronSchedule_${INTEGRATION_ID}`;
const TIMEZONE_KEY = `CronTimezone_${INTEGRATION_ID}`;
const SCHEDULE_EXPRESSION = '0 */6 * * *';

module.exports = { INTEGRATION_ID, SCHEDULE_EXPRESSION, SCHEDULE_KEY, TIMEZONE_KEY };
