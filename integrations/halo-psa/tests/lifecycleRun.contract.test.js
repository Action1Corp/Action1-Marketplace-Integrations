const assert = require('assert');

const { createLifecycleRunService } = require('../lifecycleRunService');
const { EXISTING_OPEN_TICKET_BEHAVIOR, buildHaloCreateTicketPayload, buildTicketContentFromCandidate, hashPayload } = require('../lifecycle');

function baseCandidate() {
  return {
    identity: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      key: 'map-1|endpoint-1|OFFLINE'
    },
    routing: {
      action1OrgId: 'org-1',
      haloClientId: '12',
      ticketTypeId: '35',
      category1Id: 'cat-1'
    },
    signal: {
      type: 'OFFLINE',
      reason: 'offline_threshold_met'
    },
    endpoint: {
      id: 'endpoint-1'
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
      haloClientId: '12',
      ticketTypeId: '35',
      category1Id: 'cat-1'
    },
    signal: {
      type: 'VULNERABILITY',
      reason: 'matched'
    },
    grouped: {
      issueKey: 'CVE-1',
      issueMetadata: { cveId: 'CVE-1', cvssScore: '8.8' },
      impactedEndpointCount: 1,
      impactedEndpoints: [{ endpointId: 'ep-1', endpointName: 'BoxOne', endpoint: { id: 'ep-1', name: 'BoxOne' } }]
    }
  };
}

function groupedCandidateForSignal(signalType) {
  if (signalType === 'UPDATE') {
    return {
      ticketModel: 'grouped',
      identity: {
        orgLinkId: 'map-1',
        signalType: 'UPDATE',
        identityKey: 'map-1|UPDATE|pkg-1:1.0.0'
      },
      issueKey: 'pkg-1:1.0.0',
      routing: {
        action1OrgId: 'org-1',
        haloClientId: '12',
        ticketTypeId: '35',
        category1Id: 'cat-1',
        action1OrgName: 'SF Office'
      },
      signal: {
        type: 'UPDATE',
        reason: 'matched'
      },
      grouped: {
        issueKey: 'pkg-1:1.0.0',
        issueMetadata: {
          id: 'pkg-1',
          packageName: 'Security Update',
          vendor: 'Microsoft',
          version: '1.0.0',
          severityLabel: 'Critical',
          remediationStatus: 'OVERDUE'
        },
        impactedEndpointCount: 1,
        impactedEndpoints: [{
          endpointId: 'ep-1',
          endpointName: 'BoxOne',
          endpoint: { id: 'ep-1', name: 'BoxOne', lastSeenAt: '2026-06-18T10:15:00Z' }
        }]
      }
    };
  }

  if (signalType === 'AUTOMATION_FAILED') {
    return {
      ticketModel: 'grouped',
      identity: {
        orgLinkId: 'map-1',
        signalType: 'AUTOMATION_FAILED',
        identityKey: 'map-1|AUTOMATION_FAILED|inst-1'
      },
      issueKey: 'inst-1',
      routing: {
        action1OrgId: 'org-1',
        haloClientId: '12',
        ticketTypeId: '35',
        category1Id: 'cat-1',
        action1OrgName: 'SF Office'
      },
      signal: {
        type: 'AUTOMATION_FAILED',
        reason: 'matched'
      },
      grouped: {
        issueKey: 'inst-1',
        issueMetadata: {
          automationInstanceId: 'inst-1',
          automationName: 'Deploy Script',
          status: 'ERROR',
          startedAt: '2026-06-18T10:10:00Z',
          endedAt: '2026-06-18T10:12:00Z'
        },
        impactedEndpointCount: 1,
        impactedEndpoints: [{
          endpointId: 'ep-1',
          endpointName: 'BoxOne',
          status: 'ERROR',
          time: '2026-06-18T10:12:00Z',
          description: 'Script failed',
          endpoint: { id: 'ep-1', name: 'BoxOne' }
        }]
      }
    };
  }

  return {
    ...groupedCandidate(),
    routing: {
      ...groupedCandidate().routing,
      action1OrgName: 'SF Office'
    },
    grouped: {
      ...groupedCandidate().grouped,
      issueMetadata: {
        ...groupedCandidate().grouped.issueMetadata,
        remediationStatus: 'OVERDUE'
      },
      impactedEndpoints: [{
        endpointId: 'ep-1',
        endpointName: 'BoxOne',
        endpoint: { id: 'ep-1', name: 'BoxOne', lastSeenAt: '2026-06-18T10:15:00Z' }
      }]
    }
  };
}

function createHarness(overrides = {}) {
  const calls = {
    createTicket: [],
    getTicket: [],
    updateTicket: [],
    setTicketStatus: [],
    upsertCorrelation: [],
    deleteCorrelation: [],
    upsertGroupedCorrelation: [],
    deleteGroupedCorrelation: []
  };
  let correlation = overrides.correlation || null;
  let groupedCorrelation = overrides.groupedCorrelation || null;

  const haloTicketsClient = {
    async createTicket(payload) {
      calls.createTicket.push(payload);
      return { id: 't-created', statusId: '3', statusName: 'Open', isClosed: false };
    },
    async updateTicket(ticketId, payload) {
      calls.updateTicket.push({ ticketId, payload });
      return { id: ticketId, statusId: '3', statusName: 'Open', isClosed: false };
    },
    async getTicket(ticketId) {
      calls.getTicket.push(ticketId);
      if (typeof overrides.getTicket === 'function') {
        return overrides.getTicket(ticketId, calls);
      }
      if (Object.prototype.hasOwnProperty.call(overrides, 'getTicketResult')) {
        return overrides.getTicketResult;
      }
      return ticketId ? { id: ticketId, statusId: '3', isClosed: false } : null;
    },
    async setTicketStatus(ticketId, statusId) {
      calls.setTicketStatus.push({ ticketId, statusId });
      return { id: ticketId, statusId, isClosed: true };
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
      calls.deleteCorrelation.push(true);
      correlation = null;
    },
    async listCorrelationsByOrgLink() {
      return [];
    },
    async getGroupedCorrelation() {
      return groupedCorrelation;
    },
    async upsertGroupedCorrelation(record) {
      calls.upsertGroupedCorrelation.push(record);
      groupedCorrelation = record;
    },
    async deleteGroupedCorrelation() {
      calls.deleteGroupedCorrelation.push(true);
      groupedCorrelation = null;
    },
    async listGroupedCorrelationsByOrgLink() {
      return [];
    }
  };

  return {
    calls,
    service: createLifecycleRunService({
      haloTicketsClient,
      correlationStore,
      now: () => Date.parse('2026-06-18T12:00:00.000Z')
    })
  };
}

async function runCreateTest() {
  const { service, calls } = createHarness();
  const out = await service.runOnce({
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  });

  assert.strictEqual(out.summary.created, 1, 'net-new qualifying candidates should create tickets');
  assert.strictEqual(calls.createTicket.length, 1, 'create should call Halo create');
  assert.strictEqual(calls.upsertCorrelation.length, 1, 'create should persist endpoint correlation after success');
}

async function runNoDuplicateOnUnchangedCorrelationTest() {
  const rendered = buildTicketContentFromCandidate({ candidate: baseCandidate() });
  const payloadHash = hashPayload(
    buildHaloCreateTicketPayload({
      candidate: baseCandidate(),
      summary: rendered.summary,
      details: rendered.details,
      detailsHtml: rendered.detailsHtml,
      categories: [{ id: 'cat-1', value: 'Software Patch' }]
    })
  );
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-existing',
      payloadHash,
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }
  });

  const out = await service.runOnce({
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  });

  assert.strictEqual(out.summary.skipped, 1, 'unchanged correlated candidates should become no-op skips');
  assert.strictEqual(calls.createTicket.length, 0, 'unchanged correlated candidates should not create duplicate tickets');
  assert.strictEqual(calls.updateTicket.length, 0, 'unchanged correlated candidates should not update unchanged tickets');
}

async function runSkipExistingOpenPolicyTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-existing',
      payloadHash: 'old-hash'
    }
  });

  const out = await service.runOnce({
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  });

  assert.strictEqual(out.results[0].reason, 'OPEN_TICKET_UPDATE_DISABLED', 'skip-existing-open should preserve standalone policy');
  assert.strictEqual(calls.updateTicket.length, 0, 'skip-existing-open should not update open tickets');
}

async function runCloseClearsCorrelationTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-existing',
      payloadHash: 'old-hash'
    }
  });

  const out = await service.runOnce({
    candidates: [{ candidate: baseCandidate(), signalQualifies: false }],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  });

  assert.strictEqual(calls.setTicketStatus.length, 1, 'qualified signal clears should close linked open tickets');
  assert.strictEqual(calls.deleteCorrelation.length, 1, 'close should clear the stored correlation only after Halo status update');
  assert.strictEqual(out.results[0].action, 'CLOSE', 'signal clear should preserve lifecycle close semantics');
}

async function runClosedLinkedTicketCreatesReplacementInsteadOfUpdatingTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-closed',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    getTicketResult: { id: 't-closed', statusId: '900', isClosed: true }
  });

  const out = await service.runOnce({
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  });

  assert.strictEqual(out.summary.created, 1, 'active signals linked to closed tickets should create a replacement');
  assert.strictEqual(out.summary.skipped, 0, 'closed linked-ticket replacement should count as created, not skipped');
  assert.strictEqual(calls.createTicket.length, 1, 'closed linked tickets should go through the create path');
  assert.strictEqual(calls.updateTicket.length, 0, 'closed linked tickets should not be updated');
  assert.strictEqual(calls.setTicketStatus.length, 0, 'closed linked tickets should not be reopened via status changes');
  assert.strictEqual(calls.upsertCorrelation.length, 1, 'closed linked-ticket replacement should overwrite the stored correlation');
  assert.strictEqual(calls.upsertCorrelation[0].haloTicketId, 't-created', 'replacement create should persist the new Halo ticket id');
  assert.strictEqual(out.results[0].action, 'CREATE', 'closed linked tickets should resolve to a create decision');
  assert.strictEqual(out.results[0].reason, 'LINKED_TICKET_CLOSED_CREATE_NEW', 'closed linked tickets should preserve the standalone create-new reason');
}

async function runClosedLinkedTicketReplacementIsUsedOnLaterRunsTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-closed',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    async getTicket(ticketId) {
      if (ticketId === 't-closed') return { id: 't-closed', statusId: '900', isClosed: true };
      if (ticketId === 't-created') return { id: 't-created', statusId: '3', isClosed: false };
      return null;
    }
  });

  const input = {
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  };

  const first = await service.runOnce(input);
  assert.strictEqual(first.summary.created, 1, 'first run should replace the closed linked ticket');
  assert.deepStrictEqual(calls.getTicket, ['t-closed'], 'first run should only read the closed linked ticket once');

  calls.getTicket.length = 0;
  const second = await service.runOnce(input);
  assert.strictEqual(second.summary.created, 0, 'second run should not recreate after the replacement is linked');
  assert.strictEqual(second.summary.skipped, 1, 'second run should no-op against the replacement ticket when unchanged');
  assert.deepStrictEqual(calls.getTicket, ['t-created'], 'later runs should read the replacement ticket id instead of the closed ticket id');
}

async function runGroupedCorrelationPathTest() {
  const { service, calls } = createHarness();
  const out = await service.runOnce({
    candidates: [groupedCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    },
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'grouped candidates should create grouped tickets');
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1, 'grouped creates should persist grouped correlations');
  assert.strictEqual(calls.upsertCorrelation.length, 0, 'grouped creates should not use endpoint correlations');
}

async function runEndpointCreatePayloadIncludesHtmlFieldTest() {
  for (const candidate of [
    baseCandidate(),
    {
      ...baseCandidate(),
      identity: { ...baseCandidate().identity, signalType: 'REBOOT_REQUIRED', key: 'map-1|endpoint-1|REBOOT_REQUIRED' },
      signal: { type: 'REBOOT_REQUIRED', reason: 'matched' },
      endpoint: { id: 'endpoint-1', name: 'BoxOne', rebootRequired: true }
    }
  ]) {
    const { service, calls } = createHarness();
    await service.runOnce({
      candidates: [candidate],
      categories: [{ id: 'cat-1', value: 'Software Patch' }],
      lifecycle: {
        existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
        closeWhenSignalClears: true,
        closedStatusIds: ['900']
      },
      config: {
        connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
      }
    });

    assert.strictEqual(calls.createTicket.length, 1, `${candidate.signal.type} should create one endpoint ticket in this harness`);
    assert.ok(String(calls.createTicket[0].details_html || '').includes('<strong>'), `${candidate.signal.type} create payload should include HTML body in details_html`);
  }
}

async function runGroupedCreatePayloadUsesHtmlFieldForEverySignalTest() {
  for (const signalType of ['VULNERABILITY', 'UPDATE', 'AUTOMATION_FAILED']) {
    const { service, calls } = createHarness();
    await service.runOnce({
      candidates: [groupedCandidateForSignal(signalType)],
      categories: [{ id: 'cat-1', value: 'Software Patch' }],
      lifecycle: {
        existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
        closeWhenSignalClears: true,
        closedStatusIds: ['900']
      },
      config: {
        connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
      }
    });

  assert.strictEqual(calls.createTicket.length, 1, `${signalType} should create a grouped ticket in this harness`);
  assert.ok(String(calls.createTicket[0].details_html || '').includes('<strong>'), `${signalType} create payload should use HTML body in details_html`);
  assert.ok(String(calls.createTicket[0].details_html || '').includes('<a href='), `${signalType} create payload should preserve grouped HTML links`);
  }
}

async function runGroupedClosedLinkedTicketCreatesReplacementTest() {
  const candidate = groupedCandidate();
  const { service, calls } = createHarness({
    groupedCorrelation: {
      mode: 'grouped',
      identityKey: candidate.identity.identityKey,
      orgLinkId: candidate.identity.orgLinkId,
      signalType: candidate.identity.signalType,
      issueKey: candidate.issueKey,
      linkedTicketId: 't-grouped-closed',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    getTicketResult: { id: 't-grouped-closed', statusId: '900', isClosed: true }
  });

  const out = await service.runOnce({
    candidates: [candidate],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    },
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'active grouped signals linked to closed tickets should create replacements');
  assert.strictEqual(out.summary.skipped, 0, 'grouped closed linked-ticket replacement should count as created, not skipped');
  assert.strictEqual(calls.createTicket.length, 1, 'grouped closed linked tickets should go through the create path');
  assert.strictEqual(calls.updateTicket.length, 0, 'grouped closed linked tickets should not be updated');
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1, 'grouped closed linked-ticket replacement should overwrite the stored grouped correlation');
  assert.strictEqual(calls.upsertGroupedCorrelation[0].linkedTicketId, 't-created', 'grouped replacement create should persist the new Halo ticket id');
  assert.strictEqual(calls.deleteGroupedCorrelation.length, 0, 'grouped closed linked-ticket replacement should overwrite rather than clear the correlation');
  assert.strictEqual(out.results[0].action, 'CREATE', 'grouped closed linked tickets should resolve to a create decision');
  assert.strictEqual(out.results[0].reason, 'LINKED_TICKET_CLOSED_CREATE_NEW', 'grouped closed linked tickets should preserve the standalone create-new reason');
}

async function runGroupedUpdatePayloadPreservesHtmlFieldTest() {
  for (const signalType of ['VULNERABILITY', 'UPDATE', 'AUTOMATION_FAILED']) {
    const candidate = groupedCandidateForSignal(signalType);
    const { service, calls } = createHarness({
      groupedCorrelation: {
        mode: 'grouped',
        identityKey: candidate.identity.identityKey,
        orgLinkId: candidate.identity.orgLinkId,
        signalType: candidate.identity.signalType,
        issueKey: candidate.issueKey,
        linkedTicketId: 't-grouped-open',
        payloadHash: 'old-hash',
        createdAt: '2026-06-18T00:00:00.000Z',
        updatedAt: '2026-06-18T00:00:00.000Z'
      },
      getTicketResult: { id: 't-grouped-open', statusId: '3', isClosed: false }
    });

    await service.runOnce({
      candidates: [candidate],
      categories: [{ id: 'cat-1', value: 'Software Patch' }],
      lifecycle: {
        existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
        closeWhenSignalClears: true,
        closedStatusIds: ['900']
      },
      config: {
        connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
      }
    });

    assert.strictEqual(calls.updateTicket.length, 1, `${signalType} changed grouped payload should update the linked ticket`);
    assert.ok(String(calls.updateTicket[0].payload.details_html || '').includes('<strong>'), `${signalType} update payload should use HTML body in details_html`);
    assert.ok(String(calls.updateTicket[0].payload.details_html || '').includes('<a href='), `${signalType} update payload should preserve grouped HTML links`);
  }
}

async function runMissingLinkedTicketRecreatesInsteadOfSkippingTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-deleted',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    getTicketResult: null
  });

  const out = await service.runOnce({
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  });

  assert.strictEqual(out.summary.created, 1, 'missing linked tickets should be recreated');
  assert.strictEqual(out.summary.skipped, 0, 'missing linked tickets should not count as skipped');
  assert.strictEqual(calls.createTicket.length, 1, 'missing linked tickets should go through the create path');
  assert.strictEqual(calls.updateTicket.length, 0, 'missing linked tickets should not go through the update path');
  assert.strictEqual(calls.upsertCorrelation.length, 1, 'missing linked tickets should replace the stored correlation after recreation');
  assert.strictEqual(out.results[0].action, 'CREATE', 'missing linked tickets should resolve to a create outcome');
}

async function runMissingLinkedTicketReplacementIsUsedOnLaterRunsTest() {
  const { service, calls } = createHarness({
    correlation: {
      orgLinkId: 'map-1',
      endpointId: 'endpoint-1',
      signalType: 'OFFLINE',
      haloTicketId: 't-deleted',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    async getTicket(ticketId) {
      if (ticketId === 't-deleted') return null;
      if (ticketId === 't-created') return { id: 't-created', statusId: '3', isClosed: false };
      return null;
    }
  });

  const input = {
    candidates: [baseCandidate()],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    }
  };

  const first = await service.runOnce(input);
  assert.strictEqual(first.summary.created, 1, 'first run should recreate the missing linked ticket');
  assert.deepStrictEqual(calls.getTicket, ['t-deleted'], 'first run should only look up the deleted ticket once');

  calls.getTicket.length = 0;
  const second = await service.runOnce(input);
  assert.strictEqual(second.summary.skipped, 1, 'second run should treat the recreated ticket as the active linked ticket');
  assert.deepStrictEqual(calls.getTicket, ['t-created'], 'later runs should look up the replacement ticket instead of the deleted ticket');
}

async function runGroupedMissingLinkedTicketRecreatesInsteadOfSkippingTest() {
  const candidate = groupedCandidate();
  const { service, calls } = createHarness({
    groupedCorrelation: {
      mode: 'grouped',
      identityKey: candidate.identity.identityKey,
      orgLinkId: candidate.identity.orgLinkId,
      signalType: candidate.identity.signalType,
      issueKey: candidate.issueKey,
      linkedTicketId: 't-grouped-deleted',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    getTicketResult: null
  });

  const out = await service.runOnce({
    candidates: [candidate],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    },
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  });

  assert.strictEqual(out.summary.created, 1, 'missing grouped linked tickets should be recreated');
  assert.strictEqual(out.summary.skipped, 0, 'missing grouped linked tickets should not count as skipped');
  assert.strictEqual(calls.createTicket.length, 1, 'missing grouped linked tickets should create a replacement');
  assert.strictEqual(calls.upsertGroupedCorrelation.length, 1, 'missing grouped linked tickets should replace the grouped correlation');
  assert.strictEqual(calls.deleteGroupedCorrelation.length, 0, 'active grouped stale recovery should replace, not delete, the correlation');
}

async function runMissingInactiveGroupedCorrelationIsClearedTest() {
  const candidate = groupedCandidate();
  const { service, calls } = createHarness({
    groupedCorrelation: {
      mode: 'grouped',
      identityKey: candidate.identity.identityKey,
      orgLinkId: candidate.identity.orgLinkId,
      signalType: candidate.identity.signalType,
      issueKey: candidate.issueKey,
      linkedTicketId: 't-grouped-deleted',
      payloadHash: 'old-hash',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    },
    async getTicket(ticketId) {
      if (ticketId === 't-grouped-deleted') return null;
      throw new Error(`unexpected ticket lookup ${ticketId}`);
    }
  });

  const input = {
    candidates: [{ candidate, signalQualifies: false }],
    categories: [{ id: 'cat-1', value: 'Software Patch' }],
    lifecycle: {
      existingOpenTicketBehavior: EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
      closeWhenSignalClears: true,
      closedStatusIds: ['900']
    },
    config: {
      connections: { action1: { baseUrl: 'https://app.action1.com/api/3.0' } }
    }
  };

  const first = await service.runOnce(input);
  assert.strictEqual(first.summary.skipped, 1, 'inactive grouped signals should remain lifecycle skips');
  assert.strictEqual(calls.deleteGroupedCorrelation.length, 1, 'missing grouped correlations should be cleared when there is no active signal');

  calls.getTicket.length = 0;
  const second = await service.runOnce(input);
  assert.deepStrictEqual(calls.getTicket, [], 'later runs should not keep re-reading the deleted grouped ticket after stale cleanup');
}

async function run() {
  await runCreateTest();
  await runNoDuplicateOnUnchangedCorrelationTest();
  await runSkipExistingOpenPolicyTest();
  await runCloseClearsCorrelationTest();
  await runClosedLinkedTicketCreatesReplacementInsteadOfUpdatingTest();
  await runClosedLinkedTicketReplacementIsUsedOnLaterRunsTest();
  await runGroupedCorrelationPathTest();
  await runEndpointCreatePayloadIncludesHtmlFieldTest();
  await runGroupedCreatePayloadUsesHtmlFieldForEverySignalTest();
  await runGroupedClosedLinkedTicketCreatesReplacementTest();
  await runGroupedUpdatePayloadPreservesHtmlFieldTest();
  await runMissingLinkedTicketRecreatesInsteadOfSkippingTest();
  await runMissingLinkedTicketReplacementIsUsedOnLaterRunsTest();
  await runGroupedMissingLinkedTicketRecreatesInsteadOfSkippingTest();
  await runMissingInactiveGroupedCorrelationIsClearedTest();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
