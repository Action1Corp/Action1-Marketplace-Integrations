const assert = require('assert');

const { qualifyEndpointSignals } = require('../signalQualification');

function resultFor(input) {
  return qualifyEndpointSignals(input).find((row) => row.signalType === 'REBOOT_REQUIRED');
}

function runDisabledThresholdPreservesExistingBehaviorTest() {
  const result = resultFor({
    config: {
      signalFilters: {
        rebootRequired: {
          enabled: true,
          ageThresholdEnabled: false,
          ageThresholdDays: 30
        }
      }
    },
    endpoint: {
      id: 'ep-1',
      rebootRequired: true
    },
    now: '2026-07-01T00:00:00Z'
  });

  assert(result, 'reboot-required result should be returned');
  assert.strictEqual(result.qualifies, true, 'disabled threshold mode should preserve reboot-required qualification');
  assert.strictEqual(result.reason, 'reboot_required', 'disabled threshold mode should keep the legacy reboot-required reason');
}

function runExactThresholdQualifiesTest() {
  const result = resultFor({
    config: {
      signalFilters: {
        rebootRequired: {
          enabled: true,
          ageThresholdEnabled: true,
          ageThresholdDays: 30
        }
      }
    },
    endpoint: {
      id: 'ep-1',
      rebootRequired: true,
      lastBootTime: '2026-06-01_00-00-00'
    },
    now: '2026-07-01T00:00:00Z'
  });

  assert(result, 'reboot-required result should be returned');
  assert.strictEqual(result.qualifies, true, 'endpoint exactly at the reboot age threshold should qualify');
}

function runRecentBootDoesNotQualifyTest() {
  const result = resultFor({
    config: {
      signalFilters: {
        rebootRequired: {
          enabled: true,
          ageThresholdEnabled: true,
          ageThresholdDays: 30
        }
      }
    },
    endpoint: {
      id: 'ep-1',
      rebootRequired: true,
      lastBootTime: '2026-06-02_00-00-00'
    },
    now: '2026-07-01T00:00:00Z'
  });

  assert(result, 'reboot-required result should be returned');
  assert.strictEqual(result.qualifies, false, 'endpoint newer than the reboot age threshold should not qualify');
}

function runMissingLastBootDoesNotQualifyTest() {
  const result = resultFor({
    config: {
      signalFilters: {
        rebootRequired: {
          enabled: true,
          ageThresholdEnabled: true,
          ageThresholdDays: 30
        }
      }
    },
    endpoint: {
      id: 'ep-1',
      rebootRequired: true
    },
    now: '2026-07-01T00:00:00Z'
  });

  assert(result, 'reboot-required result should be returned');
  assert.strictEqual(result.qualifies, false, 'missing last boot time should not qualify when reboot age threshold mode is enabled');
}

function runUnderscoreTimestampParsesTest() {
  const result = resultFor({
    config: {
      signalFilters: {
        rebootRequired: {
          enabled: true,
          ageThresholdEnabled: true,
          ageThresholdDays: 30
        }
      }
    },
    endpoint: {
      id: 'ep-1',
      rebootRequired: true,
      lastBootTime: '2025-12-01_18-59-55'
    },
    now: '2026-01-15T18:59:55Z'
  });

  assert(result, 'reboot-required result should be returned');
  assert.strictEqual(result.qualifies, true, 'Action1 underscore timestamps should be parsed for reboot age qualification');
}

function run() {
  runDisabledThresholdPreservesExistingBehaviorTest();
  runExactThresholdQualifiesTest();
  runRecentBootDoesNotQualifyTest();
  runMissingLastBootDoesNotQualifyTest();
  runUnderscoreTimestampParsesTest();
}

run();
