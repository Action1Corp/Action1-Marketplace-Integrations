const assert = require('assert');
const { buildOverviewViewModel, getOverview } = require('../overviewService');

function policy(policyId, organizationId) {
  return {
    policyId,
    baseName: `Policy ${policyId}`,
    organizationId,
    scopeType: 'ALL_ENDPOINTS',
    enabled: true,
    selectedControls: [{ controlId: 'control-1' }]
  };
}

function action1Error(statusCode, operation = 'report-data') {
  const error = new Error('Action1 discovery request failed.');
  error.statusCode = statusCode;
  error.diagnostics = { operation, statusCode, requestPath: '/reportdata/org/report/data' };
  return error;
}

function makeOptions(policies, failedOrganizations = new Map(), logs = [], operationType = 'initial-load') {
  const reads = [];
  const requeries = [];
  const readCounts = new Map();
  return {
    reads,
    requeries,
    options: {
      operationType,
      refreshIntervalMs: 0,
      refreshTimeoutMs: 10,
      sleep: async () => {},
      policyStore: { async listPolicies() { return policies; } },
      reportingState: { dashboardEndpoints: 'endpoints', dashboardNonCompliantEndpoints: 'attention', dashboardNonCompliantControls: 'controls' },
      client: {
        async resolveAction1ConsoleOrigin() { return 'https://app.action1.com'; },
        async listManagedEndpoints(organizationId) { return [{ id: `${organizationId}-endpoint`, name: `${organizationId}-endpoint`, platform: 'Windows' }]; },
        async listReportData(organizationId, reportId, pageOptions) {
          reads.push(`${organizationId}:${reportId}`);
          const failure = failedOrganizations.get(organizationId);
          const readKey = `${organizationId}:${reportId}`;
          readCounts.set(readKey, (readCounts.get(readKey) || 0) + 1);
          if (failure && (!failure.reportId || failure.reportId === reportId)
            && (failure.phase !== 'poll' || readCounts.get(readKey) > 1)
            && failure.phase !== 'requery') throw failure.error;
          pageOptions?.onPage({ page: 1, statusCode: 200, rowCount: 1, totalLiveResponses: 1, totalSentRequests: 1, lastRequery: 'current' });
          if (reportId === 'controls') return [{ 'Policy ID': policies.find((item) => item.organizationId === organizationId).policyId, 'Policy Name': 'Policy', 'Control Name': `Control ${organizationId}`, Details: 1 }];
          return [{ 'Policy ID': policies.find((item) => item.organizationId === organizationId).policyId, 'Policy Name': 'Policy', 'Endpoint Name': `${organizationId}-endpoint`, Details: 1 }];
        },
        async requestAction1Mutation(input) {
          requeries.push(input);
          const failure = failedOrganizations.get(input.organizationId);
          if (failure?.phase === 'requery') throw failure.error;
        }
      },
      context: undefined
    }
  };
}

async function run() {
  const policies = [policy('POL-A1', 'org-a'), policy('POL-A2', 'org-a'), policy('POL-B1', 'org-b')];
  const logs = [];
  const fixture = makeOptions(policies, new Map([['org-a', { error: action1Error(500) }]]), logs);
  const context = { action1ConfigurationManagerRuntimeLogger: { async info(message) { logs.push(`INFO ${message}`); }, async warn(message) { logs.push(`WARN ${message}`); }, async error(message) { logs.push(`ERROR ${message}`); }, async debug(message) { logs.push(`DEBUG ${message}`); } } };
  const result = await getOverview(context, fixture.options);

  assert.strictEqual(result.summary.activePoliciesCount, 3, 'enabled-policy count must include unavailable policies');
  assert.deepStrictEqual(result.availability, { availablePoliciesCount: 1, unavailablePoliciesCount: 2, isPartial: true });
  assert.strictEqual(result.summary.assignedCount, 1, 'only available organization endpoints contribute to aggregates');
  assert.strictEqual(result.summary.fullyEvaluatedCount, 1);
  assert.strictEqual(result.policies[0].dataStatus, 'unavailable');
  assert.strictEqual(result.policies[1].dataStatus, 'unavailable');
  for (const failed of result.policies.slice(0, 2)) {
    assert.strictEqual(failed.assignedCount, undefined);
    assert.strictEqual(failed.compliancePercent, undefined);
    assert.deepStrictEqual(failed.endpoints, [], 'unavailable policies must have no endpoint classifications');
  }
  assert.strictEqual(result.policies[2].dataStatus, 'available');
  assert.deepStrictEqual(result.topControlsNeedingAttention, [{ policyId: 'POL-B1', policyName: 'Policy', organizationId: 'org-b', controlName: 'Control org-b', affectedEndpointCount: 1 }]);
  assert(logs.some((line) => line.includes('organization=org-a') && line.includes('status=500') && line.includes('classification=http-server-error')));
  assert(!logs.some((line) => line.includes('responseExcerpt') || line.includes('authorization=')));

  const emptyData = buildOverviewViewModel({
    policies: [policy('POL-EMPTY', 'org-empty')],
    assignedEndpointsByPolicy: { 'POL-EMPTY': [{ id: 'empty-endpoint', name: 'empty-endpoint', platform: 'Windows' }] },
    observedRows: [],
    nonCompliantRows: []
  });
  assert.strictEqual(emptyData.policies[0].dataStatus, 'available');
  assert.strictEqual(emptyData.policies[0].noDataCount, 1, 'successful empty report remains NO_DATA');

  const allFailed = makeOptions([policy('POL-X', 'org-x'), policy('POL-Y', 'org-y')], new Map([
    ['org-x', { error: action1Error(500) }],
    ['org-y', { error: action1Error(500) }]
  ]));
  const allFailedError = await getOverview(context, allFailed.options).then(() => null, (error) => error);
  assert.match(allFailedError.message, /Action1 discovery request failed/);
  assert.strictEqual(allFailedError.statusCode, 500, 'all-failed outcome must preserve the Action1 HTTP error');

  const unauthorized = makeOptions([policy('POL-A', 'org-a'), policy('POL-B', 'org-b')], new Map([['org-a', { error: action1Error(401) }]]));
  await assert.rejects(() => getOverview(context, unauthorized.options), /Action1 discovery request failed/);

  const discoveryFailure = makeOptions([policy('POL-A', 'org-a'), policy('POL-B', 'org-b')]);
  discoveryFailure.options.client.listManagedEndpoints = async () => { throw new Error('endpoint discovery failed'); };
  await assert.rejects(() => getOverview(context, discoveryFailure.options), /endpoint discovery failed/);

  const refreshLogs = [];
  const refresh = makeOptions(policies, new Map([['org-a', { error: action1Error(500) }]]), refreshLogs, 'manual-refresh');
  const refreshed = await getOverview({ action1ConfigurationManagerRuntimeLogger: { async info() {}, async warn(message) { refreshLogs.push(message); }, async error(message) { refreshLogs.push(message); }, async debug() {} } }, refresh.options);
  assert.strictEqual(refreshed.availability.unavailablePoliciesCount, 2, 'manual refresh must apply the same organization availability rule');
  assert.strictEqual(refresh.requeries.length, 3, 'successful organizations retain existing requery behavior');

  const refreshFailure = makeOptions([policy('POL-R', 'org-r')], new Map([['org-r', { reportId: 'attention', error: action1Error(500, 'overview-dashboard-non-compliant-requery') }]]), [], 'manual-refresh');
  await assert.rejects(() => getOverview(context, refreshFailure.options), /Action1 discovery request failed/);

  for (const phase of ['requery', 'poll']) {
    const manualPartial = makeOptions(policies, new Map([['org-a', { phase, error: action1Error(500, `overview-${phase}`) }]]), [], 'manual-refresh');
    const manualResult = await getOverview(context, manualPartial.options);
    assert.strictEqual(manualResult.availability.unavailablePoliciesCount, 2, `manual Refresh ${phase} failures must invalidate the complete organization report set`);
    assert.strictEqual(manualResult.availability.availablePoliciesCount, 1);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
