const {
  deletePolicyAction,
  deleteTrackedPolicyAction,
  disablePolicyAction,
  enablePolicyAction,
  getPolicyAction,
  listPoliciesAction,
  savePolicyAction,
  setPolicyEnabledAction,
  createPolicyAction,
  updatePolicyAction
} = require('./policyActions');
const {
  discoverPolicyEndpointGroupsAction,
  discoverPolicyOrganizationsAction
} = require('./policyDiscoveryActions');
const { reconcilePoliciesAction } = require('./reconciliation');
const { getOverview } = require('./overviewService');
const { getReportingState, getReportingStatus, setupReporting } = require('./reporting/reportingService');
const { createHistoryEnvelope, resultDetails } = require('./historyContract');
const { loadControlPackArtifacts } = require('./controlPackResolver');
const { formatRuntimeElapsed, writeOperationalLog } = require('./runtimeLogging');

module.exports = {
  actions: {
    'get-control-pack': async (context) => {
      const startedAt = Date.now();
      await writeOperationalLog(context, 'info', 'Control Pack action started', { action: 'get-control-pack' });
      try {
        const resolved = loadControlPackArtifacts({ context });
        const baselines = resolved.baselinesArtifact.baselines || [];
        await writeOperationalLog(context, 'info', 'Control Pack action completed', { action: 'get-control-pack', version: resolved.packVersion, controls: resolved.catalog.controls?.length || 0, baselines: baselines.length, elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
        return { ok: true, packId: resolved.packId, packVersion: resolved.packVersion, catalog: resolved.catalog, baselines };
      } catch (error) {
        await writeOperationalLog(context, 'error', 'Control Pack action failed', { action: 'get-control-pack', error: String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240), elapsed: formatRuntimeElapsed(Date.now() - startedAt) });
        throw error;
      }
    },
    'list-policies': listPoliciesAction,
    'get-policy': getPolicyAction,
    'get-overview': async (context, request = {}) => {
      try {
        return { ok: true, overview: await getOverview(context, { operationType: request?.payload?.operationType }) };
      } catch (error) {
        return { ok: false, message: String(error?.message || 'Unable to load Configuration Manager Overview.').replace(/\s+/g, ' ').slice(0, 240) };
      }
    },
    'save-policy': savePolicyAction,
    'create-policy': createPolicyAction,
    'update-policy': updatePolicyAction,
    'set-policy-enabled': setPolicyEnabledAction,
    'disable-policy': disablePolicyAction,
    'enable-policy': enablePolicyAction,
    'delete-policy': deleteTrackedPolicyAction,
    'discover-policy-organizations': discoverPolicyOrganizationsAction,
    'discover-policy-endpoint-groups': discoverPolicyEndpointGroupsAction,
    'reconcile-policies': reconcilePoliciesAction,
    'get-reporting-state': async (context) => ({ ok: true, reporting: await getReportingState(context) }),
    'get-reporting-status': async (context) => ({ ok: true, reporting: await getReportingStatus(context) }),
    'setup-reporting': async (context, request) => {
      try {
        const result = await setupReporting(context, request);
        return { ...result, details: resultDetails(createHistoryEnvelope({ operation: 'REPORTING_SETUP', summary: 'Data source and reports configured' })) };
      } catch (error) {
        const message = String(error?.diagnostics?.errorMessage || error?.message || 'Reporting setup failed.').replace(/\s+/g, ' ').slice(0, 240);
        await writeOperationalLog(context, 'error', 'Reporting setup failed', { error: message });
        return { ok: false, message: 'Reporting setup failed', details: resultDetails(createHistoryEnvelope({ operation: 'REPORTING_SETUP', summary: 'Reporting setup failed' })) };
      }
    }
  }
};
