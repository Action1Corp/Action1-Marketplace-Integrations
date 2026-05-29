const {
  createSyncRun,
  appendSyncLog,
  completeSyncRun,
  failSyncRun
} = require('../../../sdk');

async function sync(context) {
  const runId = await createSyncRun(context);
  let details = 'Started run\n';

  try {
    details = await appendSyncLog(context, runId, details, 'Hello Integration run example started.');
    details = await appendSyncLog(context, runId, details, 'No vendor data is fetched by this example.');
    await completeSyncRun(context, runId, details, 0);
  } catch (error) {
    await failSyncRun(context, runId, details, error);
  }
}

module.exports = {
  sync
};
