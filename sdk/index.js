async function createRun(context, details = 'Started run') {
  const result = await context.db.run(
    'INSERT INTO sync_history (integration_id, status, details) VALUES (?, ?, ?)',
    [context.integrationId, 'Running', details]
  );
  return result.lastID;
}

async function appendRunLog(context, runId, currentDetails, message) {
  const nextDetails = `${currentDetails || ''}${new Date().toISOString().substring(11, 19)} - ${message}\n`;
  context.logger.info(message);
  await context.db.run('UPDATE sync_history SET details = ? WHERE id = ?', [nextDetails, runId]);
  return nextDetails;
}

async function completeRun(context, runId, details, assetsProcessed = 0) {
  await context.services.computeAndSaveRunMetrics(runId, context.integrationId);
  await context.db.run(
    'UPDATE sync_history SET status = ?, details = ?, assets_processed = ? WHERE id = ?',
    ['Success', details, assetsProcessed, runId]
  );
}

async function failRun(context, runId, details, error) {
  const message = error?.message || String(error);
  const nextDetails = `${details || ''}${new Date().toISOString().substring(11, 19)} - Error: ${message}\n`;
  await context.db.run(
    'UPDATE sync_history SET status = ?, details = ? WHERE id = ?',
    ['Failed', nextDetails, runId]
  );
  return nextDetails;
}

function getDataTables(context) {
  if (!context?.db?.tables) {
    throw new Error('Marketplace context does not expose integration data tables.');
  }
  return context.db.tables;
}

module.exports = {
  createRun,
  appendRunLog,
  completeRun,
  failRun,
  getDataTables
};
