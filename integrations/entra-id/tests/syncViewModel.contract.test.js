const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadSyncViewModel() {
  return import(pathToFileURL(path.join(__dirname, '..', 'syncViewModel.mjs')).href);
}

async function run() {
  const {
    buildSyncPageState,
    createEmptySummary,
    formatTrigger,
    parseSummary,
    selectLatestSyncRun
  } = await loadSyncViewModel();

  const settingsPayload = {
    settings: {
      EntraTenantId: 'tenant-1',
      EntraClientId: 'client-1',
      EntraGroupsCustomAttributeName: 'Entra Groups',
      EntraDeviceOwnershipCustomAttributeName: 'Entra Device Ownership'
    },
    storedSecrets: {
      EntraClientSecret: true
    }
  };

  const readyState = buildSyncPageState({
    settingsPayload,
    mappingCount: 1,
    historyRows: [],
    canWrite: true
  });

  assert.strictEqual(readyState.state.label, 'Never run', 'stored Entra secret markers should still produce a configured Sync state');
  assert.strictEqual(readyState.runDisabled, false, 'Run Sync should be enabled when settings and mappings are both ready');
  assert.strictEqual(readyState.effectiveSettings.EntraClientSecret, '***', 'Sync readiness should use the same secret-aware effective settings model as Settings');

  const missingSettingsState = buildSyncPageState({
    settingsPayload: {
      settings: {
        EntraTenantId: 'tenant-1'
      },
      storedSecrets: {}
    },
    mappingCount: 1,
    historyRows: [],
    canWrite: true
  });

  assert.strictEqual(missingSettingsState.state.label, 'Not configured', 'missing required Entra settings should keep Sync disabled');
  assert.strictEqual(missingSettingsState.runDisabled, true, 'Run Sync should remain disabled when required Entra settings are missing');

  const noMappingsState = buildSyncPageState({
    settingsPayload,
    mappingCount: 0,
    historyRows: [],
    canWrite: true
  });

  assert.strictEqual(noMappingsState.state.label, 'No mappings', 'missing mappings should be the next readiness gate after configuration');
  assert.strictEqual(noMappingsState.runDisabled, true, 'Run Sync should remain disabled until at least one Action1 organization is mapped');

  const runningRow = {
    id: 99,
    action_id: 'sync',
    action_label: 'Sync',
    status: 'Running',
    details: ''
  };
  const runningState = buildSyncPageState({
    settingsPayload,
    mappingCount: 1,
    historyRows: [runningRow],
    canWrite: true
  });
  assert.strictEqual(runningState.state.label, 'Running', 'an active tracked sync row should block overlapping runs');
  assert.strictEqual(runningState.runDisabled, true, 'Run Sync should be disabled while a run is already active');

  const summary = parseSummary(JSON.stringify({
    summary: {
      finalStatus: 'CompletedWithIssues',
      trigger: 'scheduled',
      endpointsSynchronized: 4
    }
  }));
  assert.strictEqual(summary.finalStatus, 'CompletedWithIssues', 'Sync summary parsing should preserve the persisted final status');
  assert.strictEqual(summary.trigger, 'scheduled', 'Sync summary parsing should preserve the persisted trigger');
  assert.strictEqual(summary.endpointsSynchronized, 4, 'Sync summary parsing should preserve the persisted compact metrics');
  assert.strictEqual(parseSummary({
    details: {
      summary: {
        finalStatus: 'Success',
        trigger: 'manual',
        mappedAction1OrganizationsProcessed: 7,
        endpointsSynchronized: 1,
        skipped: 76,
        failedEndpointUpdates: 0
      }
    }
  }).skipped, 76, 'Sync summary parsing should recover wrapped Marketplace details.summary payloads');
  assert.strictEqual(parseSummary('{not-json').finalStatus, '', 'Sync summary parsing should leave finalStatus empty when tracked-run details are malformed');

  const emptySummary = createEmptySummary();
  assert.strictEqual(emptySummary.trigger, '', 'empty Sync summary should not default a missing persisted trigger to Manual');
  assert.strictEqual(formatTrigger('scheduled'), 'Scheduled', 'formatTrigger should render a persisted scheduled trigger as Scheduled');
  assert.strictEqual(formatTrigger('manual'), 'Manual', 'formatTrigger should render a persisted manual trigger as Manual');
  assert.strictEqual(formatTrigger(''), 'Not recorded', 'formatTrigger should not mislabel a missing persisted trigger as Manual');

  const latestRun = selectLatestSyncRun([
    { id: 1, action_id: 'list-entra-org-mappings', status: 'Success' },
    { id: 2, action_id: 'sync', status: 'Success' }
  ]);
  assert.strictEqual(latestRun.id, 2, 'Sync selection should ignore non-sync Marketplace actions');
  const latestRunByTrackedLabel = selectLatestSyncRun([
    { id: 1, action_id: 'validate-configuration', action_label: 'Validate configuration', status: 'Success' },
    {
      id: 2,
      action_label: 'Run Entra Sync',
      status: 'Success',
      timestamp: '2026-07-15T10:15:00.000Z',
      details: JSON.stringify({
        details: {
          summary: {
            finalStatus: 'Success',
            trigger: 'manual',
            mappedAction1OrganizationsProcessed: 7,
            endpointsSynchronized: 1,
            skipped: 76,
            failedEndpointUpdates: 0
          }
        }
      })
    }
  ]);
  assert.strictEqual(latestRunByTrackedLabel.id, 2, 'Sync selection should recognize the tracked Entra sync label when Marketplace history does not provide action_id');

  const capturedSuccessfulDetails = [
    'Started Run Entra Sync',
    '21:27:49 - {"trigger":"manual"}',
    '21:27:49 - {"stage":"organization_mappings","count":7}',
    JSON.stringify({
      note: 'this line should be ignored because it is not a structured result payload'
    }),
    `21:27:50 - ${JSON.stringify({
      summary: {
        finalStatus: 'Success',
        trigger: 'manual',
        mappedAction1OrganizationsProcessed: 7,
        endpointsSynchronized: 1,
        skipped: 76,
        failedEndpointUpdates: 0
      },
      diagnostics: {
        stage: 'result_aggregation',
        code: 'sync_completed'
      },
      results: [
        {
          organizationName: 'Org One',
          patchesApplied: 1
        }
      ]
    })}`
  ].join('\n');
  const multilineSummary = parseSummary(capturedSuccessfulDetails);
  assert.strictEqual(multilineSummary.finalStatus, 'Success', 'Sync summary parsing should recover finalStatus from multiline Marketplace details');
  assert.strictEqual(multilineSummary.trigger, 'manual', 'Sync summary parsing should recover trigger from multiline Marketplace details');
  assert.strictEqual(multilineSummary.mappedAction1OrganizationsProcessed, 7, 'Sync summary parsing should recover organizations processed from multiline Marketplace details');
  assert.strictEqual(multilineSummary.endpointsSynchronized, 1, 'Sync summary parsing should recover synced totals from multiline Marketplace details');
  assert.strictEqual(multilineSummary.skipped, 76, 'Sync summary parsing should recover skipped totals from multiline Marketplace details');
  assert.strictEqual(multilineSummary.failedEndpointUpdates, 0, 'Sync summary parsing should recover failed totals from multiline Marketplace details');

  const completedStateWithoutSummary = buildSyncPageState({
    settingsPayload,
    mappingCount: 7,
    historyRows: [
      {
        id: 20,
        action_id: 'sync',
        action_label: 'Run Entra Sync',
        status: 'Success',
        timestamp: '2026-07-15T10:15:00.000Z',
        details: 'Started Run Entra Sync\n21:27:49 - {"trigger":"manual"}'
      }
    ],
    canWrite: true
  });
  assert.strictEqual(completedStateWithoutSummary.state.label, 'Success', 'Sync page state should fall back to the tracked row status when no persisted final summary exists');

  const capturedSuccessfulState = buildSyncPageState({
    settingsPayload,
    mappingCount: 7,
    historyRows: [
      {
        id: 21,
        action_id: 'sync',
        action_label: 'Run Entra Sync',
        status: 'Success',
        timestamp: '2026-07-15T10:15:00.000Z',
        details: capturedSuccessfulDetails
      }
    ],
    canWrite: true
  });
  assert.strictEqual(capturedSuccessfulState.state.label, 'Success', 'the captured successful Sync row should surface Success on the Sync page');
  assert.strictEqual(capturedSuccessfulState.latestSummary.trigger, 'manual', 'the captured successful Sync row should preserve the manual trigger');
  assert.strictEqual(capturedSuccessfulState.latestSummary.mappedAction1OrganizationsProcessed, 7, 'the captured successful Sync row should preserve the organizations total');
  assert.strictEqual(capturedSuccessfulState.latestSummary.endpointsSynchronized, 1, 'the captured successful Sync row should preserve the synced total');
  assert.strictEqual(capturedSuccessfulState.latestSummary.skipped, 76, 'the captured successful Sync row should preserve the skipped total');
  assert.strictEqual(capturedSuccessfulState.latestSummary.failedEndpointUpdates, 0, 'the captured successful Sync row should preserve the failed total');

  const capturedFailedState = buildSyncPageState({
    settingsPayload,
    mappingCount: 7,
    historyRows: [
      {
        id: 22,
        action_id: 'sync',
        action_label: 'Run Entra Sync',
        status: 'Failed',
        timestamp: '2026-07-15T10:25:00.000Z',
        details: [
          'Started Run Entra Sync',
          '21:32:10 - {"trigger":"manual"}',
          `21:32:11 - ${JSON.stringify({
            summary: {
              finalStatus: 'Failure',
              trigger: 'manual',
              mappedAction1OrganizationsProcessed: 7,
              endpointsSynchronized: 0,
              skipped: 76,
              failedEndpointUpdates: 1
            },
            diagnostics: {
              stage: 'endpoint_update',
              code: 'sync_failed'
            },
            results: [
              {
                organizationName: 'Org One',
                patchErrors: 1
              }
            ]
          })}`
        ].join('\n')
      }
    ],
    canWrite: true
  });
  assert.strictEqual(capturedFailedState.state.label, 'Failure', 'the captured failed Sync row should surface Failure on the Sync page');
  assert.strictEqual(capturedFailedState.latestSummary.trigger, 'manual', 'the captured failed Sync row should preserve the manual trigger');
  assert.strictEqual(capturedFailedState.latestSummary.mappedAction1OrganizationsProcessed, 7, 'the captured failed Sync row should preserve the organizations total');
  assert.strictEqual(capturedFailedState.latestSummary.endpointsSynchronized, 0, 'the captured failed Sync row should preserve the synced total');
  assert.strictEqual(capturedFailedState.latestSummary.skipped, 76, 'the captured failed Sync row should preserve the skipped total');
  assert.strictEqual(capturedFailedState.latestSummary.failedEndpointUpdates, 1, 'the captured failed Sync row should preserve the failed total');

  const completedWithIssuesState = buildSyncPageState({
    settingsPayload,
    mappingCount: 7,
    historyRows: [
      {
        id: 23,
        action_id: 'sync',
        action_label: 'Run Entra Sync',
        status: 'Success',
        timestamp: '2026-07-15T10:35:00.000Z',
        details: [
          'Started Run Entra Sync',
          '21:35:10 - {"trigger":"manual"}',
          `21:35:11 - ${JSON.stringify({
            summary: {
              finalStatus: 'CompletedWithIssues',
              trigger: 'manual',
              mappedAction1OrganizationsProcessed: 7,
              endpointsSynchronized: 0,
              skipped: 76,
              failedEndpointUpdates: 1
            },
            diagnostics: {
              stage: 'result_aggregation',
              code: 'sync_completed_with_issues'
            },
            results: [
              {
                organizationName: 'Org One',
                patchErrors: 1
              }
            ]
          })}`
        ].join('\n')
      }
    ],
    canWrite: true
  });
  assert.strictEqual(completedWithIssuesState.state.label, 'Completed with issues', 'the Sync page should render Completed with issues when the embedded Entra summary overrides a host Success row');
  assert.strictEqual(completedWithIssuesState.latestSummary.trigger, 'manual', 'the completed-with-issues Sync row should preserve the manual trigger');
  assert.strictEqual(completedWithIssuesState.latestSummary.mappedAction1OrganizationsProcessed, 7, 'the completed-with-issues Sync row should preserve the organizations total');
  assert.strictEqual(completedWithIssuesState.latestSummary.endpointsSynchronized, 0, 'the completed-with-issues Sync row should preserve the synced total');
  assert.strictEqual(completedWithIssuesState.latestSummary.skipped, 76, 'the completed-with-issues Sync row should preserve the skipped total');
  assert.strictEqual(completedWithIssuesState.latestSummary.failedEndpointUpdates, 1, 'the completed-with-issues Sync row should preserve the failed total');

  const completedState = buildSyncPageState({
    settingsPayload,
    mappingCount: 7,
    historyRows: [
      { id: 1, action_id: 'validate-configuration', status: 'Success' },
      {
        id: 2,
        action_label: 'Run Entra Sync',
        status: 'Success',
        timestamp: '2026-07-15T10:15:00.000Z',
        details: {
          details: {
            summary: {
              finalStatus: 'Success',
              trigger: 'manual',
              mappedAction1OrganizationsProcessed: 7,
              endpointsSynchronized: 1,
              skipped: 76,
              failedEndpointUpdates: 0
            }
          }
        }
      }
    ],
    canWrite: true
  });
  assert.strictEqual(completedState.state.label, 'Success', 'a completed tracked Entra sync row should replace the Never run fallback');
  assert.strictEqual(completedState.latestSummary.trigger, 'manual', 'Sync page state should preserve the persisted trigger from tracked-run details');
  assert.strictEqual(completedState.latestSummary.mappedAction1OrganizationsProcessed, 7, 'Sync page state should recover the persisted organizations total');
  assert.strictEqual(completedState.latestSummary.endpointsSynchronized, 1, 'Sync page state should recover the persisted synced total');
  assert.strictEqual(completedState.latestSummary.skipped, 76, 'Sync page state should recover the persisted skipped total');
  assert.strictEqual(completedState.latestSummary.failedEndpointUpdates, 0, 'Sync page state should recover the persisted failed total');
  assert.strictEqual(completedState.latestRunTimestampLabel, 'Started', 'Sync page state should label the generic Marketplace timestamp as Started when no finished timestamp is persisted');
  assert.strictEqual(completedState.runDisabled, false, 'a completed tracked Entra sync row should keep manual sync available');

  assert.deepStrictEqual(Object.keys(emptySummary).sort(), [
    'action1EndpointsEvaluated',
    'endpointsSynchronized',
    'entraDevicesEvaluated',
    'failedEndpointUpdates',
    'failedOrganizations',
    'finalStatus',
    'finishedAt',
    'mappedAction1OrganizationsProcessed',
    'skipped',
    'trigger'
  ], 'empty Sync summary should expose the approved Entra compact metric fields');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
