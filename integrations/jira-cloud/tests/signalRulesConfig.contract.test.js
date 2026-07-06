const assert = require('assert');

const {
  normalizeSignalRulesConfig,
  validateSignalRulesConfigForCandidates
} = require('../signalRulesConfig');

function run() {
  runNormalizationTest();
  runValidationTest();
}

function runNormalizationTest() {
  const normalized = normalizeSignalRulesConfig({
    lifecycle: {
      existingOpenIssueBehavior: 'skip_existing_open',
      createNewWhenLinkedClosed: false
    },
    signalFilters: {
      offline: { enabled: false, thresholdDays: 14 },
      rebootRequired: { enabled: false },
      automationFailed: { enabled: true, lookbackHours: 36 },
      vulnerability: {
        severities: ['critical', 'high', 'moderate'],
        remediationStatuses: ['overdue', 'due soon']
      },
      update: {
        severities: ['high', 'moderate', 'other'],
        remediationStatuses: ['overdue']
      }
    },
    vulnerabilities: { ticketModel: 'endpoint' },
    updates: { ticketModel: 'grouped' },
    automationFailed: { ticketModel: 'endpoint' },
    maxImpactedEndpointsInGroupedTicket: 50,
    operationalSafeguards: {
      enableDebugLogging: true,
      maxOpenTicketsPerOrganization: 11
    }
  });

  assert.strictEqual(normalized.lifecycle.existingOpenIssueBehavior, 'skip_existing_open');
  assert.strictEqual(normalized.lifecycle.closeWhenSignalClears, false);
  assert.strictEqual(normalized.lifecycle.createNewWhenLinkedClosed, false);
  assert.strictEqual(normalized.lifecycle.reopenClosedTickets, false);
  assert.strictEqual(normalized.signalFilters.offline.enabled, false);
  assert.strictEqual(normalized.signalFilters.offline.thresholdDays, 14);
  assert.strictEqual(normalized.signalFilters.rebootRequired.enabled, false);
  assert.strictEqual(normalized.signalFilters.automationFailed.enabled, true);
  assert.strictEqual(normalized.signalFilters.automationFailed.lookbackHours, 36);
  assert.deepStrictEqual(normalized.signalFilters.vulnerability.severities, ['CRITICAL', 'HIGH', 'MEDIUM']);
  assert.deepStrictEqual(normalized.signalFilters.vulnerability.remediationStatuses, ['OVERDUE', 'DUE_SOON']);
  assert.deepStrictEqual(normalized.signalFilters.update.severities, ['IMPORTANT', 'MODERATE', 'UNSPECIFIED']);
  assert.deepStrictEqual(normalized.signalFilters.update.remediationStatuses, ['OVERDUE']);
  assert.strictEqual(normalized.vulnerabilities.ticketModel, 'endpoint');
  assert.strictEqual(normalized.updates.ticketModel, 'grouped');
  assert.strictEqual(normalized.automationFailed.ticketModel, 'endpoint');
  assert.strictEqual(normalized.maxImpactedEndpointsInGroupedTicket, 50);
  assert.strictEqual(normalized.operationalSafeguards.enableDebugLogging, true);
  assert.strictEqual(normalized.operationalSafeguards.maxOpenTicketsPerOrganization, 11);
}

function runValidationTest() {
  const normalized = normalizeSignalRulesConfig({});
  assert.deepStrictEqual(validateSignalRulesConfigForCandidates(normalized), [], 'normalized Jira rules config should validate cleanly');

  const invalid = validateSignalRulesConfigForCandidates({
    lifecycle: {
      existingOpenIssueBehavior: 'not-valid'
    }
  });
  assert.strictEqual(invalid.some((row) => row.code === 'missing_existing_open_behavior'), true, 'invalid lifecycle behavior should be rejected');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
