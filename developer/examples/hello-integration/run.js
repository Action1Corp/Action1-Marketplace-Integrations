const {
  createRun,
  appendRunLog,
  completeRun,
  failRun
} = require('../../../sdk');

async function runSync(context) {
  const runId = await createRun(context);
  let details = 'Started run\n';

  try {
    details = await appendRunLog(context, runId, details, 'Hello Integration run example started.');
    details = await appendRunLog(context, runId, details, 'No vendor data is fetched by this example.');
    await completeRun(context, runId, details, 0);
  } catch (error) {
    await failRun(context, runId, details, error);
  }
}

module.exports = {
  runSync
};
