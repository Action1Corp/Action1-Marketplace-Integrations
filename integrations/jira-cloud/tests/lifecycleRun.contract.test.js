const assert = require('assert');

const { createLifecycleRunService } = require('../lifecycleRunService');

function endpointCandidate() {
  return {
    identity: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      key: 'map-1|endpoint-1|OFFLINE'
    },
    routing: {
      action1OrgId: 'org-1',
      action1OrgName: 'Org One',
      jiraProjectId: '1001',
      jiraProjectKey: 'OPS',
      jiraProjectName: 'Operations',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug'
    },
    signal: {
      type: 'OFFLINE',
      reason: 'offline_threshold_met'
    },
    endpoint: {
      id: 'endpoint-1',
      name: 'BoxOne',
      lastSeenAt: '2026-06-18T10:15:00Z'
    }
  };
}

function groupedCandidate() {
  return {
    ticketModel: 'grouped',
    identity: {
      orgLinkId: 'map-1',
      signalType: 'VULNERABILITY',
      identityKey: 'map-1|VULNERABILITY|CVE-1'
    },
    issueKey: 'CVE-1',
    routing: {
      action1OrgId: 'org-1',
      action1OrgName: 'Org One',
      jiraProjectId: '1001',
      jiraProjectKey: 'OPS',
      jiraProjectName: 'Operations',
      jiraIssueTypeId: '10001',
      jiraIssueTypeName: 'Bug'
    },
    signal: {
      type: 'VULNERABILITY',
      reason: 'matched'
    },
    grouped: {
      issueKey: 'CVE-1',
      issueMetadata: {
        cveId: 'CVE-1',
        cvssScore: '8.8'
      },
      impactedEndpointCount: 1,
      impactedEndpoints: [{ endpointId: 'ep-1', endpointName: 'BoxOne', endpoint: { id: 'ep-1', name: 'BoxOne' } }]
    }
  };
}

function createHarness(overrides = {}) {
  const calls = {
    createIssue: [],
    getIssue: [],
    updateIssue: [],
    upsertCorrelation: [],
    upsertGroupedCorrelation: [],
    listCorrelationsByOrgLink: [],
    logs: []
  };
  let correlation = overrides.correlation || null;
  let groupedCorrelation = overrides.groupedCorrelation || null;
  const listedCorrelationsByOrg = overrides.listedCorrelationsByOrg || {};
  let createdCounter = 0;

  const jiraApi = {
    async createIssue(payload) {
      calls.createIssue.push(payload);
      createdCounter += 1;
      return {
        id: String(10000 + createdCounter),
        key: `OPS-${createdCounter}`,
        self: `https://example.atlassian.net/rest/api/3/issue/${10000 + createdCounter}`,
        browseUrl: `https://example.atlassian.net/browse/OPS-${createdCounter}`,
        statusName: 'To Do',
        statusCategoryKey: 'new',
        completed: false
      };
    },
    async getIssue(issueIdOrKey) {
      calls.getIssue.push(issueIdOrKey);
      if (typeof overrides.getIssue === 'function') {
        return overrides.getIssue(issueIdOrKey, calls);
      }
      if (Object.prototype.hasOwnProperty.call(overrides, 'getIssueResult')) {
        return overrides.getIssueResult;
      }
      return issueIdOrKey
        ? {
            id: '10001',
            key: 'OPS-1',
            self: 'https://example.atlassian.net/rest/api/3/issue/10001',
            browseUrl: 'https://example.atlassian.net/browse/OPS-1',
            statusName: 'To Do',
            statusCategoryKey: 'new',
            completed: false
          }
        : null;
    },
    async updateIssue(issueIdOrKey, payload) {
      calls.updateIssue.push({ issueIdOrKey, payload });
      return { ok: true };
    }
  };

  const correlationStore = {
    async getCorrelation() {
      return correlation;
    },
    async upsertCorrelation(record) {
      calls.upsertCorrelation.push(record);
      correlation = record;
    },
    async deleteCorrelation() {
      throw new Error('Jira MVP must not delete endpoint correlations for close behavior');
    },
    async listCorrelationsByOrgLink(orgLinkId) {
      calls.listCorrelationsByOrgLink.push(orgLinkId);
      return listedCorrelationsByOrg[orgLinkId] || [];
    },
    async getGroupedCorrelation() {
      return groupedCorrelation;
    },
    async upsertGroupedCorrelation(record) {
      calls.upsertGroupedCorrelation.push(record);
      groupedCorrelation = record;
    },
    async deleteGroupedCorrelation() {
      throw new Error('Jira MVP must not delete grouped correlations for close behavior');
    },
    async listGroupedCorrelationsByOrgLink() {
      return [];
    }
  };

  return {
    calls,
    runLogger: {
      async emit(event) {
        calls.logs.push(event);
      }
    },
    service: createLifecycleRunService({
      jiraApi,
      correlationStore,
      now: () => Date.parse('2026-06-25T12:00:00.000Z')
    })
  };
}

async function runCreateTest() {
  const { service, calls, runLogger } = createHarness();
  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    runLogger,
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.created, 1);
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.upsertCorrelation.length, 1);
  assert.strictEqual(calls.upsertCorrelation[0].jiraIssueId, '10001');
  assert.strictEqual(calls.upsertCorrelation[0].payloadHash.length > 0, true);
  assert.strictEqual(calls.logs.some((entry) => entry.message === 'Jira lifecycle decision.'), true, 'per-candidate lifecycle decisions should be logged');
}

async function runNoopOnUnchangedPayloadTest() {
  const candidate = endpointCandidate();
  const { buildJiraIssuePayload } = require('../issuePayloadBuilder');
  const rendered = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: rendered.payloadHash,
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    }
  });

  const out = await service.runOnce({
    candidates: [candidate],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.skipped, 1);
  assert.strictEqual(calls.getIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
  assert.strictEqual(calls.createIssue.length, 0);
}

async function runUpdateOnChangedPayloadTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.updated, 1);
  assert.strictEqual(calls.getIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 1);
  assert.strictEqual(calls.upsertCorrelation.length, 1);
}

async function runMissingLinkedIssueRecreatesTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    },
    getIssueResult: null
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.created, 1);
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
}

async function runSignalClearedNoCloseTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash'
    }
  });

  const out = await service.runOnce({
    candidates: [{ candidate: endpointCandidate(), signalQualifies: false }],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.skipped, 1);
  assert.strictEqual(calls.createIssue.length, 0);
  assert.strictEqual(calls.updateIssue.length, 0);
  assert.strictEqual(calls.upsertCorrelation.length, 0);
}

async function runGroupedCorrelationPathTest() {
  const { service, calls } = createHarness();
  const out = await service.runOnce({
    candidates: [groupedCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      maxImpactedEndpointsInGroupedTicket: 2
    }
  });

  assert.strictEqual(out.summary.created, 1);
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1);
  assert.strictEqual(calls.upsertCorrelation.length, 0);
}

async function runGroupedOpenUnchangedNoopTest() {
  const candidate = groupedCandidate();
  const { buildJiraIssuePayload } = require('../issuePayloadBuilder');
  const rendered = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0',
    maxImpactedEndpointsInGroupedTicket: 2
  });
  const { service, calls } = createHarness({
    groupedCorrelation: {
      orgLinkId: 'map-1',
      signalType: 'VULNERABILITY',
      issueKey: 'CVE-1',
      identityKey: 'map-1|VULNERABILITY|CVE-1',
      jiraIssueId: '20001',
      jiraIssueKey: 'OPS-200',
      payloadHash: rendered.payloadHash,
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    },
    getIssueResult: {
      id: '20001',
      key: 'OPS-200',
      self: 'https://example.atlassian.net/rest/api/3/issue/20001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-200',
      statusName: 'In Progress',
      statusCategoryKey: 'active-custom-key',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [candidate],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      maxImpactedEndpointsInGroupedTicket: 2
    }
  });

  assert.strictEqual(out.summary.skipped, 1);
  assert.strictEqual(out.results[0].reason, 'OPEN_ISSUE_UNCHANGED');
  assert.strictEqual(calls.updateIssue.length, 0);
  assert.strictEqual(calls.createIssue.length, 0);
}

async function runGroupedOpenChangedUpdatesTest() {
  const { service, calls } = createHarness({
    groupedCorrelation: {
      orgLinkId: 'map-1',
      signalType: 'VULNERABILITY',
      issueKey: 'CVE-1',
      identityKey: 'map-1|VULNERABILITY|CVE-1',
      jiraIssueId: '20001',
      jiraIssueKey: 'OPS-200',
      payloadHash: 'old-hash',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    },
    getIssueResult: {
      id: '20001',
      key: 'OPS-200',
      self: 'https://example.atlassian.net/rest/api/3/issue/20001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-200',
      statusName: 'In Progress',
      statusCategoryKey: 'active-custom-key',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [groupedCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      maxImpactedEndpointsInGroupedTicket: 2
    }
  });

  assert.strictEqual(out.summary.updated, 1);
  assert.strictEqual(calls.updateIssue.length, 1);
  assert.strictEqual(calls.createIssue.length, 0);
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1);
}

async function runCompletedLinkedIssueCreatesNewTest() {
  const { service, calls, runLogger } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '99991',
      jiraIssueKey: 'OPS-999',
      payloadHash: 'old-hash',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    },
    getIssueResult: {
      id: '99991',
      key: 'OPS-999',
      self: 'https://example.atlassian.net/rest/api/3/issue/99991',
      browseUrl: 'https://example.atlassian.net/browse/OPS-999',
      statusName: 'Done',
      statusCategoryKey: 'done',
      completed: true
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    runLogger,
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      lifecycle: { createNewWhenLinkedClosed: true }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'completed linked issues should create a new Jira issue when create-new is enabled');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.getIssue.length, 1);
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
  assert.strictEqual(calls.upsertCorrelation.length, 1);
  assert.strictEqual(calls.upsertCorrelation[0].jiraIssueId, '10001');
  assert.strictEqual(calls.upsertCorrelation[0].jiraIssueKey, 'OPS-1');
  assert.strictEqual(out.results[0].issueKey, 'OPS-1');
  assert.strictEqual(calls.upsertCorrelation[0].jiraIssueKey === 'OPS-999', false, 'correlation should be rewritten to the newly created Jira issue');
  const decisionLog = calls.logs.find((entry) => entry.message === 'Jira lifecycle decision.');
  assert(decisionLog, 'completed linked issues should emit a lifecycle decision log');
  assert.strictEqual(decisionLog.context.identityKey, 'map-1|endpoint-1|OFFLINE');
  assert.strictEqual(decisionLog.context.ticketModel, 'endpoint');
  assert.strictEqual(decisionLog.context.signalType, 'OFFLINE');
  assert.strictEqual(decisionLog.context.correlationFound, true);
  assert.strictEqual(decisionLog.context.linkedIssueId, '99991');
  assert.strictEqual(decisionLog.context.linkedIssueKey, 'OPS-999');
  assert.strictEqual(decisionLog.context.linkedIssueRead, 'ok');
  assert.strictEqual(decisionLog.context.linkedIssueStatusName, 'Done');
  assert.strictEqual(decisionLog.context.linkedIssueStatusCategoryKey, 'done');
  assert.strictEqual(decisionLog.context.linkedIssueCompleted, true);
  assert.strictEqual(decisionLog.context.decision, 'CREATE');
  assert.strictEqual(decisionLog.context.reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
}

async function runCompletedStatusCategoryKeyOverridesMissingCompletedBooleanTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash'
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'Done',
      statusCategoryKey: 'done',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      lifecycle: { createNewWhenLinkedClosed: true }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'statusCategory.key done should still recreate even if the boolean completion flag is missing or stale');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
}

async function runCompletedStatusCategoryCompletedStillRecreatesTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash'
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'Completed',
      statusCategoryKey: 'completed',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      lifecycle: { createNewWhenLinkedClosed: true }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'statusCategory.key completed should still recreate even if the boolean completion flag is missing or stale');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
}

async function runCompletedLinkedIssueStillCreatesWhenLegacyFlagDisabledTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash'
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'Resolved',
      statusCategoryKey: 'completed',
      completed: true
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      lifecycle: { createNewWhenLinkedClosed: false }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'completed linked issues should still create a new Jira issue even if a legacy create-new flag is false');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
}

async function runCompletedLinkedIssueIgnoresOpenIssueSkipBehaviorTest() {
  const candidate = endpointCandidate();
  const { buildJiraIssuePayload } = require('../issuePayloadBuilder');
  const rendered = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: rendered.payloadHash
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'Completed',
      statusCategoryKey: 'done',
      completed: true
    }
  });

  const out = await service.runOnce({
    candidates: [candidate],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      lifecycle: {
        existingOpenIssueBehavior: 'skip_existing_open',
        createNewWhenLinkedClosed: false
      }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'completed linked issues should bypass open-issue skip behavior and recreate');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
}

async function runStatusNameDoesNotOverrideOpenCategoryTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: 'old-hash'
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'Done',
      statusCategoryKey: 'active-custom-key',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.updated, 1, 'workflow-specific status names must not force completed handling when statusCategory.key is any other non-completed key');
  assert.strictEqual(calls.createIssue.length, 0);
  assert.strictEqual(calls.updateIssue.length, 1);
}

async function runMissingStatusCategoryStaysOpenTest() {
  const candidate = endpointCandidate();
  const { buildJiraIssuePayload } = require('../issuePayloadBuilder');
  const rendered = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: rendered.payloadHash
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'Customer Complete',
      statusCategoryKey: '',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [candidate],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.skipped, 1, 'missing status category metadata should fail safely as open/active');
  assert.strictEqual(out.results[0].reason, 'OPEN_ISSUE_UNCHANGED');
  assert.strictEqual(calls.createIssue.length, 0);
  assert.strictEqual(calls.updateIssue.length, 0);
}

async function runGroupedCompletedLinkedIssueCreatesNewTest() {
  const { service, calls } = createHarness({
    groupedCorrelation: {
      orgLinkId: 'map-1',
      signalType: 'VULNERABILITY',
      issueKey: 'CVE-1',
      identityKey: 'map-1|VULNERABILITY|CVE-1',
      jiraIssueId: '20001',
      jiraIssueKey: 'OPS-200',
      payloadHash: 'old-hash',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    },
    getIssueResult: {
      id: '20001',
      key: 'OPS-200',
      self: 'https://example.atlassian.net/rest/api/3/issue/20001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-200',
      statusName: 'Customer Closed',
      statusCategoryKey: 'done',
      completed: true
    }
  });

  const out = await service.runOnce({
    candidates: [groupedCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      maxImpactedEndpointsInGroupedTicket: 2
    }
  });

  assert.strictEqual(out.summary.created, 1, 'done grouped linked issues should create a new Jira issue');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1);
  assert.strictEqual(calls.upsertGroupedCorrelation[0].jiraIssueKey, 'OPS-1');
}

async function runGroupedCompletedStatusCategoryCompletedCreatesNewTest() {
  const { service, calls } = createHarness({
    groupedCorrelation: {
      orgLinkId: 'map-1',
      signalType: 'VULNERABILITY',
      issueKey: 'CVE-1',
      identityKey: 'map-1|VULNERABILITY|CVE-1',
      jiraIssueId: '20001',
      jiraIssueKey: 'OPS-200',
      payloadHash: 'old-hash',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z'
    },
    getIssueResult: {
      id: '20001',
      key: 'OPS-200',
      self: 'https://example.atlassian.net/rest/api/3/issue/20001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-200',
      statusName: 'Completed',
      statusCategoryKey: 'completed',
      completed: false
    }
  });

  const out = await service.runOnce({
    candidates: [groupedCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      maxImpactedEndpointsInGroupedTicket: 2
    }
  });

  assert.strictEqual(out.summary.created, 1, 'completed grouped linked issues should create a new Jira issue');
  assert.strictEqual(out.results[0].reason, 'LINKED_ISSUE_COMPLETED_CREATE_NEW');
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(calls.updateIssue.length, 0);
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1);
}

async function runMaxOpenIssuesSafeguardTest() {
  const existingOpen = {
    mode: 'endpoint',
    orgLinkId: 'map-1',
    endpointId: 'other-endpoint',
    signalType: 'OFFLINE',
    jiraIssueId: 'OPS-99',
    jiraIssueKey: 'OPS-99'
  };
  const { service, calls } = createHarness({
    listedCorrelationsByOrg: {
      'map-1': [existingOpen]
    },
    getIssue(issueIdOrKey) {
      if (issueIdOrKey === 'OPS-99') {
        return {
          id: '9999',
          key: 'OPS-99',
          self: 'https://example.atlassian.net/rest/api/3/issue/9999',
          statusName: 'In Progress',
          statusCategoryKey: 'active-custom-key',
          completed: false
        };
      }
      return null;
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      operationalSafeguards: { maxOpenTicketsPerOrganization: 1 }
    }
  });

  assert.strictEqual(out.summary.skipped, 1, 'max open issues safeguard should skip creates when the org limit is reached');
  assert.strictEqual(out.results[0].reason, 'ORG_OPEN_TICKET_LIMIT_REACHED');
  assert.strictEqual(calls.listCorrelationsByOrgLink.length > 0, true, 'create guard should inspect stored correlations by org');
  assert.strictEqual(calls.createIssue.length, 0);
}

async function runCompletedIssuesDoNotCountAgainstMaxOpenTest() {
  const existingCompleted = {
    mode: 'endpoint',
    orgLinkId: 'map-1',
    endpointId: 'other-endpoint',
    signalType: 'OFFLINE',
    jiraIssueId: 'OPS-99',
    jiraIssueKey: 'OPS-99'
  };
  const { service, calls } = createHarness({
    listedCorrelationsByOrg: {
      'map-1': [existingCompleted]
    },
    getIssue(issueIdOrKey) {
      if (issueIdOrKey === 'OPS-99') {
        return {
          id: '9999',
          key: 'OPS-99',
          self: 'https://example.atlassian.net/rest/api/3/issue/9999',
          statusName: 'Resolved',
          statusCategoryKey: 'completed',
          completed: true
        };
      }
      return null;
    }
  });

  const out = await service.runOnce({
    candidates: [endpointCandidate()],
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } },
      operationalSafeguards: { maxOpenTicketsPerOrganization: 1 }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'completed linked issues must not count against the max-open safeguard');
  assert.strictEqual(calls.createIssue.length, 1);
}

async function runSummaryReasonBreakdownLoggingTest() {
  const { buildJiraIssuePayload } = require('../issuePayloadBuilder');
  const candidate = endpointCandidate();
  const rendered = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const { service, runLogger } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      payloadHash: rendered.payloadHash
    },
    getIssueResult: {
      id: '10001',
      key: 'OPS-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      browseUrl: 'https://example.atlassian.net/browse/OPS-1',
      statusName: 'In Progress',
      statusCategoryKey: 'active-custom-key',
      completed: false
    }
  });
  const logs = [];
  runLogger.emit = async (event) => logs.push(event);

  await service.runOnce({
    candidates: [
      {
        candidate,
        signalQualifies: true
      },
      {
        candidate: {
          ...candidate,
          identity: {
            ...candidate.identity,
            endpointId: 'endpoint-2',
            key: 'map-1|endpoint-2|OFFLINE'
          },
          endpoint: {
            ...candidate.endpoint,
            id: 'endpoint-2',
            name: 'BoxTwo'
          }
        },
        signalQualifies: false
      }
    ],
    runLogger,
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  const summaryLog = logs.find((entry) => entry.message === 'Jira lifecycle reason summary.');
  assert(summaryLog, 'run-level lifecycle reason summaries should be logged');
  assert.strictEqual(typeof summaryLog.context.skippedByReason, 'object');
  assert.strictEqual(typeof summaryLog.context.bySignalAndReason, 'object');
  assert.strictEqual(summaryLog.context.skippedByReason.OPEN_ISSUE_UNCHANGED >= 0, true);
  assert.strictEqual(summaryLog.context.bySignalAndReason.OFFLINE.SIGNAL_CLEARED_NO_ACTION >= 1, true);
  assert.strictEqual(rendered.payloadHash.length > 0, true);
}

async function run() {
  await runCreateTest();
  await runNoopOnUnchangedPayloadTest();
  await runUpdateOnChangedPayloadTest();
  await runMissingLinkedIssueRecreatesTest();
  await runSignalClearedNoCloseTest();
  await runGroupedCorrelationPathTest();
  await runGroupedOpenUnchangedNoopTest();
  await runGroupedOpenChangedUpdatesTest();
  await runCompletedLinkedIssueCreatesNewTest();
  await runCompletedStatusCategoryKeyOverridesMissingCompletedBooleanTest();
  await runCompletedStatusCategoryCompletedStillRecreatesTest();
  await runCompletedLinkedIssueStillCreatesWhenLegacyFlagDisabledTest();
  await runCompletedLinkedIssueIgnoresOpenIssueSkipBehaviorTest();
  await runStatusNameDoesNotOverrideOpenCategoryTest();
  await runMissingStatusCategoryStaysOpenTest();
  await runGroupedCompletedLinkedIssueCreatesNewTest();
  await runGroupedCompletedStatusCategoryCompletedCreatesNewTest();
  await runMaxOpenIssuesSafeguardTest();
  await runCompletedIssuesDoNotCountAgainstMaxOpenTest();
  await runSummaryReasonBreakdownLoggingTest();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
