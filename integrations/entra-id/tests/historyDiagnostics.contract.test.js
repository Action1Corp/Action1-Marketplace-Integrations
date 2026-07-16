const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadHistoryViewModel() {
  return import(pathToFileURL(path.join(__dirname, '..', 'historyViewModel.mjs')).href);
}

function buildPayload(overrides = {}) {
  return {
    summary: {
      finalStatus: 'CompletedWithIssues',
      trigger: 'manual',
      mappedAction1OrganizationsProcessed: 7,
      endpointsSynchronized: 0,
      skipped: 76,
      failedEndpointUpdates: 3,
      failedOrganizations: 1,
      ...overrides.summary
    },
    diagnostics: {
      stage: 'endpoint_update',
      code: 'sync_completed_with_issues',
      message: 'Sync completed with issues.',
      service: 'action1_api',
      httpStatus: 400,
      requestTarget: 'https://app.action1.com/api/3.0/endpoints/managed/org-1/endpoint-1',
      ...overrides.diagnostics
    },
    results: overrides.results || [
      {
        organizationId: 'org-1',
        organizationName: 'North America',
        patchErrors: [
          {
            endpointId: 'ep-1',
            endpointName: 'Laptop-01',
            error: "HTTP 400 Bad Request PATCH https://app.action1.com/api/3.0/endpoints/managed/org-1/endpoint-1 | Attribute name 'custom:Test Attribute 1' does not supported"
          },
          {
            endpointId: 'ep-2',
            endpointName: 'Laptop-02',
            error: "HTTP 400 Bad Request PATCH https://app.action1.com/api/3.0/endpoints/managed/org-1/endpoint-2 | Attribute name 'custom:Test Attribute 1' does not supported"
          }
        ]
      },
      {
        organizationId: 'org-2',
        organizationName: 'Europe',
        error: 'HTTP 429 Too Many Requests GET https://app.action1.com/api/3.0/organizations/org-2?access_token=super-secret-token'
      },
      {
        organizationId: 'org-3',
        organizationName: 'Asia',
        patchErrors: [
          {
            endpointId: 'ep-3',
            endpointName: 'Laptop-03',
            error: 'Authorization: Bearer super-secret-token PATCH https://app.action1.com/api/3.0/endpoints/managed/org-3/endpoint-3 payload={"owner":"alice"}'
          }
        ]
      }
    ]
  };
}

async function run() {
  const historyViewModel = await loadHistoryViewModel();

  const successSummary = historyViewModel.buildHistoryDiagnosticSummary(JSON.stringify({
    summary: {
      finalStatus: 'Success',
      endpointsSynchronized: 1,
      skipped: 2,
      failedEndpointUpdates: 0
    }
  }), 'Success');
  assert.strictEqual(successSummary, null, 'success rows without issues should not expose a diagnostic summary');

  const details = historyViewModel.buildHistoryDiagnosticSummary(JSON.stringify(buildPayload()), 'Success');
  assert(details, 'completed-with-issues rows should expose a diagnostic summary');
  assert.strictEqual(details.result, 'Completed with issues', 'diagnostic summaries should normalize the Entra result label');
  assert.strictEqual(details.failedEndpointUpdates, 3, 'diagnostic summaries should preserve failed endpoint totals');
  assert.strictEqual(details.failedOrganizations, 1, 'diagnostic summaries should preserve failed organization totals');
  assert.strictEqual(details.errorSummaries[0].text, 'Configured Action1 custom attribute was not found.', 'diagnostic summaries should normalize invalid custom-attribute errors');
  assert.strictEqual(details.errorSummaries[0].count, 2, 'diagnostic summaries should deduplicate repeated endpoint-level errors');
  assert.strictEqual(details.errorSummaries[1].text, 'Rate limit reached before the update could complete.', 'diagnostic summaries should normalize rate-limit errors');
  assert.strictEqual(details.errorSummaries[2].text, 'Action1 rejected an endpoint update request.', 'diagnostic summaries should sanitize unknown endpoint PATCH failures');
  assert.strictEqual(details.moreUniqueErrors, 0, 'diagnostic summaries should report no hidden unique errors when under the display cap');
  assert.strictEqual(details.copyText.includes('custom:Test Attribute 1'), false, 'copied diagnostic summaries should not expose custom attribute names');
  assert.strictEqual(details.copyText.includes('org-1'), false, 'copied diagnostic summaries should not expose organization identifiers');
  assert.strictEqual(details.copyText.includes('endpoint-1'), false, 'copied diagnostic summaries should not expose endpoint identifiers');
  assert.strictEqual(details.copyText.includes('super-secret-token'), false, 'copied diagnostic summaries should not expose secrets');
  assert.strictEqual(details.copyText.includes('payload={"owner":"alice"}'), false, 'copied diagnostic summaries should not expose raw payload values');

  const cappedDetails = historyViewModel.buildHistoryDiagnosticSummary(JSON.stringify(buildPayload({
    summary: {
      failedEndpointUpdates: 5,
      failedOrganizations: 0
    },
    results: [
      { patchErrors: [{ error: 'HTTP 400 invalid custom attribute' }] },
      { patchErrors: [{ error: 'HTTP 401 unauthorized token exchange' }] },
      { patchErrors: [{ error: 'HTTP 429 Too Many Requests' }] },
      { patchErrors: [{ error: 'PATCH https://app.action1.com/api/3.0/endpoints/managed/org-9/endpoint-9 failed with foo' }] }
    ]
  })), 'Success');
  assert.strictEqual(cappedDetails.errorSummaries.length, 3, 'diagnostic summaries should cap visible unique errors');
  assert.strictEqual(cappedDetails.moreUniqueErrors, 1, 'diagnostic summaries should report hidden unique errors beyond the cap');
  assert.strictEqual(cappedDetails.copyText.includes('And 1 more unique errors. Review the integration diagnostic log.'), true, 'copied diagnostic summaries should preserve the capped-error hint');

  const failureSummary = historyViewModel.buildHistoryDiagnosticSummary(JSON.stringify(buildPayload({
    summary: {
      finalStatus: 'Failure',
      failedEndpointUpdates: 0,
      failedOrganizations: 0
    },
    diagnostics: {
      stage: 'graph_authentication',
      code: 'ENTRA_HTTP_ERROR',
      service: 'microsoft_graph',
      httpStatus: 401,
      message: 'HTTP 401 from Microsoft Graph with bearer top-secret'
    },
    results: []
  })), 'Failed');
  assert(failureSummary, 'structured failure rows should expose a diagnostic summary');
  assert.strictEqual(failureSummary.result, 'Failure', 'diagnostic summaries should preserve run-level failures');
  assert.strictEqual(failureSummary.errorSummaries[0].text, 'Microsoft Graph authentication failed.', 'diagnostic summaries should normalize authentication failures');

  const legacySummary = historyViewModel.buildHistoryDiagnosticSummary('{not-json', 'Failed');
  assert.strictEqual(legacySummary, null, 'legacy rows without structured diagnostics should degrade safely');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
