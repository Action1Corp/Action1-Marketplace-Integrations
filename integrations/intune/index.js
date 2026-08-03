const { listDeviceGroups, validate, validateAssignments } = require('./validate');
const { sync } = require('./sync');

function summarizeValidationResult(result) {
  const checks = Object.values(result || {}).filter(value => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ok'));
  const ok = checks.length > 0 ? checks.every(check => check.ok !== false) : true;
  const message = checks.map(check => check.message).filter(Boolean).join(' | ') || (ok ? 'Validation completed.' : 'Validation failed.');
  return { ok, message, details: result };
}

async function validateConfiguration(context, request) {
  const result = await validate({
    settings: request.settings || {},
    action1: context.action1,
    logger: context.logger
  });
  return summarizeValidationResult(result);
}

async function syncAction(context) {
  await sync(context);
  const latestRun = await context.db.get(
    'SELECT id, status, details, assets_processed FROM sync_history WHERE integration_id = ? ORDER BY id DESC LIMIT 1',
    [context.integrationId]
  );
  const failed = latestRun?.status === 'Failed' || latestRun?.status === 'Interrupted';
  return {
    ok: !failed,
    message: failed ? 'Sync failed.' : 'Sync completed.',
    details: latestRun?.details || '',
    runId: latestRun?.id || null,
    assetsProcessed: latestRun?.assets_processed || 0
  };
}

async function listDeviceGroupsAction(context, request) {
  const groups = await listDeviceGroups(request.settings || {});
  return {
    ok: true,
    message: `Loaded ${groups.length} Intune device group${groups.length === 1 ? '' : 's'}.`,
    groups
  };
}

async function validateAssignmentsAction(context, request) {
  const result = await validateAssignments(request.settings || {});
  return {
    ...result,
    details: result
  };
}

module.exports = {
  actions: {
    'validate-configuration': validateConfiguration,
    'list-device-groups': listDeviceGroupsAction,
    'validate-assignments': validateAssignmentsAction,
    sync: syncAction
  }
};
