const assert = require('assert');

const {
  normalizeAction1EndpointSignalInput,
  normalizeEndpointRecord
} = require('../action1SignalInputNormalizer');

function runNormalizeEndpointRecordPreservesLastBootTimeTest() {
  const endpoint = normalizeEndpointRecord({
    id: 'ep-1',
    name: 'Endpoint One',
    last_seen: '2026-06-30_00-00-00',
    last_boot_time: '2026-06-01_00-00-00',
    reboot_required: 'yes'
  });

  assert.strictEqual(endpoint.lastBootTime, '2026-06-01_00-00-00', 'normalized endpoint record should preserve Action1 last_boot_time');
}

function runNormalizeAction1EndpointSignalInputPreservesLastBootTimeTest() {
  const evaluation = normalizeAction1EndpointSignalInput({
    action1OrgId: 'org-1',
    endpoint: {
      id: 'ep-1',
      last_boot_time: '2025-12-01_18-59-55',
      reboot_required: 'yes'
    }
  });

  assert(evaluation, 'normalized Action1 endpoint evaluation should be created');
  assert.strictEqual(evaluation.endpoint.lastBootTime, '2025-12-01_18-59-55', 'normalized Action1 endpoint input should preserve Action1 last_boot_time');
}

function run() {
  runNormalizeEndpointRecordPreservesLastBootTimeTest();
  runNormalizeAction1EndpointSignalInputPreservesLastBootTimeTest();
}

run();
