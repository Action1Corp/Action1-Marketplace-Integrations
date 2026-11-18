const assert = require('assert');
const { buildTicketContentFromCandidate } = require('../lifecycle/ticketContentBuilder');
const { buildGroupedTicketContentFromCandidate } = require('../lifecycle/groupedTicketContentBuilder');

const baseUrl = 'https://app.eu.action1.com/api/3.0/';

function endpointCandidate(signalType, overrides = {}) {
  const { signal = {}, ...otherOverrides } = overrides;
  return {
    identity: { key: 'map-1|ep-1|VULNERABILITY' },
    endpoint: { id: 'ep-1', name: '<endpoint & one>', os: 'Windows', platform: 'Desktop', lastSeenAt: '2026-05-01_10-11-12' },
    routing: { action1OrgId: 'org/1', action1OrgName: '<Acme & Co>' },
    signal: { type: signalType, matchedCount: 0, matchedItemsPreview: [], details: {}, ...signal },
    ...otherOverrides
  };
}

function testEndpointSignalContentAndSafeEncoding() {
  const offline = buildTicketContentFromCandidate({ candidate: endpointCandidate('OFFLINE', { signal: { details: { thresholdDays: 7 } } }), action1BaseUrl: baseUrl });
  assert(offline.summary.startsWith('[Action1] <endpoint & one> - Endpoint offline'));
  assert(offline.details.includes('Why this ticket was created:'));
  assert(offline.details.includes('Offline threshold (days): 7'));
  assert(offline.details.includes('https://app.eu.action1.com/console/endpoints?'));
  assert(offline.detailsHtml.includes('&lt;endpoint &amp; one&gt;'));
  assert(!offline.detailsHtml.includes('<endpoint & one>'), 'untrusted endpoint/organization labels are escaped in HTML');

  const reboot = buildTicketContentFromCandidate({ candidate: endpointCandidate('REBOOT_REQUIRED'), action1BaseUrl: baseUrl });
  assert(reboot.details.includes('Reboot status in Action1: Unknown'));
  assert(reboot.detailsHtml.includes('app.eu.action1.com'), 'console links retain the Action1 region origin');
}

function testVulnerabilityAndUpdateOrderingCapsAndLinks() {
  const vulnerabilities = Array.from({ length: 12 }, (_, index) => ({
    id: `CVE-${String(12 - index).padStart(4, '0')}`,
    cvssScore: index,
    severity: index === 11 ? 'Critical' : 'High',
    remediationStatus: 'Overdue',
    remediationDeadline: `2026-06-${String(index + 1).padStart(2, '0')}`
  }));
  const vuln = buildTicketContentFromCandidate({
    candidate: endpointCandidate('VULNERABILITY', { signal: { matchedCount: 12, matchedItemsPreview: vulnerabilities, details: { severityCounts: { HIGH: 11, CRITICAL: 1 }, enabledSeverities: ['CRITICAL', 'HIGH'] } } }),
    action1BaseUrl: baseUrl
  });
  assert.strictEqual(vuln.topItems, 10);
  assert(vuln.details.includes('HIGH: 11 matched'));
  assert(vuln.details.includes('Only the first 10 matching vulnerabilities are shown'));
  assert(vuln.details.indexOf('CVE-0001') < vuln.details.indexOf('CVE-0002'), 'vulnerability facts retain donor score sorting');
  assert(!vuln.details.includes('CVE-0012'), 'the lower-ranked item falls beyond the donor top-ten cap');
  assert(vuln.details.includes('/console/endpoints?') && vuln.details.includes('org=org%2F1'));

  const update = buildTicketContentFromCandidate({
    candidate: endpointCandidate('UPDATE', { signal: { matchedCount: 1, matchedItemsPreview: [{ packageName: '<Pkg & One>', version: '1.2', severity: 'Important', remediationStatus: 'Due_soon' }] } }),
    action1BaseUrl: baseUrl
  });
  assert(update.summary.startsWith('[Action1]'));
  assert(update.details.includes('Action1 update:'));
  assert(update.details.includes('/console/updates?'));
  assert(update.detailsHtml.includes('&lt;Pkg &amp; One&gt;'));
}

function testAutomationContentAndTitleCap() {
  const content = buildTicketContentFromCandidate({
    candidate: endpointCandidate('AUTOMATION_FAILED', { endpoint: { id: 'ep-1', name: 'E'.repeat(300) }, signal: { matchedCount: 1, matchedItemsPreview: [{ instanceName: '<Job>', failureTime: '2026-06-01_12-00-00', status: 'Error', actionName: 'Script', percentCompleted: 80, description: '<failed & unsafe>' }] } }),
    action1BaseUrl: baseUrl
  });
  assert.strictEqual(content.summary.length, 240, 'donor title cap remains 240 characters');
  assert(content.details.includes('Recent automation failures:'));
  assert(content.detailsHtml.includes('&lt;failed &amp; unsafe&gt;'));
}

function testGroupedContentPreservesIdentityFactsOrderCapAndBranding() {
  const impactedEndpoints = [
    { endpointId: 'ep-3', endpointName: 'Zulu', lastSeenAt: '2026-05-03' },
    { endpointId: 'ep-1', endpointName: '<Alpha & One>', lastSeenAt: '2026-05-01' },
    { endpointId: 'ep-2', endpointName: 'Beta', lastSeenAt: '2026-05-02' }
  ];
  const candidate = {
    identity: { identityKey: 'map-1|VULNERABILITY|CVE-2026-1', orgLinkId: 'map-1', signalType: 'VULNERABILITY' },
    issueKey: 'CVE-2026-1',
    routing: { action1OrgId: 'org-1', action1OrgName: 'Org One' },
    signal: { type: 'VULNERABILITY' },
    grouped: { issueMetadata: { cveId: 'CVE-2026-1', severity: 'High', cvssScore: 8.1, remediationStatus: 'Overdue' }, impactedEndpointCount: 3, impactedEndpoints }
  };
  const content = buildGroupedTicketContentFromCandidate({ candidate, action1BaseUrl: baseUrl, maxImpactedEndpointsInGroupedTicket: 2 });
  assert.strictEqual(content.summary.length <= 240, true);
  assert(content.details.includes('Action1 Ticketing Connector'));
  assert(content.details.includes('Showing 2 of 3 impacted endpoints.'));
  assert(content.details.includes('Additional impacted endpoints are available in Action1.'));
  assert.deepStrictEqual(content.visibleImpactedEndpoints.map((row) => row.endpointName), ['<Alpha & One>', 'Beta']);
  assert(content.detailsHtml.includes('&lt;Alpha &amp; One&gt;'), 'grouped endpoint values are escaped in HTML');
  assert(content.problemUrl.includes('/console/vulnerabilities/CVE-2026-1/affected_endpoints?org=org-1'));
}

testEndpointSignalContentAndSafeEncoding();
testVulnerabilityAndUpdateOrderingCapsAndLinks();
testAutomationContentAndTitleCap();
testGroupedContentPreservesIdentityFactsOrderCapAndBranding();
