const assert = require('assert');

const {
  buildJiraIssuePayload,
  buildNormalizedLabels,
  buildPayloadHashInput,
  hashPayload,
  stableStringify
} = require('../issuePayloadBuilder');

function baseRouting() {
  return {
    action1OrgId: 'org-1',
    action1OrgName: 'SF Office',
    orgLinkId: 'map-1',
    jiraProjectId: '1001',
    jiraProjectKey: 'OPS',
    jiraProjectName: 'Operations',
    jiraIssueTypeId: '10001',
    jiraIssueTypeName: 'Bug'
  };
}

function endpointCandidate(signalType, overrides = {}) {
  const identity = {
    orgLinkId: 'map-1',
    endpointId: 'endpoint-1',
    signalType,
    key: `map-1|endpoint-1|${signalType}`
  };
  const base = {
    identity,
    routing: baseRouting(),
    signal: {
      type: signalType,
      reason: 'matched',
      matchedCount: 1,
      matchedItemsPreview: []
    },
    endpoint: {
      id: 'endpoint-1',
      name: 'BoxOne',
      lastSeenAt: '2026-06-18T10:15:00Z',
      os: 'Windows 11',
      platform: 'x64',
      rebootRequired: signalType === 'REBOOT_REQUIRED'
    }
  };

  if (signalType === 'OFFLINE') {
    base.signal.reason = 'offline_threshold_met';
    base.signal.details = { thresholdDays: 7 };
  }

  if (signalType === 'VULNERABILITY') {
    base.signal.matchedCount = 2;
    base.signal.matchedItemsPreview = [{
      id: 'CVE-2026-0001',
      severity: 'HIGH',
      remediationStatus: 'OVERDUE',
      cvssScore: 8.8,
      publishedDate: '2026-06-01',
      remediationDeadline: '2026-06-30'
    }, {
      id: 'CVE-2026-0002',
      severity: 'MEDIUM',
      remediationStatus: 'DUE_SOON',
      cvssScore: 7.2,
      publishedDate: '2026-06-02',
      remediationDeadline: '2026-07-01'
    }];
    base.signal.details = {
      severityCounts: { HIGH: 1, MEDIUM: 1 },
      enabledSeverities: ['HIGH', 'MEDIUM']
    };
  }

  if (signalType === 'UPDATE') {
    base.signal.matchedCount = 2;
    base.signal.matchedItemsPreview = [{
      id: 'package-1:1.0.0',
      packageId: 'package-1',
      packageName: 'Security Update',
      version: '1.0.0',
      severity: 'CRITICAL',
      severityLabel: 'Critical',
      remediationStatus: 'DUE_SOON',
      remediationDeadline: '2026-06-30',
      securityCve: 'CVE-2026-0001'
    }, {
      id: 'package-2:2.0.0',
      packageId: 'package-2',
      packageName: 'Driver Update',
      version: '2.0.0',
      severity: 'LOW',
      severityLabel: 'Low',
      remediationStatus: 'DUE_LATER',
      remediationDeadline: '2026-07-15'
    }];
    base.signal.details = {
      severityCounts: { CRITICAL: 1, LOW: 1 },
      enabledSeverities: ['CRITICAL', 'LOW']
    };
  }

  if (signalType === 'AUTOMATION_FAILED') {
    base.signal.matchedItemsPreview = [{
      instanceId: 'inst-1',
      status: 'ERROR',
      description: 'Script failed',
      instanceName: 'Deploy Script',
      failureTime: '2026-06-18T10:12:00Z',
      actionName: 'Patch',
      percentCompleted: 45
    }];
  }

  return {
    ...base,
    ...overrides
  };
}

function groupedCandidate(signalType, overrides = {}) {
  const candidate = {
    ticketModel: 'grouped',
    identity: {
      orgLinkId: 'map-1',
      signalType,
      identityKey:
        signalType === 'VULNERABILITY'
          ? 'map-1|VULNERABILITY|CVE-2026-0001'
          : signalType === 'UPDATE'
          ? 'map-1|UPDATE|package-1:1.0.0'
          : 'map-1|AUTOMATION_FAILED|inst-1'
    },
    issueKey:
      signalType === 'VULNERABILITY'
        ? 'CVE-2026-0001'
        : signalType === 'UPDATE'
        ? 'package-1:1.0.0'
        : 'inst-1',
    routing: baseRouting(),
    signal: {
      type: signalType,
      reason: 'matched'
    },
    grouped: {
      issueKey:
        signalType === 'VULNERABILITY'
          ? 'CVE-2026-0001'
          : signalType === 'UPDATE'
          ? 'package-1:1.0.0'
          : 'inst-1',
      issueMetadata: {},
      impactedEndpointCount: 3,
      impactedEndpoints: [
        { endpointId: 'ep-2', endpointName: 'Bravo', endpoint: { id: 'ep-2', name: 'Bravo', lastSeenAt: '2026-06-18T11:00:00Z' } },
        { endpointId: 'ep-1', endpointName: 'Alpha', endpoint: { id: 'ep-1', name: 'Alpha', lastSeenAt: '2026-06-18T10:00:00Z' } },
        { endpointId: 'ep-3', endpointName: 'Charlie', endpoint: { id: 'ep-3', name: 'Charlie', lastSeenAt: '2026-06-18T12:00:00Z' } }
      ]
    }
  };

  if (signalType === 'VULNERABILITY') {
    candidate.grouped.issueMetadata = {
      cveId: 'CVE-2026-0001',
      cvssScore: '8.8',
      severity: 'CRITICAL',
      remediationStatus: 'DUE_SOON',
      remediationDeadline: '2026-06-30'
    };
  }

  if (signalType === 'UPDATE') {
    candidate.grouped.issueMetadata = {
      id: 'package-1',
      packageName: '2023-10 Update for Windows 11 for x64-based Systems (KB4023057)',
      vendor: 'Microsoft',
      version: '1.0.0',
      severity: 'CRITICAL',
      severityLabel: 'Critical',
      remediationStatus: 'OVERDUE'
    };
  }

  if (signalType === 'AUTOMATION_FAILED') {
    candidate.grouped.issueMetadata = {
      automationInstanceId: 'inst-1',
      automationName: 'Deploy Script',
      status: 'ERROR',
      startedAt: '2026-06-18T10:10:00Z',
      endedAt: '2026-06-18T10:12:00Z'
    };
    candidate.grouped.impactedEndpoints = [
      { endpointId: 'ep-2', endpointName: 'Bravo', status: 'ERROR', time: '2026-06-18T10:12:00Z', description: 'Script failed', endpoint: { id: 'ep-2', name: 'Bravo' } },
      { endpointId: 'ep-1', endpointName: 'Alpha', status: 'ERROR', time: '2026-06-18T10:13:00Z', description: 'Patch failed', endpoint: { id: 'ep-1', name: 'Alpha' } },
      { endpointId: 'ep-3', endpointName: 'Charlie', status: 'ERROR', time: '2026-06-18T10:14:00Z', description: 'Retry failed', endpoint: { id: 'ep-3', name: 'Charlie' } }
    ];
  }

  return {
    ...candidate,
    ...overrides
  };
}

function assertValidAdf(doc) {
  assert.strictEqual(doc.type, 'doc', 'ADF should use doc type');
  assert.strictEqual(doc.version, 1, 'ADF should use version 1');
  assert(Array.isArray(doc.content), 'ADF content should be an array');
  assert.strictEqual(JSON.stringify(doc).includes('<strong>'), false, 'ADF should not contain raw HTML');
}

function collectVisibleText(node) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map((item) => collectVisibleText(item)).join('');
  const ownText = typeof node.text === 'string' ? node.text : '';
  const childText = Array.isArray(node.content) ? node.content.map((item) => collectVisibleText(item)).join('') : '';
  return `${ownText}${childText}`;
}

function collectParagraphTexts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectParagraphTexts(item, out);
    return out;
  }
  if (node.type === 'paragraph') {
    const text = Array.isArray(node.content)
      ? node.content.map((item) => {
        if (item?.type === 'hardBreak') return '\n';
        return typeof item?.text === 'string' ? item.text : '';
      }).join('')
      : '';
    out.push(text);
  }
  if (Array.isArray(node.content)) {
    for (const item of node.content) collectParagraphTexts(item, out);
  }
  return out;
}

function collectLinkMarks(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectLinkMarks(item, out);
    return out;
  }
  if (node.type === 'text') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    const link = marks.find((mark) => mark?.type === 'link' && mark?.attrs?.href);
    if (link) {
      out.push({
        text: String(node.text || ''),
        href: String(link.attrs.href || '')
      });
    }
  }
  if (Array.isArray(node.content)) {
    for (const item of node.content) collectLinkMarks(item, out);
  }
  return out;
}

function countNodesByType(node, type) {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countNodesByType(item, type), 0);
  let own = node.type === type ? 1 : 0;
  if (Array.isArray(node.content)) {
    own += countNodesByType(node.content, type);
  }
  return own;
}

function countMarkType(node, markType) {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countMarkType(item, markType), 0);
  let own = 0;
  if (node.type === 'text') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    own += marks.filter((mark) => mark?.type === markType).length;
  }
  if (Array.isArray(node.content)) {
    own += countMarkType(node.content, markType);
  }
  return own;
}

function countEmptyParagraphs(node) {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countEmptyParagraphs(item), 0);
  let own = 0;
  if (node.type === 'paragraph') {
    const visibleText = collectVisibleText(node).trim();
    if (!visibleText) own += 1;
  }
  if (Array.isArray(node.content)) {
    own += countEmptyParagraphs(node.content);
  }
  return own;
}

function assertPreviewTextAbsent(visibleText, label) {
  assert.strictEqual(
    /Connector Header|Connector Footer|payload preview|Routing Context|Endpoint Context|Signal Details|Top Actionable Items/.test(visibleText),
    false,
    `${label} should not include preview/debug copy`
  );
}

function assertCompactSpacing(doc, label) {
  assert.strictEqual(countEmptyParagraphs(doc), 0, `${label} should not render empty spacer paragraphs`);
  assert.strictEqual(countNodesByType(doc, 'heading'), 0, `${label} should use compact paragraph title styling instead of heading nodes`);
  assert.strictEqual(countMarkType(doc, 'strong') > 0, true, `${label} should render section titles with strong emphasis`);
}

function assertCompactFieldGroup(doc, expectedLines, label) {
  const paragraphs = collectParagraphTexts(doc);
  const needsHardBreak = expectedLines.length > 1;
  const found = paragraphs.some((text) => expectedLines.every((line) => text.includes(line)) && (!needsHardBreak || text.includes('\n')));
  assert.strictEqual(found, true, `${label} should render as one compact field group with hard breaks`);
}

function assertBulletListCompact(doc, label) {
  assert.strictEqual(countNodesByType(doc, 'bulletList') > 0, true, `${label} should preserve bullet lists`);
  const paragraphs = collectParagraphTexts(doc);
  const blankBulletParagraph = paragraphs.some((text) => text.trim() === '');
  assert.strictEqual(blankBulletParagraph, false, `${label} should not create blank bullet paragraphs`);
}

function testEndpointPayloadParityBySignal() {
  for (const signalType of ['OFFLINE', 'REBOOT_REQUIRED', 'VULNERABILITY', 'UPDATE', 'AUTOMATION_FAILED']) {
    const candidate = endpointCandidate(signalType);
    const result = buildJiraIssuePayload({
      candidate,
      action1BaseUrl: 'https://app.action1.com/api/3.0'
    });

    assert.strictEqual(result.payload.fields.project.id, '1001', `${signalType} payload should use routing Jira project`);
    assert.strictEqual(result.payload.fields.issuetype.id, '10001', `${signalType} payload should use routing Jira issue type`);
    assert(result.payload.fields.summary.startsWith('[Action1]'), `${signalType} summary should preserve Halo prefix`);
    assertValidAdf(result.payload.fields.description);
    assertCompactSpacing(result.payload.fields.description, `${signalType} endpoint description`);
    assert.deepStrictEqual(result.payload.fields.labels, buildNormalizedLabels(candidate), `${signalType} labels should be normalized deterministically`);

    const visibleText = collectVisibleText(result.payload.fields.description);
    const links = collectLinkMarks(result.payload.fields.description);
    assertPreviewTextAbsent(visibleText, `${signalType} endpoint description`);
    assert.strictEqual(visibleText.includes('Why this ticket was created'), true, `${signalType} endpoint description should preserve Halo why-section semantics`);
    assert.strictEqual(visibleText.includes('https://app.action1.com/'), false, `${signalType} endpoint visible text should not expose raw URLs`);
    assert.strictEqual(links.some((item) => item.text === 'Open in Action1'), true, `${signalType} endpoint description should render the Action1 link as an ADF link mark`);

    if (signalType === 'OFFLINE') {
      assertCompactFieldGroup(result.payload.fields.description, ['Endpoint: BoxOne', 'Last seen: 2026-06-18 10:15'], 'OFFLINE endpoint context');
      assertCompactFieldGroup(result.payload.fields.description, ['Signal: Endpoint offline', 'Action1 Organization: SF Office'], 'OFFLINE signal context');
      assert.strictEqual(visibleText.includes('Signal: Endpoint offline'), true, 'OFFLINE endpoint description should preserve the Halo signal title');
      assert.strictEqual(visibleText.includes('Offline threshold (days): 7'), true, 'OFFLINE endpoint description should preserve the threshold field');
      assert.strictEqual(visibleText.includes('This endpoint has not checked in to Action1 within the configured offline threshold.'), true, 'OFFLINE endpoint description should preserve the Halo why text');
    }

    if (signalType === 'REBOOT_REQUIRED') {
      assertCompactFieldGroup(result.payload.fields.description, ['Endpoint: BoxOne', 'Last seen: 2026-06-18 10:15'], 'REBOOT_REQUIRED endpoint context');
      assertCompactFieldGroup(result.payload.fields.description, ['Signal: Reboot required', 'Action1 Organization: SF Office'], 'REBOOT_REQUIRED signal context');
      assert.strictEqual(visibleText.includes('Signal: Reboot required'), true, 'REBOOT_REQUIRED endpoint description should preserve the Halo signal title');
      assert.strictEqual(visibleText.includes('Reboot status in Action1: Required'), true, 'REBOOT_REQUIRED endpoint description should preserve the reboot status field');
    }

    if (signalType === 'VULNERABILITY') {
      assertCompactFieldGroup(result.payload.fields.description, ['Matching vulnerability groups', 'HIGH: 1 matched', 'MEDIUM: 1 matched'], 'VULNERABILITY group summary');
      assertBulletListCompact(result.payload.fields.description, 'VULNERABILITY top-items list');
      assert.strictEqual(visibleText.includes('Signal: Vulnerabilities detected'), true, 'VULNERABILITY endpoint description should preserve the Halo signal title');
      assert.strictEqual(visibleText.includes('Matching vulnerability groups'), true, 'VULNERABILITY endpoint description should include the Halo severity summary block');
      assert.strictEqual(visibleText.includes('HIGH: 1 matched'), true, 'VULNERABILITY endpoint description should preserve severity counts');
      assert.strictEqual(visibleText.includes('MEDIUM: 1 matched'), true, 'VULNERABILITY endpoint description should preserve severity counts');
      assert.strictEqual(visibleText.includes('Top vulnerability items'), true, 'VULNERABILITY endpoint description should include the Halo top-items block');
      assert.strictEqual(visibleText.includes('CVE-2026-0001 | CVSS 8.8 | status Overdue | published 2026-06-01 | deadline 2026-06-30'), true, 'VULNERABILITY endpoint description should preserve item-level vulnerability detail');
    }

    if (signalType === 'UPDATE') {
      const actionLink = links.find((item) => item.text === 'Open in Action1');
      assertCompactFieldGroup(result.payload.fields.description, ['Endpoint: BoxOne', 'Last seen: 2026-06-18 10:15'], 'UPDATE endpoint context');
      assertCompactFieldGroup(result.payload.fields.description, ['Action1 update', 'Open in Action1'], 'UPDATE Action1 link section');
      assertCompactFieldGroup(result.payload.fields.description, ['Signal: Updates required', 'Action1 Organization: SF Office'], 'UPDATE signal context');
      assertCompactFieldGroup(result.payload.fields.description, ['Matching update groups', 'Critical: 1 matched', 'Low: 1 matched'], 'UPDATE group summary');
      assertBulletListCompact(result.payload.fields.description, 'UPDATE top-items list');
      assert.strictEqual(visibleText.includes('Signal: Updates required'), true, 'UPDATE endpoint description should preserve the Halo signal title');
      assert.strictEqual(visibleText.includes('Action1 update'), true, 'UPDATE endpoint description should preserve the Halo Action1 update link label');
      assert.strictEqual(visibleText.includes('Matching update groups'), true, 'UPDATE endpoint description should include the Halo severity summary block');
      assert.strictEqual(visibleText.includes('Critical: 1 matched'), true, 'UPDATE endpoint description should preserve the critical count');
      assert.strictEqual(visibleText.includes('Low: 1 matched'), true, 'UPDATE endpoint description should preserve the low count');
      assert.strictEqual(visibleText.includes('Top missing update items'), true, 'UPDATE endpoint description should include the Halo top-items block');
      assert.strictEqual(visibleText.includes('Security Update | version 1.0.0 | severity Critical | SLA Due Soon | deadline 2026-06-30 | CVEs: CVE-2026-0001'), true, 'UPDATE endpoint description should preserve item-level update detail');
      assert(actionLink && actionLink.href.includes('filter=Security%2520Update'), 'UPDATE endpoint Action1 link should follow the Halo double-encoded updates-console URL');
    }

    if (signalType === 'AUTOMATION_FAILED') {
      assertCompactFieldGroup(result.payload.fields.description, ['Signal: Automation failures detected', 'Action1 Organization: SF Office'], 'AUTOMATION_FAILED signal context');
      assertBulletListCompact(result.payload.fields.description, 'AUTOMATION_FAILED top-items list');
      assert.strictEqual(visibleText.includes('Signal: Automation failures detected'), true, 'AUTOMATION_FAILED endpoint description should preserve the Halo signal title');
      assert.strictEqual(visibleText.includes('Last failure: Deploy Script | 2026-06-18 10:12 | Script failed'), true, 'AUTOMATION_FAILED endpoint description should preserve the last-failure summary');
      assert.strictEqual(visibleText.includes('Recent automation failures'), true, 'AUTOMATION_FAILED endpoint description should preserve the recent-failures block');
      assert.strictEqual(visibleText.includes('Deploy Script | 2026-06-18 10:12 | status ERROR | action Patch | completion 45% | Script failed'), true, 'AUTOMATION_FAILED endpoint description should preserve item-level automation detail');
    }
  }
}

function testGroupedPayloadParityBySignal() {
  for (const signalType of ['VULNERABILITY', 'UPDATE', 'AUTOMATION_FAILED']) {
    const result = buildJiraIssuePayload({
      candidate: groupedCandidate(signalType),
      action1BaseUrl: 'https://app.action1.com/api/3.0',
      maxImpactedEndpointsInGroupedTicket: 2
    });

    assert(result.payload.fields.summary.includes('on 3 endpoints'), `${signalType} grouped summary should preserve grouped count`);
    assertValidAdf(result.payload.fields.description);
    assertCompactSpacing(result.payload.fields.description, `${signalType} grouped description`);

    const visibleText = collectVisibleText(result.payload.fields.description);
    const links = collectLinkMarks(result.payload.fields.description);
    assertPreviewTextAbsent(visibleText, `${signalType} grouped description`);
    assert.strictEqual(visibleText.includes('This ticket was created automatically by the Action1 Connector for HaloPSA.'), true, `${signalType} grouped description should preserve the Halo intro line`);
    assert.strictEqual(visibleText.includes('Action1 Organization: SF Office'), true, `${signalType} grouped description should preserve the Action1 organization line`);
    assert.strictEqual(visibleText.includes('Showing 2 of 3 impacted endpoints.'), true, `${signalType} grouped description should preserve the Halo visibility summary`);
    assert.strictEqual(visibleText.includes('Additional impacted endpoints are available in Action1.'), true, `${signalType} grouped description should preserve the Halo overflow notice`);
    assert.strictEqual(visibleText.includes('https://app.action1.com/'), false, `${signalType} grouped visible text should not expose raw URLs`);
    assert.strictEqual(links.some((item) => item.text === 'Open in Action1'), true, `${signalType} grouped description should render the Action1 link as an ADF link mark`);
    assert.strictEqual(links.some((item) => item.text === 'Alpha'), true, `${signalType} grouped description should render endpoint names as ADF link marks`);
    assert.strictEqual(links.some((item) => item.text === 'Bravo'), true, `${signalType} grouped description should render endpoint names as ADF link marks`);
    assertCompactFieldGroup(result.payload.fields.description, ['Showing 2 of 3 impacted endpoints.'], `${signalType} grouped affected-endpoint summary`);
    assertBulletListCompact(result.payload.fields.description, `${signalType} grouped endpoint list`);

    if (signalType === 'VULNERABILITY') {
      assertCompactFieldGroup(result.payload.fields.description, ['A vulnerability matched the configured connector filters.', 'Action1 Organization: SF Office'], 'VULNERABILITY grouped intro');
      assertCompactFieldGroup(result.payload.fields.description, ['CVE: CVE-2026-0001', 'CVSS: 8.8', 'Remediation status: Due Soon'], 'VULNERABILITY grouped detail block');
      assert.strictEqual(visibleText.includes('A vulnerability matched the configured connector filters.'), true, 'VULNERABILITY grouped description should preserve the Halo why line');
      assert.strictEqual(visibleText.includes('CVE: CVE-2026-0001'), true, 'VULNERABILITY grouped description should preserve the CVE field');
      assert.strictEqual(visibleText.includes('CVSS: 8.8'), true, 'VULNERABILITY grouped description should preserve the CVSS field');
      assert.strictEqual(visibleText.includes('Remediation status: Due Soon'), true, 'VULNERABILITY grouped description should preserve the friendly remediation label');
      assert.strictEqual(visibleText.includes('View affected endpoints in Action1'), true, 'VULNERABILITY grouped description should preserve the Halo problem-link label');
      assert.strictEqual(visibleText.includes('Endpoint  Last Seen'), true, 'VULNERABILITY grouped description should preserve the impacted-endpoint header');
    }

    if (signalType === 'UPDATE') {
      const problemLink = links.find((item) => item.text === 'Open in Action1');
      assertCompactFieldGroup(result.payload.fields.description, ['A missing update matched the configured connector filters.', 'Action1 Organization: SF Office'], 'UPDATE grouped intro');
      assertCompactFieldGroup(result.payload.fields.description, ['Update: 2023-10 Update for Windows 11 for x64-based Systems (KB4023057)', 'Vendor: Microsoft', 'Version: 1.0.0', 'Security severity: Critical', 'SLA status: Overdue'], 'UPDATE grouped detail block');
      assertCompactFieldGroup(result.payload.fields.description, ['View missing update in Action1', 'Open in Action1'], 'UPDATE grouped Action1 link section');
      assert.strictEqual(visibleText.includes('A missing update matched the configured connector filters.'), true, 'UPDATE grouped description should preserve the Halo why line');
      assert.strictEqual(visibleText.includes('Update: 2023-10 Update for Windows 11 for x64-based Systems (KB4023057)'), true, 'UPDATE grouped description should preserve the update name');
      assert.strictEqual(visibleText.includes('Vendor: Microsoft'), true, 'UPDATE grouped description should preserve the vendor field');
      assert.strictEqual(visibleText.includes('Version: 1.0.0'), true, 'UPDATE grouped description should preserve the version field');
      assert.strictEqual(visibleText.includes('Security severity: Critical'), true, 'UPDATE grouped description should preserve the security severity field');
      assert.strictEqual(visibleText.includes('SLA status: Overdue'), true, 'UPDATE grouped description should preserve the friendly SLA label');
      assert.strictEqual(visibleText.includes('View missing update in Action1'), true, 'UPDATE grouped description should preserve the Halo problem-link label');
      assert(problemLink && problemLink.href.includes('filter=2023-10%2520Update%2520for%2520Windows%252011%2520for%2520x64-based%2520Systems%2520%28KB4023057%29'), 'UPDATE grouped Action1 link should follow the Halo double-encoded updates-console URL');
    }

    if (signalType === 'AUTOMATION_FAILED') {
      assertCompactFieldGroup(result.payload.fields.description, ['An Action1 automation run matched the configured connector failure filters.', 'Action1 Organization: SF Office'], 'AUTOMATION_FAILED grouped intro');
      assertCompactFieldGroup(result.payload.fields.description, ['Automation: Deploy Script', 'Status: ERROR', 'Started: 2026-06-18 10:10', 'Ended: 2026-06-18 10:12'], 'AUTOMATION_FAILED grouped detail block');
      assert.strictEqual(visibleText.includes('An Action1 automation run matched the configured connector failure filters.'), true, 'AUTOMATION_FAILED grouped description should preserve the Halo why line');
      assert.strictEqual(visibleText.includes('Automation: Deploy Script'), true, 'AUTOMATION_FAILED grouped description should preserve the automation field');
      assert.strictEqual(visibleText.includes('Status: ERROR'), true, 'AUTOMATION_FAILED grouped description should preserve the status field');
      assert.strictEqual(visibleText.includes('Started: 2026-06-18 10:10'), true, 'AUTOMATION_FAILED grouped description should format the start time cleanly');
      assert.strictEqual(visibleText.includes('Ended: 2026-06-18 10:12'), true, 'AUTOMATION_FAILED grouped description should format the end time cleanly');
      assert.strictEqual(visibleText.includes('View automation run in Action1'), true, 'AUTOMATION_FAILED grouped description should preserve the Halo problem-link label');
      assert.strictEqual(visibleText.includes('Endpoint  Status  Time  Description'), false, 'AUTOMATION_FAILED grouped description should not render unrelated impacted-endpoint table headers');
      assert.strictEqual(result.content.details.includes('Endpoint  Status  Time  Description'), false, 'AUTOMATION_FAILED grouped plain-text details should not render unrelated impacted-endpoint table headers');
      assert.strictEqual(result.content.details.includes('Alpha'), true, 'AUTOMATION_FAILED grouped plain-text details should still list impacted endpoint names');
      assert.strictEqual(result.content.details.includes('Bravo'), true, 'AUTOMATION_FAILED grouped plain-text details should still list impacted endpoint names');
      assert.strictEqual(result.content.details.includes('|  |  |'), false, 'AUTOMATION_FAILED grouped plain-text details should not render dangling empty separators');
    }
  }
}

function testProductionFormattingAndLinkSafety() {
  const candidate = groupedCandidate('VULNERABILITY', {
    routing: {
      ...baseRouting(),
      action1OrgName: 'NYC Office'
    },
    grouped: {
      issueKey: 'CVE-2026-0905',
      issueMetadata: {
        cveId: 'CVE-2026-0905',
        cvssScore: '9.8',
        remediationStatus: 'OVERDUE',
        remediationDeadline: '2026-01-27_05-16-16'
      },
      impactedEndpointCount: 2,
      impactedEndpoints: [
        { endpointId: 'ep-1', endpointName: 'Box-17.test', endpoint: { id: 'ep-1', name: 'Box-17.test', lastSeenAt: '2025-12-01_20-55-47' } },
        { endpointId: 'ep-2', endpointName: 'Box18 test', endpoint: { id: 'ep-2', name: 'Box18 test', lastSeenAt: '2025-12-01_20-54-57' } }
      ]
    }
  });

  const result = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0',
    maxImpactedEndpointsInGroupedTicket: 10
  });

  const visibleText = collectVisibleText(result.payload.fields.description);
  const links = collectLinkMarks(result.payload.fields.description);
  assertPreviewTextAbsent(visibleText, 'formatted grouped description');
  assert.strictEqual(visibleText.includes('2026-01-27 05:16'), false, 'grouped vulnerability deadline should remain date-only like Halo');
  assert.strictEqual(visibleText.includes('2026-01-27'), true, 'grouped vulnerability deadline should render cleanly');
  assert.strictEqual(visibleText.includes('2025-12-01 20:55'), true, 'grouped endpoint last-seen values should render without underscore artifacts');
  assert.strictEqual(visibleText.includes('2025-12-01_20-55-47'), false, 'grouped endpoint last-seen values should not keep underscore artifacts');
  assert.strictEqual(visibleText.includes('https://app.action1.com/console/endpoints'), false, 'grouped visible text should not expose raw endpoint URLs');
  assert.strictEqual(links.some((item) => item.text === 'Box-17.test'), true, 'endpoint names should remain ADF links');
  assert.strictEqual(links.some((item) => item.text === 'Box18 test'), true, 'endpoint names with spaces should remain ADF links');
  const endpointLinkWithSpace = links.find((item) => item.text === 'Box18 test');
  assert(endpointLinkWithSpace && endpointLinkWithSpace.href.includes('filter=Box18%20test'), 'endpoint links should URL-encode spaces correctly');
}

function testAdfDeterminism() {
  const first = buildJiraIssuePayload({
    candidate: endpointCandidate('UPDATE'),
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const second = buildJiraIssuePayload({
    candidate: endpointCandidate('UPDATE'),
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });

  assert.strictEqual(stableStringify(first.payload.fields.description), stableStringify(second.payload.fields.description), 'equivalent input should produce byte-stable ADF JSON');
  assert.strictEqual(first.payloadHash, second.payloadHash, 'equivalent input should produce a stable payload hash');
  assert.strictEqual(countNodesByType(first.payload.fields.description, 'heading'), 0, 'compact Jira typography should not emit heading nodes');
  assert.strictEqual(countNodesByType(first.payload.fields.description, 'hardBreak') > 0, true, 'compact Jira typography should use hard breaks inside field groups');
}

function testLabels() {
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('REBOOT_REQUIRED')),
    ['action1', 'action1-org-sf-office', 'action1-reboot-required'],
    'REBOOT_REQUIRED labels should include deterministic common and signal labels'
  );
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('OFFLINE', {
      routing: {
        ...baseRouting(),
        action1OrgName: 'Client / Test #1'
      }
    })),
    ['action1', 'action1-offline', 'action1-org-client-test-1'],
    'OFFLINE labels should include the sanitized org label'
  );
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('UPDATE')),
    ['action1', 'action1-org-sf-office', 'action1-update-critical', 'action1-update-low', 'action1-updates'],
    'UPDATE labels should include deterministic severity labels'
  );
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('VULNERABILITY')),
    ['action1', 'action1-org-sf-office', 'action1-vuln-high', 'action1-vuln-medium', 'action1-vulnerabilities'],
    'VULNERABILITY labels should include deterministic severity labels'
  );
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('AUTOMATION_FAILED')),
    ['action1', 'action1-automation-failures', 'action1-org-sf-office'],
    'AUTOMATION_FAILED labels should include deterministic common and signal labels'
  );
  assert.deepStrictEqual(
    buildNormalizedLabels(groupedCandidate('VULNERABILITY')),
    ['action1', 'action1-org-sf-office', 'action1-vuln-critical', 'action1-vulnerabilities', 'CVE-2026-0001'],
    'grouped vulnerability labels should include the raw uppercase CVE label'
  );
  const groupedUpdateLabels = buildNormalizedLabels(groupedCandidate('UPDATE'));
  assert.deepStrictEqual(
    groupedUpdateLabels,
    ['action1', 'action1-org-sf-office', 'action1-update-critical', 'action1-updates'],
    'grouped update labels should stay generic and deterministic'
  );
  assert.strictEqual(groupedUpdateLabels.some((label) => /windows|kb4023057|package-1|1-0-0/i.test(label)), false, 'grouped update labels must not include product names, versions, or identifiers');
  assert.strictEqual(new Set(groupedUpdateLabels).size, groupedUpdateLabels.length, 'labels should not contain duplicates');
}

function testLabelSanitizationAndFallbacks() {
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('OFFLINE', {
      routing: {
        ...baseRouting(),
        action1OrgName: 'NYC_Office'
      }
    })),
    ['action1', 'action1-offline', 'action1-org-nyc-office'],
    'org slug labels should normalize underscores to hyphens'
  );
  assert.deepStrictEqual(
    buildNormalizedLabels(endpointCandidate('OFFLINE', {
      routing: {
        ...baseRouting(),
        action1OrgName: ''
      }
    })),
    ['action1', 'action1-offline', 'action1-org-unknown'],
    'empty org names should fall back to an unknown org slug'
  );

  const groupedMixedCaseCveCandidate = groupedCandidate('VULNERABILITY');
  groupedMixedCaseCveCandidate.issueKey = 'cve-2026-0102';
  groupedMixedCaseCveCandidate.grouped.issueKey = 'cve-2026-0102';
  groupedMixedCaseCveCandidate.grouped.issueMetadata.cveId = 'cve-2026-0102';
  const groupedMixedCaseCveLabels = buildNormalizedLabels(groupedMixedCaseCveCandidate);
  assert.strictEqual(groupedMixedCaseCveLabels.includes('CVE-2026-0102'), true, 'grouped vulnerability CVE labels should normalize to uppercase');
  assert.strictEqual(groupedMixedCaseCveLabels.includes('action1-cve-2026-0102'), false, 'grouped vulnerability CVE labels must not be action1-prefixed');

  const malformedCveCandidate = groupedCandidate('VULNERABILITY');
  malformedCveCandidate.issueKey = 'not-a-cve';
  malformedCveCandidate.grouped.issueKey = 'not-a-cve';
  malformedCveCandidate.grouped.issueMetadata.cveId = 'not-a-cve';
  const malformedCveLabels = buildNormalizedLabels(malformedCveCandidate);
  assert.strictEqual(malformedCveLabels.some((label) => label === 'NOT-A-CVE'), false, 'malformed grouped vulnerability CVE labels must not be added');

  const unknownUpdateLabels = buildNormalizedLabels(endpointCandidate('UPDATE', {
    signal: {
      type: 'UPDATE',
      reason: 'matched',
      matchedCount: 1,
      matchedItemsPreview: [{
        id: 'package-1:1.0.0',
        packageName: 'Security Update',
        remediationStatus: 'DUE_SOON'
      }]
    }
  }));
  assert.strictEqual(unknownUpdateLabels.includes('action1-update-unknown'), true, 'update labels should fall back to unknown when no reliable severity is available');
}

function testPayloadHashDeterminismAndIdentityStability() {
  const candidate = groupedCandidate('VULNERABILITY');
  const payloadA = buildJiraIssuePayload({
    candidate,
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const payloadB = buildJiraIssuePayload({
    candidate: groupedCandidate('VULNERABILITY'),
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });

  assert.strictEqual(payloadA.payloadHash, payloadB.payloadHash, 'equivalent payloads should produce the same payload hash');
  assert.strictEqual(candidate.identity.identityKey, 'map-1|VULNERABILITY|CVE-2026-0001', 'payload generation must not change grouped identity');
}

function testDoesNotReadProjectOrIssueTypeFromSettings() {
  const candidate = endpointCandidate('OFFLINE', {
    routing: {
      ...baseRouting(),
      jiraProjectId: 'project-from-routing',
      jiraIssueTypeId: 'issue-from-routing'
    }
  });
  const result = buildJiraIssuePayload({
    candidate,
    settings: {
      JiraCloudProjectId: 'wrong-project',
      JiraCloudIssueTypeId: 'wrong-issue'
    },
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });

  assert.strictEqual(result.payload.fields.project.id, 'project-from-routing', 'payload builder should ignore settings for project id');
  assert.strictEqual(result.payload.fields.issuetype.id, 'issue-from-routing', 'payload builder should ignore settings for issue type id');
}

function testPayloadHashInputDeterminism() {
  const endpointInput = buildPayloadHashInput({
    candidate: endpointCandidate('OFFLINE'),
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  });
  const groupedInput = buildPayloadHashInput({
    candidate: groupedCandidate('UPDATE'),
    action1BaseUrl: 'https://app.action1.com/api/3.0',
    maxImpactedEndpointsInGroupedTicket: 2
  });

  assert.strictEqual(endpointInput.mode, 'endpoint', 'endpoint payload hash input should keep endpoint mode');
  assert.strictEqual(groupedInput.mode, 'grouped', 'grouped payload hash input should keep grouped mode');
  assert.strictEqual(hashPayload(endpointInput), hashPayload(buildPayloadHashInput({
    candidate: endpointCandidate('OFFLINE'),
    action1BaseUrl: 'https://app.action1.com/api/3.0'
  })), 'endpoint payload hash input should be deterministic');
}

function run() {
  testEndpointPayloadParityBySignal();
  testGroupedPayloadParityBySignal();
  testProductionFormattingAndLinkSafety();
  testAdfDeterminism();
  testLabels();
  testLabelSanitizationAndFallbacks();
  testPayloadHashDeterminismAndIdentityStability();
  testDoesNotReadProjectOrIssueTypeFromSettings();
  testPayloadHashInputDeterminism();
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
