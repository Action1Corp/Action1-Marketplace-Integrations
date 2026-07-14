const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'core', 'mapping', 'deviceMapper.mjs')
  ).href;
  const {
    normalizeName,
    buildEndpointIndex,
    matchDevices,
    buildEndpointPatch,
    mapDevicesToPatches
  } = await import(moduleUrl);

  assert.strictEqual(normalizeName('  HOST-01  '), 'host-01', 'normalizeName should trim and lowercase');

  const endpoints = [
    { id: 'ep-1', device_name: 'host-01.contoso.local' },
    { id: 'ep-2', name: 'host-02' },
    { id: 'ep-3', name: 'dup-host.domain.local' },
    { id: 'ep-4', name: 'dup-host.other.local' }
  ];

  const endpointIndex = buildEndpointIndex(endpoints);
  assert.strictEqual(endpointIndex.get('host-01.contoso.local')[0].id, 'ep-1');
  assert.deepStrictEqual(
    endpointIndex.get('dup-host.domain.local').map((endpoint) => endpoint.id),
    ['ep-3'],
    'full-name index should preserve the standalone exact-name contract'
  );

  const mappingResult = matchDevices(
    [
      { id: 'entra-1', displayName: 'host-01.contoso.local' },
      { id: 'entra-2', displayName: 'host-02.corp.local' },
      { id: 'entra-3', displayName: 'dup-host.corp.local' },
      { id: 'entra-4', displayName: 'missing-host' }
    ],
    endpoints
  );

  assert.strictEqual(mappingResult.matched.length, 2, 'full and short-name matches should both be preserved');
  assert.deepStrictEqual(
    mappingResult.matched.map((entry) => ({
      entraId: entry.entraDevice.id,
      endpointId: entry.endpoint.id,
      matchType: entry.matchType
    })),
    [
      { entraId: 'entra-1', endpointId: 'ep-1', matchType: 'full' },
      { entraId: 'entra-2', endpointId: 'ep-2', matchType: 'short' }
    ],
    'matching should preserve standalone full-name precedence and short-name fallback'
  );
  assert.deepStrictEqual(
    mappingResult.ambiguous.map((entry) => ({
      entraId: entry.entraDevice.id,
      reason: entry.reason,
      candidates: entry.candidates.map((candidate) => candidate.id)
    })),
    [
      {
        entraId: 'entra-3',
        reason: 'duplicate_short',
        candidates: ['ep-3', 'ep-4']
      }
    ],
    'duplicate short-name candidates should remain ambiguous instead of picking an arbitrary endpoint'
  );
  assert.deepStrictEqual(
    mappingResult.unmatchedEntra.map((entry) => entry.id),
    ['entra-4'],
    'unmatched Entra devices should be tracked separately'
  );

  const patch = buildEndpointPatch(
    {
      memberOf: 'Group A; Group B',
      deviceOwnership: 'Company',
      ignoredValue: '',
      missingValue: null
    },
    [
      { entraProperty: 'memberOf', action1CustomAttribute: 'Entra Groups' },
      { entraProperty: 'deviceOwnership', action1CustomAttribute: 'custom:Entra Device Ownership' },
      { entraProperty: 'ignoredValue', action1CustomAttribute: 'Ignored Attribute' },
      { entraProperty: 'missingValue', action1CustomAttribute: 'Missing Attribute' }
    ]
  );

  assert.deepStrictEqual(
    patch,
    {
      'custom:Entra Groups': 'Group A; Group B',
      'custom:Entra Device Ownership': 'Company'
    },
    'patch planning should prefix custom attributes and skip empty values'
  );

  const collisionResult = mapDevicesToPatches(
    [
      {
        id: 'entra-a',
        displayName: 'shared-host',
        memberOf: 'Group A',
        deviceOwnership: 'Company'
      },
      {
        id: 'entra-b',
        displayName: 'shared-host.domain.local',
        memberOf: 'Group B',
        deviceOwnership: 'Personal'
      }
    ],
    [{ id: 'ep-shared', name: 'shared-host' }],
    [
      { entraProperty: 'memberOf', action1CustomAttribute: 'Entra Groups' },
      { entraProperty: 'deviceOwnership', action1CustomAttribute: 'Entra Device Ownership' }
    ]
  );

  assert.strictEqual(collisionResult.patches.length, 0, 'endpoint reuse collisions should suppress patch planning');
  assert.deepStrictEqual(
    collisionResult.ambiguousEndpointReuse,
    [
      {
        endpointId: 'ep-shared',
        endpointName: 'shared-host',
        candidateCount: 2,
        candidates: [
          {
            entraId: 'entra-a',
            entraName: 'shared-host',
            matchType: 'full'
          },
          {
            entraId: 'entra-b',
            entraName: 'shared-host.domain.local',
            matchType: 'short'
          }
        ]
      }
    ],
    'endpoint reuse collisions should preserve candidate details for later diagnostics'
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
