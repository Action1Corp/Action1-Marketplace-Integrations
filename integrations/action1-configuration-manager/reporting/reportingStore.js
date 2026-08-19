const TABLE = 'action1_configuration_manager_reporting';
const KEYS = ['dataSourceId', 'byEndpoint', 'details', 'byControl', 'byPolicy', 'byStatus'];

function normalize(row) {
  const result = {};
  for (const key of KEYS) result[key] = row?.[key === 'dataSourceId' ? 'data_source_id' : `report_${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`] || null;
  return result;
}
async function load(context) {
  return normalize(await context.db.get(`SELECT data_source_id, report_by_endpoint, report_details, report_by_control, report_by_policy, report_by_status FROM ${TABLE} WHERE singleton_id = 1`));
}
async function save(context, state) {
  const current = await load(context);
  const next = { ...current, ...state };
  if (Object.values(current).every(value => value === null)) {
    await context.db.run(`INSERT INTO ${TABLE} (singleton_id, data_source_id, report_by_endpoint, report_details, report_by_control, report_by_policy, report_by_status) VALUES (1, ?, ?, ?, ?, ?, ?)`, [next.dataSourceId, next.byEndpoint, next.details, next.byControl, next.byPolicy, next.byStatus]);
  } else {
    await context.db.run(`UPDATE ${TABLE} SET data_source_id = ?, report_by_endpoint = ?, report_details = ?, report_by_control = ?, report_by_policy = ?, report_by_status = ?, updated_at = CURRENT_TIMESTAMP WHERE singleton_id = 1`, [next.dataSourceId, next.byEndpoint, next.details, next.byControl, next.byPolicy, next.byStatus]);
  }
  return next;
}
module.exports = { KEYS, load, save };
